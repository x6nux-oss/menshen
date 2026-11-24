package antiad

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"menshen/internal/core"
	"menshen/internal/store"
)

// alertMergeEntry 是某个 (群,人) 当前那条群内告警：消息号、命中次数与
// 窗口到期时刻。mu 覆盖「发新告警 / 合并编辑」整段，保证并发命中至多
// 产生一条初始告警。
type alertMergeEntry struct {
	mu      sync.Mutex
	msgID   int64
	hits    int
	first   time.Time
	last    time.Time
	expires time.Time
}

// alertMerger 是进程内的合并窗口表。挂在 core.Shared 的 Ext 上（见
// alertMerges），进程重启后清空：重启后第一次命中会重发一条告警，
// 不影响删除/禁言等实际处置。
type alertMerger struct {
	mu sync.Mutex
	m  map[string]*alertMergeEntry
}

// alertMergeKey 是 Ext 的未导出键类型：各包用它挂自己的进程级状态。
type alertMergerExtKey struct{}

func alertMerges(b *core.Bot) *alertMerger {
	return core.Ext(b.Shared, alertMergerExtKey{}, func() *alertMerger {
		return &alertMerger{m: make(map[string]*alertMergeEntry)}
	})
}

// alertMergeKey 按 bot 分开：同一个进程可能同时服务多个 bot，
// 各 bot 对同一用户各发各的告警。
func alertMergeKey(b *core.Bot, chatID, uid int64) string {
	return fmt.Sprintf("%d:%d:%d", b.BotID(), chatID, uid)
}

// entry 取该键的条目，没有就建一个。建条目必须在这里一次完成：
// 两个并发命中拿到同一个指针，才能在条目锁上串行。
func (am *alertMerger) entry(key string) *alertMergeEntry {
	am.mu.Lock()
	defer am.mu.Unlock()
	e := am.m[key]
	if e == nil {
		e = &alertMergeEntry{}
		am.m[key] = e
	}
	return e
}

// gc 回收已过期的条目，避免 map 随广告号数量无限增长。
// 正在被持有的条目跳过（TryLock 失败），留给下一轮。
func (am *alertMerger) gc(now time.Time) {
	am.mu.Lock()
	defer am.mu.Unlock()
	for k, e := range am.m {
		if !e.mu.TryLock() {
			continue
		}
		if !now.Before(e.expires) {
			delete(am.m, k)
		}
		e.mu.Unlock()
	}
}

// mergeLine 渲染窗口内的追加行：只给条数与首末时间，原文、昵称与理由
// 都不回贴（见 renderAdAlertBrief）。
func mergeLine(e *alertMergeEntry, snap *store.Snapshot) string {
	loc := snap.Location()
	return fmt.Sprintf("该用户另有 %d 条命中（%s–%s）", e.hits-1,
		e.first.In(loc).Format("15:04:05"), e.last.In(loc).Format("15:04:05"))
}

// withMergeLine 把追加行插在首行之后：链接固定贴在末尾。
func withMergeLine(brief, line string) string {
	if i := strings.IndexByte(brief, '\n'); i >= 0 {
		return brief[:i] + "\n" + line + brief[i:]
	}
	return brief + "\n" + line
}
