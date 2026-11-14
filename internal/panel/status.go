package panel

import (
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"menshen/internal/antiad"
	"menshen/internal/billing"
	"menshen/internal/core"
	"menshen/internal/store"
	"menshen/internal/tg"
)

// ---- /status：运行状态与近 24 小时统计 ----
//
// 管理员私聊的只读体检入口：进程活了多久、有多少 bot 在跑、近一天送检了
// 多少条、命中多少广告、花了多少钱。范围与 /log、/user 同一套权限 —— 主
// 管理员看全平台，次级管理员只看自己名下 bot 的流水（见 botsClause）。
//
// 统计全部来自快照与 SQLite，除回复本身外不产生任何 TG 调用。

// statusWindow 是 /status 的统计窗口，与面板其他「近 24 小时」口径一致。
const statusWindow = 24 * time.Hour

// statusStats 是近 24 小时的判定汇总。
type statusStats struct {
	Checked int64 // 送检：verdict != 'skipped'
	Hits    int64 // 命中广告：verdict = 'ad'
	Errors  int64 // 判定失败：verdict = 'error'
	Skipped int64 // 未送检：verdict = 'skipped'（护栏拦下或豁免）
	FPs     int64 // 误判：action = 'undone'
	Cost    int64 // 模型开销（quota）
	Kept    int64 // 群消息留底条数
}

// HandleStatusCommand 处理管理员私聊的 /status。
func HandleStatusCommand(b *core.Bot, m *tg.Message) {
	uid := m.From.ID
	if !b.IsStaff(uid) {
		return
	}
	b.Send(m.Chat.ID, renderStatus(b, uid), nil)
}

// renderStatus 汇总并渲染运行状态。
func renderStatus(b *core.Bot, uid int64) string {
	sh := b.Shared
	snap := sh.Cache.Snap()
	main := sh.IsMain(uid)

	var sb strings.Builder
	sb.WriteString("📊 <b>运行状态</b>\n\n")

	if v := strings.TrimSpace(sh.Version); v != "" {
		fmt.Fprintf(&sb, "版本 %s · ", html.EscapeString(v))
	}
	fmt.Fprintf(&sb, "已运行 %s\n", formatUptime(time.Since(sh.StartedAt)))

	// 可见 bot：主管理员全部，次级管理员只看自己名下。
	bots := snap.BotsOwnedBy(uid, main)
	enabled, running := 0, 0
	chats, dryrun := 0, 0
	botIDs := make(map[int64]bool, len(bots))
	for _, rec := range bots {
		botIDs[rec.BotID] = true
		if rec.Enabled {
			enabled++
		}
		if sh.Reg != nil {
			if _, live := sh.Reg.LookupID(rec.BotID); live {
				running++
			}
		}
		for _, c := range snap.ChatsOf(rec.BotID) {
			if !c.Enabled {
				continue
			}
			chats++
			if c.Dryrun {
				dryrun++
			}
		}
	}
	fmt.Fprintf(&sb, "机器人 %d 个（启用 %d · 运行中 %d）｜ 生效群 %d 个",
		len(bots), enabled, running, chats)
	if dryrun > 0 {
		fmt.Fprintf(&sb, "（演练 %d）", dryrun)
	}
	sb.WriteString("\n")
	if sh.Reg != nil && running < enabled {
		// 长轮询模式下工作 bot 不会有实例（它们只走 webhook），
		// 面板的机器人详情页有同样的提示。
		fmt.Fprintf(&sb, "⚠️ 有 %d 个已启用的机器人没有在运行（长轮询模式只跑主 bot）\n",
			enabled-running)
	}
	fmt.Fprintf(&sb, "判定队列 %d 条 ｜ 未结申诉 %d 个\n",
		statusBusy(sh, botIDs), statusOpenAppeals(sh, uid, main))

	if n := sh.AIFailStreak.Load(); n > 0 {
		fmt.Fprintf(&sb, "⚠️ 上游连续失败 %d 次，期间消息一律放行\n", n)
	}

	// 近 24 小时判定汇总。
	st := loadStatusStats(sh, uid, main)
	sb.WriteString("\n<b>近 24 小时</b>\n")
	fmt.Fprintf(&sb, "送检 %d 条：广告 %d · 正常 %d · 失败 %d\n",
		st.Checked, st.Hits, st.Checked-st.Hits-st.Errors, st.Errors)
	fmt.Fprintf(&sb, "未送检 %d 条 ｜ 误判 %d 条\n", st.Skipped, st.FPs)
	fmt.Fprintf(&sb, "群消息留底 %d 条 ｜ 开销 %s\n",
		st.Kept, billing.FormatUSDFine(st.Cost))

	if kinds := loadStatusKinds(sh, uid, main); len(kinds) > 0 {
		sb.WriteString("\n<b>命中类型</b>\n")
		sb.WriteString(kinds + "\n")
	}
	return sb.String()
}

