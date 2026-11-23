package main

import (
	"fmt"
	"html"
	"log/slog"
	"sync/atomic"
	"time"

	"menshen/internal/antiad"
	"menshen/internal/backup"
	"menshen/internal/core"
	"menshen/internal/panel"
	"menshen/internal/store"
)

// taskIntervals 是两档定时任务的周期。生产用 defaultTaskIntervals，
// 测试注入毫秒级值以便在秒内观察到副作用。
type taskIntervals struct {
	minute time.Duration
	hourly time.Duration
}

var defaultTaskIntervals = taskIntervals{
	minute: time.Minute,
	hourly: time.Hour,
}

func runBackgroundTasks(stop <-chan struct{}, sh *core.Shared, reg *core.Registry) {
	verifyDatabase(sh)
	startBackup(stop, sh)
	runBackgroundTasksEvery(stop, sh, reg, defaultTaskIntervals)
}

// backupKeep 与 backupEvery 把面板设置夹到合理范围：0 / 负数来自旧配置
// 或手改库，不能让备份永久关闭或无限密集。
func backupKeep(snap *store.Snapshot) int {
	n := snap.SettingInt("backup_keep", 7)
	if n < 1 {
		n = 7
	}
	if n > 365 {
		n = 365
	}
	return int(n)
}

func backupEvery(snap *store.Snapshot) time.Duration {
	h := snap.SettingInt("backup_interval_hours", 24)
	if h < 1 {
		h = 24
	}
	if h > 8760 {
		h = 8760
	}
	return time.Duration(h) * time.Hour
}

// startBackup 起进程内的定时备份。备份在读连接上执行（VACUUM INTO 是读
// 事务，WAL 下不挡写），失败会私聊主管理员并在包内退避重试。
func startBackup(stop <-chan struct{}, sh *core.Shared) {
	go backup.Run(stop, sh.Store.Read,
		func() (backup.Options, time.Duration, bool) {
			snap := sh.Cache.Snap()
			if snap.SettingInt("backup_enabled", 1) != 1 {
				return backup.Options{}, 0, false
			}
			return backup.Options{
				DBPath:     sh.Cfg.DBPath,
				ArchiveDir: sh.Cfg.ArchiveDir,
				Keep:       backupKeep(snap),
			}, backupEvery(snap), true
		}, sh.NotifyAdmins)
}

// verifyDatabase 在启动时跑一次 PRAGMA quick_check。失败只告警、不退出：
// 能打开库通常还能读出数据，立刻停服会让恢复手段更少；管理员按文档从
// 备份恢复。检查本身是同步的（库越大越久），但只是一次顺序读。
func verifyDatabase(sh *core.Shared) {
	if err := backup.QuickCheck(sh.Store.Read); err != nil {
		slog.Error("数据库完整性校验失败", "db", sh.Cfg.DBPath, "err", err)
		go sh.NotifyAdmins(fmt.Sprintf("⚠️ <b>数据库完整性校验失败</b>\n\n"+
			"库: <code>%s</code>\n错误: %s\n\n"+
			"请停止写入并按 docs/operations.md 从备份恢复。",
			html.EscapeString(sh.Cfg.DBPath), html.EscapeString(err.Error())))
		return
	}
	slog.Info("数据库完整性校验通过", "check", "quick_check")
}

func runBackgroundTasksEvery(stop <-chan struct{}, sh *core.Shared, reg *core.Registry,
	iv taskIntervals) {

	minute := time.NewTicker(iv.minute)
	hourly := time.NewTicker(iv.hourly)
	defer minute.Stop()
	defer hourly.Stop()

	// 启动即跑一轮：ticker 的首次触发要等满一个周期，冷启动后清理任务
	// 整整一小时不执行。
	tickMinute(sh, reg)
	runHourly(sh)

	for {
		select {
		case <-stop:
			return
		case <-minute.C:
			tickMinute(sh, reg)
		case <-hourly.C:
			runHourly(sh)
		}
	}
}

// hourlyBusy 保证小时任务不重入。RunAdDigest 要调大模型（预算 45 秒）、
// CleanupData 要分批删库，正常远短于一小时，但一次卡住不该叠着跑第二轮。
var hourlyBusy atomic.Bool

// runHourly 把小时任务挪到独立 goroutine：形态总结要调大模型、保留期清理
// 要删库，同步跑会把分钟 tick 一起卡住（告警撤回、私聊汇总、全部内存 GC
// 都在那一轮里）。
func runHourly(sh *core.Shared) {
	if !hourlyBusy.CompareAndSwap(false, true) {
		slog.Warn("小时任务仍在运行，跳过这一轮")
		return
	}
	go func() {
		defer hourlyBusy.Store(false)
		tickHourly(sh)
	}()
}

