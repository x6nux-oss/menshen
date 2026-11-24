package antiad

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/testutil"
	"menshen/internal/upstream"
)

// perfCase 是一条合成判定样本：ground truth 与 systemone（初判）的答案
// 分开给，才能测出采信线对复判率、漏判率和成本的影响。
type perfCase struct {
	ad     bool    // 真实标签
	soAd   bool    // systemone 的答案
	soConf float64 // systemone 的置信度
}

// TestPerfJudgeBaseline 是 M3 的判定链路基线：本地假上游 + 临时 SQLite，
// 不连真实模型。默认跳过。
//
//	MENSHEN_PERF=1 go test ./internal/antiad -run TestPerfJudgeBaseline -v -count=1
//
// 关键口径：
//   - 复判率 = 大模型调用数 / 判定消息数
//   - 漏判率 = 真实广告中最终 verdict != ad 的比例
//   - 误判率 = 真实正常消息中最终 verdict == ad 的比例
//   - 单条成本 = ai_log.quota_cost 总和 / 判定消息数（按 models 表定价折算）
//
// 假上游零延迟，因此 p50/p95 只反映本地开销与两级调用的编排成本；真实
// 模型的首字/生成时间需要在部署环境用同一脚本加 mock 延迟复测。
func TestPerfJudgeBaseline(t *testing.T) {
	if os.Getenv("MENSHEN_PERF") == "" {
		t.Skip("设置 MENSHEN_PERF=1 运行判定链路基线")
	}
	const (
		chatID = int64(-2001)
		n      = 300
	)
	reg, b := testutil.NewTestRegistry(t, nil)
	sh := b.Shared
	perfSeedPricing(t, sh)
	testutil.EnableAntiad(t, b, chatID)
	perfSetUnlimited(t, b)
	cases := makePerfCases(n)
	maxInFlight := &atomic.Int64{}
	inflight := &atomic.Int64{}
	var latency atomic.Int64
	fakeAI(t, b, perfUpstreamHandler(cases, inflight, maxInFlight, &latency))

	// 画像预置成老成员：避免新人分档与入群冷判定把判定链路测量搅乱。
	perfSeedMembers(t, sh, chatID, 600000, 4000)

	var report strings.Builder
	fmt.Fprintf(&report, "\n### 判定链路基线（假上游零延迟）\n\n")
	fmt.Fprintf(&report, "样本 %d 条：40%% 广告；其中 25%% 被初判漏掉（置信度 0.86-0.94），15%% 正常消息被初判误判为广告。\n\n", n)
	fmt.Fprintf(&report, "| 采信线 | 复判率 | 漏判率 | 误判率 | 单条成本 | SO 本地耗时 p50/p95 | LLM 本地耗时 p50/p95 | 同步段 p50/p95 | 端到端 p50/p95 |\n")
	fmt.Fprintf(&report, "|---|---|---|---|---|---|---|---|---|\n")

	for run, trust := range []int{95, 90, 85} {
		if err := b.PutBotSetting(b.BotID(), "antiad_so_trust", fmt.Sprint(trust)); err != nil {
			t.Fatalf("设置 trust: %v", err)
		}
		beforeAILog := perfMaxID(t, sh, "ai_log")
		latency.Store(0)
		var syncTimes, e2eTimes []time.Duration
		verdicts := make(map[int64]string, n)
		for i := range cases {
			msgID := int64(trust*100000 + i)
			uid := int64(600000 + run*1000 + i)
			// 正文带上 trust 轮次：三轮必须用不同文本，否则后一轮命中
			// 前一轮落下的内容哈希，直接走 hashHit 而绕过采信线。
			msg := testutil.GroupMsg(chatID, uid, msgID,
				fmt.Sprintf("perf-%d trust-%d 今天聊聊产品与技术", i, trust))
			start := time.Now()
			HandleGroupMessage(b, msg)
			syncTimes = append(syncTimes, time.Since(start))
			perfWaitIdle(t, b)
			e2eTimes = append(e2eTimes, time.Since(start))
			verdicts[msgID] = perfVerdict(t, sh, msgID)
		}
		_, llmN, cost, soDur, llmDur := perfAILog(t, sh, beforeAILog)
		miss, fp := perfRates(cases, verdicts, trust)
		fmt.Fprintf(&report, "| %d | %.1f%% | %.1f%% | %.1f%% | %s | %s / %s | %s / %s | %s / %s | %s / %s |\n",
			trust, 100*float64(llmN)/float64(n), 100*miss, 100*fp,
			perfUSD(cost, n), perfMS(percentile(soDur, 0.5)), perfMS(percentile(soDur, 0.95)),
			perfMS(percentile(llmDur, 0.5)), perfMS(percentile(llmDur, 0.95)),
			perfMS(percentile(syncTimes, 0.5)), perfMS(percentile(syncTimes, 0.95)),
			perfMS(percentile(e2eTimes, 0.5)), perfMS(percentile(e2eTimes, 0.95)))
	}

	// 并发扇出：两个 bot 各自 32 路 worker，共用一份上游配额。这是审计
	// §4.1 的「初判无全局闸」在生产并发上最直接的证据。
	b2, _ := testutil.AddRegistryBot(t, reg, sh, 88, 777)
	const chat2 = int64(-2002)
	testutil.EnableAntiad(t, b2, chat2)
	if err := b2.PutBotSetting(b2.BotID(), "antiad_so_trust", "95"); err != nil {
		t.Fatalf("设置 b2 trust: %v", err)
	}
	perfSeedMembers(t, sh, chatID, 700000, 120)
	perfSeedMembers(t, sh, chat2, 710000, 120)
	latency.Store(int64(20 * time.Millisecond))
	inflight.Store(0)
	maxInFlight.Store(0)
	const burst = 100
	start := time.Now()
	for i := 0; i < burst; i++ {
		HandleGroupMessage(b, testutil.GroupMsg(chatID, int64(700000+i), int64(900000+i),
			fmt.Sprintf("perf-%d burst-%d 今天聊聊产品与技术", i%n, i)))
		HandleGroupMessage(b2, testutil.GroupMsg(chat2, int64(710000+i), int64(910000+i),
			fmt.Sprintf("perf-%d burst2-%d 今天聊聊产品与技术", i%n, i)))
	}
	perfWaitIdle(t, b)
	perfWaitIdle(t, b2)
	elapsed := time.Since(start)
	fmt.Fprintf(&report, "\n### 并发扇出（2 bot × 32 worker，mock 延迟 20 ms）\n\n")
	fmt.Fprintf(&report, "- 同时送出的消息：%d 条（每 bot %d）\n", burst*2, burst)
	fmt.Fprintf(&report, "- 观测到的上游最大同时在飞请求：%d\n", maxInFlight.Load())
	fmt.Fprintf(&report, "- 全部跑完耗时：%s\n", elapsed.Round(time.Millisecond))
	t.Logf("%s", report.String())
}