// loadStatusStats 汇总可见范围内近 24 小时的判定数字。
func loadStatusStats(sh *core.Shared, uid int64, main bool) statusStats {
	since := time.Now().Add(-statusWindow).Unix()
	where, args := botsClause(sh, uid, main)
	q := append([]any{since}, args...)

	var st statusStats
	err := sh.Store.Read.QueryRow(`SELECT
		COALESCE(SUM(CASE WHEN verdict!='skipped' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN verdict='ad' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN verdict='error' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN verdict='skipped' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN action='undone' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(quota_cost),0)
		FROM antiad_log WHERE created_at >= ?`+where, q...).
		Scan(&st.Checked, &st.Hits, &st.Errors, &st.Skipped, &st.FPs, &st.Cost)
	if err != nil {
		slog.Error("运行状态：统计判定流水失败", "err", err)
		return st
	}

	// 留底按可见 bot 名下的群圈定：group_messages 没有 bot_id，
	// 同一群被多个 bot 覆盖时也只该算一次。主管理员是平台级视角
	// （与 botsClause 对 antiad_log 不设限一致），不按群过滤。
	if main {
		if err := sh.Store.Read.QueryRow(`SELECT COUNT(*) FROM group_messages
			WHERE at >= ?`, since).Scan(&st.Kept); err != nil {
			slog.Error("运行状态：统计留底条数失败", "err", err)
		}
		return st
	}
	if chats := statusChatIDs(sh, uid); len(chats) > 0 {
		ph := make([]string, len(chats))
		args := make([]any, 0, len(chats)+1)
		args = append(args, since)
		for i, id := range chats {
			ph[i] = "?"
			args = append(args, id)
		}
		if err := sh.Store.Read.QueryRow(`SELECT COUNT(*) FROM group_messages
			WHERE at >= ? AND chat_id IN (`+strings.Join(ph, ",")+`)`, args...).
			Scan(&st.Kept); err != nil {
			slog.Error("运行状态：统计留底条数失败", "err", err)
		}
	}
	return st
}

// loadStatusKinds 汇总近 24 小时命中广告的类型分布（按条数降序，取前 5）。
// 返回已渲染好的一行；没有命中时返回空串。
func loadStatusKinds(sh *core.Shared, uid int64, main bool) string {
	since := time.Now().Add(-statusWindow).Unix()
	where, args := botsClause(sh, uid, main)
	q := append([]any{since}, args...)

	rows, err := sh.Store.Read.Query(`SELECT ad_kind, COUNT(*) FROM antiad_log
		WHERE created_at >= ? AND verdict='ad'`+where+`
		GROUP BY ad_kind ORDER BY COUNT(*) DESC LIMIT 5`, q...)
	if err != nil {
		slog.Error("运行状态：统计命中类型失败", "err", err)
		return ""
	}
	defer rows.Close()

	var parts []string
	for rows.Next() {
		var kind string
		var n int64
		if rows.Scan(&kind, &n) != nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %d",
			html.EscapeString(antiad.AdKindLabel(kind)), n))
	}
	return strings.Join(parts, " · ")
}

// statusChatIDs 返回次级管理员名下 bot 覆盖的群，用于给没有 bot_id 的
// group_messages 圈定范围。主管理员不调用它（平台级视角不按群过滤）。
func statusChatIDs(sh *core.Shared, uid int64) []int64 {
	snap := sh.Cache.Snap()
	seen := map[int64]bool{}
	var out []int64
	for _, rec := range snap.BotsOwnedBy(uid, false) {
		for _, c := range snap.ChatsOf(rec.BotID) {
			if !seen[c.ChatID] {
				seen[c.ChatID] = true
				out = append(out, c.ChatID)
			}
		}
	}
	return out
}

// statusOpenAppeals 统计可见范围内未结的申诉单，与 Mini App 工作台的
// 待办同一口径（同一套状态集合与权限 clause）。
func statusOpenAppeals(sh *core.Shared, uid int64, main bool) int64 {
	where, args := botsClause(sh, uid, main)
	var n int64
	if err := sh.Store.Read.QueryRow(`SELECT COUNT(*) FROM appeals
		WHERE status IN (`+store.AppealOpenStatusesSQL+`)`+where, args...).Scan(&n); err != nil {
		slog.Error("运行状态：统计未结申诉失败", "err", err)
	}
	return n
}

// statusBusy 汇总可见 bot 实例上排队中与执行中的判定任务数。
func statusBusy(sh *core.Shared, botIDs map[int64]bool) int64 {
	if sh.Reg == nil {
		return 0
	}
	var n int64
	sh.Reg.Each(func(b *core.Bot) {
		if botIDs[b.BotID()] {
			n += b.AdBusy()
		}
	})
	return n
}

// formatUptime 把运行时长渲染成中文粗粒度文本：天 / 小时 / 分 / 秒。
func formatUptime(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("%d 天 %d 小时", int(d.Hours())/24, int(d.Hours())%24)
	case d >= time.Hour:
		return fmt.Sprintf("%d 小时 %d 分", int(d.Hours()), int(d.Minutes())%60)
	case d >= time.Minute:
		return fmt.Sprintf("%d 分 %d 秒", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%d 秒", int(d.Seconds()))
}