func tickMinute(sh *core.Shared, reg *core.Registry) {
	antiad.GCCaches(sh)         // 反广告的全部内存缓存与节流记录（见 antiad/caches.go）
	antiad.PrewarmSweep(sh)     // 前置号资料复查：只确保低优先级探测协程已启动（探测自带节奏与抢占）
	panel.GCChatHealthCache(sh) // 面板的群权限自检结果
	sh.AdLimits.GC()            // 反广告护栏窗口：回收长期无人问津的 key
	sh.GCShard(time.Now())      // 同群多 bot 的发言人认领
	if reg == nil {
		return
	}

	now := time.Now()
	reg.Each(func(b *core.Bot) {
		b.GCPending() // 待输入会话是每个 bot 各自一份的，纯内存
		// 撤回与汇总要发 TG：放进各自的 goroutine，且同一个 bot 不重入。
		// 逐个串行时，一个慢 bot（TG 超时 40 秒）会把其他所有 bot 的
		// 清理一起拖住；下一轮 tick 到点时若这一轮还没跑完，跳过即可。
		if !b.MinuteBusy.CompareAndSwap(false, true) {
			return
		}
		go func() {
			defer b.MinuteBusy.Store(false)
			antiad.SweepAlertCleanup(b, now) // 到点撤回群内告警：只有发它的 bot 删得掉
			antiad.SweepJoinVerifies(b, now) // 入群验证超时踢出（见 joinverify.go）
			// 加群超时未配置自动退群（见 core/chatpresence.go）。退群要发 TG，
			// 与上面两个清扫同批，慢了就下一轮再试。
			b.SweepUnconfiguredChats(now)
			// 私聊汇总。启动即跑的这一轮顺带把游标就位：升级后第一次只记位置，
			// 拖到第一个整分钟的话，这一分钟里的命中会被当成历史跳过。
			antiad.FlushAdSummary(b, now)
			// 空标题补一次：先加配置、后入群的群，长期没人发言时消息路径
			// 等不到，只有这里能自愈。有标题的群不查 TG。
			refreshChatTitles(b, true)
		}()
	})
}

func tickHourly(sh *core.Shared) {
	antiad.CleanupData(sh)
	reclaimSpace(sh)
	// 规则发现自动运行只负责启动：同步扫一遍游标后就起后台 goroutine。
	// 放在小时任务最前面，避免被下面可能长达几十分钟的禁言复查/形态总结堵住
	// ——它一旦在下一小时 tick 时还没跑完，整轮小时任务都会被跳过。
	antiad.AutoRuleDiscovery(sh)
	antiad.ReassertActiveMutes(sh) // 进群限制被外部解除时补一次（见 reassert.go）
	antiad.RunAdDigest(sh, false)  // 形态摘要，样本不够时内部直接返回
	// 全量刷一遍群标题：群改名后跟上面板，也让一直没查到的空标题再试。
	// 启动时 runHourly 会立刻跑一轮，等于启动回填。
	if sh.Reg != nil {
		sh.Reg.Each(func(b *core.Bot) { refreshChatTitles(b, false) })
	}
}

// refreshChatTitles 用这个 bot 的 token 把名下的群标题与公开 @ 名刷一遍。
//
// 这两样只在添加群那一刻抓过：先加配置、后入群的群会一直空着，群改名或
// 从私有转公开也不会跟着变。onlyEmpty 为真只查空标题（分钟级快速自愈）；
// 否则全量（小时级，跟进群改名）。按 bot 限量、逐条间隔，避免触发 TG 速率限制。
func refreshChatTitles(b *core.Bot, onlyEmpty bool) {
	q := `SELECT chat_id FROM bot_chats WHERE bot_id=?`
	if onlyEmpty {
		q += ` AND title=''`
	}
	rows, err := b.Store.Read.Query(q+` LIMIT 200`, b.BotID())
	if err != nil {
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		b.RefreshChatMeta(id)
		time.Sleep(50 * time.Millisecond)
	}
}

// reclaimSpace 在保留期清理之后回收空闲页。日志里的「空闲页 × 页大小」
// 就是删掉但没还给文件系统的字节数，也是备份体积持续变大的直接原因。
func reclaimSpace(sh *core.Shared) {
	before, err := sh.Store.SpaceStats()
	if err != nil {
		slog.Error("读取 SQLite 空闲页失败", "err", err)
		return
	}
	after, err := sh.Store.ReclaimSpace()
	if err != nil {
		slog.Error("回收 SQLite 空闲页失败", "空闲页", before.FreePages, "err", err)
		return
	}
	if before.FreePages != after.FreePages || after.FreePages > 0 {
		slog.Info("数据空间统计", "页大小", after.PageSize,
			"空闲页", after.FreePages, "auto_vacuum", after.AutoVacuum)
	}
}