// TestPerfWriteBaseline 测判定热路径上的同步写入：成员画像、留底、流水与
// ai_log。默认跳过。
//
//	MENSHEN_PERF=1 go test ./internal/antiad -run TestPerfWriteBaseline -v -count=1
func TestPerfWriteBaseline(t *testing.T) {
	if os.Getenv("MENSHEN_PERF") == "" {
		t.Skip("设置 MENSHEN_PERF=1 运行写路径基线")
	}
	_, b := testutil.NewTestRegistry(t, nil)
	sh := b.Shared
	const (
		chatID = int64(-3001)
		n      = 200
	)
	now := time.Now().Unix()
	msg := testutil.GroupMsg(chatID, 800001, 1, "perf write baseline")
	msg.Date = now
	touchMember(b, chatID, msg.From.ID, now)

	touch := perfMeasure(n, func(i int) {
		touchMember(b, chatID, msg.From.ID, now)
	})
	record := perfMeasure(n, func(i int) {
		recordMessage(b, chatID, int64(1000+i), msg.From.ID, msg.Text, now, "")
	})
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_verdict_id`)
	adBefore := perfMeasure(n, func(i int) {
		logAd(b, msg, adVerdict{IsAd: true, Confidence: 0.93, Kind: "scam",
			Decider: "systemone+llm", Reason: "perf"}, "deleted", "")
	})
	sh.Store.Write.Exec(`CREATE INDEX idx_antiad_verdict_id ON antiad_log(verdict, id)`)
	adAfter := perfMeasure(n, func(i int) {
		logAd(b, msg, adVerdict{IsAd: true, Confidence: 0.93, Kind: "scam",
			Decider: "systemone+llm", Reason: "perf"}, "deleted", "")
	})

	// ai_log 的 input 上限 64 KB、output 上限 32 KB。用满载行测最坏写放大，
	// 再与 16 KB 的单条正文对比：判断「截断上限」是否真是写路径瓶颈。
	full := strings.Repeat("x", 64<<10)
	small := strings.Repeat("x", 16<<10)
	aiFull := perfMeasure(n, func(i int) {
		logAICall(sh, upstream.EPChat, "llm-model", "fake",
			map[string]any{"messages": []map[string]string{{"role": "user", "content": full}}},
			aiResult{reply: aiReply{Raw: json.RawMessage(`{"ok":true}`)}})
	})
	aiSmall := perfMeasure(n, func(i int) {
		logAICall(sh, upstream.EPChat, "llm-model", "fake",
			map[string]any{"messages": []map[string]string{{"role": "user", "content": small}}},
			aiResult{reply: aiReply{Raw: json.RawMessage(`{"ok":true}`)}})
	})
	var pages, pageSize int64
	sh.Store.Read.QueryRow(`PRAGMA page_count`).Scan(&pages)
	sh.Store.Read.QueryRow(`PRAGMA page_size`).Scan(&pageSize)
	t.Logf("\n### 写路径基线（单写连接，WAL，synchronous=NORMAL）\n\n"+
		"| 写入 | p50 | p95 |\n|---|---|---|\n"+
		"| touchMember（UPSERT RETURNING） | %s | %s |\n"+
		"| recordMessage（留底 UPSERT） | %s | %s |\n"+
		"| logAd（无 verdict 索引） | %s | %s |\n"+
		"| logAd（有 verdict 索引） | %s | %s |\n"+
		"| logAICall 64 KB 正文 | %s | %s |\n"+
		"| logAICall 16 KB 正文 | %s | %s |\n\n"+
		"测试后库体积 %.1f MB。\n",
		perfMS(percentile(touch, 0.5)), perfMS(percentile(touch, 0.95)),
		perfMS(percentile(record, 0.5)), perfMS(percentile(record, 0.95)),
		perfMS(percentile(adBefore, 0.5)), perfMS(percentile(adBefore, 0.95)),
		perfMS(percentile(adAfter, 0.5)), perfMS(percentile(adAfter, 0.95)),
		perfMS(percentile(aiFull, 0.5)), perfMS(percentile(aiFull, 0.95)),
		perfMS(percentile(aiSmall, 0.5)), perfMS(percentile(aiSmall, 0.95)),
		float64(pages*pageSize)/(1<<20))
}

func makePerfCases(n int) []perfCase {
	rng := rand.New(rand.NewSource(20261123))
	out := make([]perfCase, n)
	for i := range out {
		c := perfCase{ad: rng.Float64() < 0.40}
		switch {
		case c.ad && rng.Float64() < 0.25:
			// 真广告被初判漏掉：置信度落在 85~95 之间，采信线越低越容易漏。
			c.soAd = false
			c.soConf = 0.86 + 0.08*rng.Float64()
		case !c.ad && rng.Float64() < 0.15:
			// 正常消息被初判误判为广告。
			c.soAd = true
			c.soConf = 0.86 + 0.06*rng.Float64()
		default:
			c.soAd = c.ad
			c.soConf = 0.84 + 0.15*rng.Float64()
		}
		out[i] = c
	}
	return out
}

func perfUpstreamHandler(cases []perfCase, inflight, maxInFlight, latency *atomic.Int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		idx := perfCaseIndex(body)
		if idx < 0 || idx >= len(cases) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if d := latency.Load(); d > 0 {
			cur := inflight.Add(1)
			for {
				old := maxInFlight.Load()
				if cur <= old || maxInFlight.CompareAndSwap(old, cur) {
					break
				}
			}
			defer inflight.Add(-1)
			time.Sleep(time.Duration(d))
		}
		c := cases[idx]
		if strings.HasSuffix(r.URL.Path, "/systemone") {
			choice := "clean"
			kind := "none"
			if c.soAd {
				choice, kind = "ad", "scam"
			}
			fmt.Fprintf(w, `{"answers":{"is_ad":{"choice":%q,"confidence":%v},`+
				`"ad_scope":{"choice":"message"},"ad_kind":{"choice":%q},`+
				`"severity":{"score":2}},"usage":{"input_tokens":900,"output_tokens":40}}`,
				choice, c.soConf, kind)
			return
		}
		// 复判按 ground truth 给结论：mock 的误差模型只放在初判上。
		kind, scope := "none", "message"
		del, mute := false, muteNone
		if c.ad {
			kind, del, mute = "scam", true, muteForever
		}
		inner, _ := json.Marshal(map[string]any{
			"is_ad": c.ad, "kind": kind, "scope": scope,
			"delete": del, "mute": mute, "reason": "perf mock",
			"evidence": testEvidence,
		})
		out, _ := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": string(inner)}}},
			"usage":   map[string]any{"prompt_tokens": 1200, "completion_tokens": 80},
		})
		w.Write(out)
	}
}

func perfCaseIndex(body []byte) int {
	m := perfIDRe.FindSubmatch(body)
	if m == nil {
		return -1
	}
	var idx int
	if _, err := fmt.Sscanf(string(m[1]), "%d", &idx); err != nil {
		return -1
	}
	return idx
}

// perfIDRe 同时适配 systemone 的 state.message.text 与 chat 的 messages
// 数组：两边的请求形状不同，但样本号都只出现在正文里。
var perfIDRe = regexp.MustCompile(`perf-(\d+)`)

// perfSeedPricing 用两张常见价位的模型：初判便宜、复判贵，成本差异才看得出来。
func perfSeedPricing(t *testing.T, sh *core.Shared) {
	t.Helper()
	if _, err := sh.Store.Write.Exec(`INSERT OR REPLACE INTO models
		(name,prompt_price,completion_price,cache_read_price,cache_write_price,enabled)
		VALUES ('so-model',0.15,0.6,0,0,1),('llm-model',2.5,10,0,0,1)`); err != nil {
		t.Fatalf("seed models: %v", err)
	}
	if err := sh.Cache.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
}

func perfSetUnlimited(t *testing.T, b *core.Bot) {
	t.Helper()
	if err := b.PutSetting("antiad_rpm_chat", "0"); err != nil {
		t.Fatalf("putSetting antiad_rpm_chat: %v", err)
	}
}

func perfSeedMembers(t *testing.T, sh *core.Shared, chatID, base int64, n int) {
	t.Helper()
	now := time.Now().Unix()
	tx, err := sh.Store.Write.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()
	stmt, _ := tx.Prepare(`INSERT OR IGNORE INTO group_members
		(chat_id,user_id,joined_at,first_seen,msg_count,last_msg_at)
		VALUES (?,?,?,?,100,?)`)
	for i := 0; i < n; i++ {
		if _, err := stmt.Exec(chatID, base+int64(i), now-365*86400, now-365*86400, now); err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

func perfWaitIdle(t *testing.T, b *core.Bot) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for b.AdBusy() != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("判定队列 10 秒内没跑空（剩 %d）", b.AdBusy())
		}
		time.Sleep(100 * time.Microsecond)
	}
}

func perfMaxID(t *testing.T, sh *core.Shared, table string) int64 {
	t.Helper()
	var id int64
	sh.Store.Read.QueryRow(`SELECT COALESCE(MAX(id),0) FROM ` + table).Scan(&id)
	return id
}

func perfVerdict(t *testing.T, sh *core.Shared, msgID int64) string {
	t.Helper()
	var verdict string
	sh.Store.Read.QueryRow(`SELECT verdict FROM antiad_log WHERE message_id=?`, msgID).Scan(&verdict)
	return verdict
}

func perfAILog(t *testing.T, sh *core.Shared, afterID int64) (soN, llmN, cost int64, soDur, llmDur []time.Duration) {
	t.Helper()
	rows, err := sh.Store.Read.Query(`SELECT endpoint, latency_ms, quota_cost FROM ai_log WHERE id>?`, afterID)
	if err != nil {
		t.Fatalf("读 ai_log: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var ep string
		var ms, c int64
		if rows.Scan(&ep, &ms, &c) != nil {
			continue
		}
		cost += c
		if ep == "systemone" {
			soN++
			soDur = append(soDur, time.Duration(ms)*time.Millisecond)
		} else {
			llmN++
			llmDur = append(llmDur, time.Duration(ms)*time.Millisecond)
		}
	}
	return
}

func perfRates(cases []perfCase, verdicts map[int64]string, trust int) (miss, falsePositive float64) {
	var ads, misses, cleans, fps int
	for i, c := range cases {
		v := verdicts[int64(trust*100000+i)]
		if c.ad {
			ads++
			if v != "ad" {
				misses++
			}
		} else {
			cleans++
			if v == "ad" {
				fps++
			}
		}
	}
	if ads > 0 {
		miss = float64(misses) / float64(ads)
	}
	if cleans > 0 {
		falsePositive = float64(fps) / float64(cleans)
	}
	return
}

func perfUSD(quota, n int64) string {
	if n == 0 {
		return "$0"
	}
	return fmt.Sprintf("%.6f USD", float64(quota)/500000/float64(n))
}

func percentile(d []time.Duration, q float64) time.Duration {
	if len(d) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), d...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	return cp[int(float64(len(cp)-1)*q)]
}

func perfMS(d time.Duration) string {
	return fmt.Sprintf("%.2fms", float64(d)/float64(time.Millisecond))
}

func perfMeasure(n int, fn func(i int)) []time.Duration {
	out := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		fn(i)
		out = append(out, time.Since(start))
	}
	return out
}
