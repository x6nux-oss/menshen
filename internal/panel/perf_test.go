package panel

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/testutil"
)

// TestPerfSQLBaseline 是 M3 的可复跑面板 SQL 基线。默认跳过：它会造
// 20 万行合成库，不能拖慢日常 go test。
//
//	MENSHEN_PERF=1 go test ./internal/panel -run TestPerfSQLBaseline -v -count=1
//
// 数据全部在 t.TempDir() 里生成，不连真实上游、不碰生产库。
func TestPerfSQLBaseline(t *testing.T) {
	if os.Getenv("MENSHEN_PERF") == "" {
		t.Skip("设置 MENSHEN_PERF=1 运行面板 SQL 基线")
	}
	rows := perfEnvInt("MENSHEN_PERF_ROWS", 200000)
	iterations := perfEnvInt("MENSHEN_PERF_ITERS", 30)

	_, b := testutil.NewTestRegistry(t, nil)
	sh := b.Shared
	env := &miniTestEnv{t: t, h: MiniAppHandler(sh), now: time.Now().Unix(), sh: sh}

	// 次管 888 名下两个 bot（43/44），用来覆盖 bot_id IN (...) 的权限过滤路径。
	const (
		token43 = "43:AAEEfaketoken_ForUnitTestsOnly1234567"
		token44 = "44:AAEEfaketoken_ForUnitTestsOnly1234567"
		adminID = int64(888)
	)
	testutil.RegisterTestBot(t, sh, token43, 43, adminID)
	testutil.RegisterTestBot(t, sh, token44, 44, adminID)
	if _, err := sh.Store.Write.Exec(`INSERT OR REPLACE INTO admins(user_id,note,added_by,created_at)
		VALUES (?, 'perf', 777, 0)`, adminID); err != nil {
		t.Fatalf("登记次管失败: %v", err)
	}
	if err := sh.Cache.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}

	seedPerfData(t, sh, rows)
	mainInit := env.adminInit()
	scopedInit := signInitData(t, token43, map[string]string{
		"auth_date": fmt.Sprint(env.now), "user": `{"id":888,"username":"scoped"}`})

	type call struct {
		name string
		op   string
		body map[string]any
		init string
		tok  string
		bot  int64
	}
	run := func(c call) {
		if w := miniDo(t, env.h, c.tok, c.init, c.bot, c.op, c.body); w.Code != http.StatusOK {
			t.Fatalf("%s 返回 %d：%s", c.name, w.Code, w.Body.String())
		}
	}
	calls := []call{
		{"logs:all:p1", "logs", map[string]any{"page": 1}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:deleted:p1", "logs", map[string]any{"page": 1, "verdict": "deleted"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:deleted:p500", "logs", map[string]any{"page": 500, "verdict": "deleted"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:ad:p1", "logs", map[string]any{"page": 1, "verdict": "ad"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:clean:p1", "logs", map[string]any{"page": 1, "verdict": "clean"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:q", "logs", map[string]any{"page": 1, "q": "推广"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:user", "logs", map[string]any{"page": 1, "user_id": 100123}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"logs:scoped:p1", "logs", map[string]any{"page": 1, "verdict": "deleted"}, scopedInit, token43, 43},
		{"logs:scoped:p500", "logs", map[string]any{"page": 500, "verdict": "deleted"}, scopedInit, token43, 43},
		{"appeals:p1", "appeals", map[string]any{"page": 1}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"appeals:open:p1", "appeals", map[string]any{"page": 1, "filter": "open"}, mainInit, testutil.TestToken, testutil.TestBotID},
		{"appeals:scoped:p1", "appeals", map[string]any{"page": 1}, scopedInit, token43, 43},
		{"appeals:scoped:p500", "appeals", map[string]any{"page": 500}, scopedInit, token43, 43},
		{"state:main", "state", nil, mainInit, testutil.TestToken, testutil.TestBotID},
		{"user:main", "user", map[string]any{"user_id": 100123, "page": 1}, mainInit, testutil.TestToken, testutil.TestBotID},
	}

	// 基线用 M3 之前的索引：把本轮新增的三个索引都删掉，before/after
	// 在同一进程、同一份数据上测。
	for _, index := range []string{"idx_appeal_bot_id", "idx_antiad_action_id", "idx_antiad_verdict_id"} {
		if _, err := sh.Store.Write.Exec(`DROP INDEX IF EXISTS ` + index); err != nil {
			t.Fatalf("drop %s: %v", index, err)
		}
	}
	var results []perfSample
	for _, c := range calls {
		c := c
		// 预热一次：测的是稳态读路径，不含首次页缓存冷启动。
		run(c)
		results = append(results, measureNamed(c.name, iterations, func() {
			run(c)
		}))
	}

	// after：补上生产索引，重测受影响的接口。
	for _, ddl := range []string{
		`CREATE INDEX IF NOT EXISTS idx_appeal_bot_id ON appeals(bot_id, id)`,
		`CREATE INDEX IF NOT EXISTS idx_antiad_action_id ON antiad_log(action, id)`,
		`CREATE INDEX IF NOT EXISTS idx_antiad_verdict_id ON antiad_log(verdict, id)`,
	} {
		if _, err := sh.Store.Write.Exec(ddl); err != nil {
			t.Fatalf("create index: %v", err)
		}
	}
	byName := make(map[string]call, len(calls))
	for _, c := range calls {
		byName[c.name] = c
	}
	var httpAfter []perfSample
	for _, name := range []string{"appeals:scoped:p1", "appeals:scoped:p500",
		"logs:deleted:p1", "logs:deleted:p500", "logs:ad:p1", "logs:clean:p1",
		"logs:scoped:p1"} {
		c := byName[name]
		run(c)
		httpAfter = append(httpAfter, measureNamed(c.name, iterations, func() { run(c) }))
	}

	// 查询级 A/B：面板列表的瓶颈在 COUNT(*)，HTTP 层噪声大；这里直接测
	// 同一条 SQL 在候选索引前后的耗时。
	const (
		qDeletedCount = `SELECT COUNT(*) FROM antiad_log WHERE 1=1 AND action LIKE 'deleted%'`
		qDeletedP1    = `SELECT id FROM antiad_log WHERE 1=1 AND action LIKE 'deleted%'
			ORDER BY id DESC LIMIT 20 OFFSET 0`
		qDeletedP500 = `SELECT id FROM antiad_log WHERE 1=1 AND action LIKE 'deleted%'
			ORDER BY id DESC LIMIT 20 OFFSET 9980`
		qAdCount    = `SELECT COUNT(*) FROM antiad_log WHERE 1=1 AND verdict='ad'`
		qCleanCount = `SELECT COUNT(*) FROM antiad_log WHERE 1=1
			AND verdict IN ('clean','none')`
		qScopedDeletedCount = `SELECT COUNT(*) FROM antiad_log WHERE bot_id IN (?,?)
			AND action LIKE 'deleted%'`
	)
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_action_id`)
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_verdict_id`)
	beforeIdx := []perfSample{
		measureQuery("deleted count", sh, iterations, qDeletedCount),
		measureQuery("deleted p1", sh, iterations, qDeletedP1),
		measureQuery("deleted p500", sh, iterations, qDeletedP500),
		measureQuery("ad count", sh, iterations, qAdCount),
		measureQuery("clean count", sh, iterations, qCleanCount),
		measureQuery("scoped deleted count", sh, iterations, qScopedDeletedCount, 43, 44),
	}
	sh.Store.Write.Exec(`CREATE INDEX idx_antiad_action_id ON antiad_log(action, id)`)
	actionIdx := []perfSample{
		measureQuery("deleted count", sh, iterations, qDeletedCount),
		measureQuery("deleted p1", sh, iterations, qDeletedP1),
		measureQuery("deleted p500", sh, iterations, qDeletedP500),
		measureQuery("scoped deleted count", sh, iterations, qScopedDeletedCount, 43, 44),
	}
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_action_id`)
	sh.Store.Write.Exec(`CREATE INDEX idx_antiad_action_bot_id ON antiad_log(action, bot_id, id)`)
	actionBotIdx := []perfSample{
		measureQuery("deleted count", sh, iterations, qDeletedCount),
		measureQuery("scoped deleted count", sh, iterations, qScopedDeletedCount, 43, 44),
	}
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_action_bot_id`)
	sh.Store.Write.Exec(`CREATE INDEX idx_antiad_verdict_id ON antiad_log(verdict, id)`)
	verdictIdx := []perfSample{
		measureQuery("ad count", sh, iterations, qAdCount),
		measureQuery("clean count", sh, iterations, qCleanCount),
	}
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_action_id`)
	sh.Store.Write.Exec(`DROP INDEX IF EXISTS idx_antiad_verdict_id`)

	var dbPages, pageSize int64
	sh.Store.Read.QueryRow(`PRAGMA page_count`).Scan(&dbPages)
	sh.Store.Read.QueryRow(`PRAGMA page_size`).Scan(&pageSize)
	freePages := int64(0)
	sh.Store.Read.QueryRow(`PRAGMA freelist_count`).Scan(&freePages)
	counts := map[string]int64{}
	for _, table := range []string{"antiad_log", "appeals", "group_messages", "ai_log"} {
		var n int64
		sh.Store.Read.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n)
		counts[table] = n
	}

	var plan strings.Builder
	for _, q := range []struct {
		name string
		sql  string
		args []any
	}{
		{"antiad_log scoped list", `SELECT id FROM antiad_log WHERE bot_id IN (?,?)
			ORDER BY id DESC LIMIT 20 OFFSET 0`, []any{43, 44}},
		{"antiad_log scoped count", `SELECT COUNT(*) FROM antiad_log WHERE bot_id IN (?,?)`, []any{43, 44}},
		{"antiad_log like search", `SELECT COUNT(*) FROM antiad_log WHERE 1=1 AND (text LIKE ? OR reason LIKE ?)`,
			[]any{"%推广%", "%推广%"}},
		{"appeals scoped list", `SELECT id FROM appeals WHERE bot_id IN (?,?)
			ORDER BY id DESC LIMIT 20 OFFSET 0`, []any{43, 44}},
		{"appeals open count", `SELECT COUNT(*) FROM appeals WHERE status IN ('statement','ai','lifted','web','noweb','code')`,
			nil},
		{"recent_context", `SELECT message_id FROM group_messages
			WHERE chat_id=? AND user_id=? AND text != '' AND at >= 0
			ORDER BY at DESC, message_id DESC LIMIT 20`, []any{-100, 100123}},
	} {
		rows, err := sh.Store.Read.Query(`EXPLAIN QUERY PLAN `+q.sql, q.args...)
		if err != nil {
			t.Logf("EXPLAIN %s: %v", q.name, err)
			continue
		}
		var details []string
		for rows.Next() {
			var id, parent, notused int
			var detail string
			if rows.Scan(&id, &parent, &notused, &detail) == nil {
				details = append(details, detail)
			}
		}
		rows.Close()
		fmt.Fprintf(&plan, "- %s: %s\n", q.name, joinPerf(details, " | "))
	}

	t.Logf("\n### 面板 SQL 基线\n\n"+
		"环境：go %s %s/%s，GOMAXPROCS=%d；合成库 %s 行 antiad_log、%s 行 appeals、%s 行 group_messages、%s 行 ai_log；"+
		"库体积 %.1f MB（freelist %d 页）；每次调用含 Mini App 鉴权与 JSON 编码。\n\n"+
		"| 操作 | p50 | p95 | max |\n|---|---|---|---|\n%s\n查询计划：\n%s",
		runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.GOMAXPROCS(0),
		wan(counts["antiad_log"]), wan(counts["appeals"]), wan(counts["group_messages"]), wan(counts["ai_log"]),
		float64(dbPages*pageSize)/(1<<20), freePages,
		formatSamples(results), plan.String())
	t.Logf("\n### HTTP 索引 before/after（同进程、同数据）\n\n"+
		"before：M3 前索引\n\n| 操作 | p50 | p95 |\n|---|---|---|\n%s\n"+
		"after：+ appeals(bot_id,id) + antiad_log(action,id) + antiad_log(verdict,id)\n\n"+
		"| 操作 | p50 | p95 |\n|---|---|---|\n%s\n"+
		"### 索引候选（查询级 A/B）\n\n"+
		"before：无候选索引\n\n| 查询 | p50 | p95 |\n|---|---|---|\n%s\n"+
		"after：(action,id)\n\n| 查询 | p50 | p95 |\n|---|---|---|\n%s\n"+
		"after：(action,bot_id,id)\n\n| 查询 | p50 | p95 |\n|---|---|---|\n%s\n"+
		"after：(verdict,id)\n\n| 查询 | p50 | p95 |\n|---|---|---|\n%s",
		formatNamed(pick(results, "appeals:scoped:p1", "appeals:scoped:p500",
			"logs:deleted:p1", "logs:deleted:p500", "logs:ad:p1", "logs:clean:p1",
			"logs:scoped:p1")),
		formatNamed(httpAfter), formatNamed(beforeIdx), formatNamed(actionIdx),
		formatNamed(actionBotIdx), formatNamed(verdictIdx))
}

func wan(n int64) string { return fmt.Sprintf("%.1f 万", float64(n)/10000) }

func perfEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscan(v, &n); err == nil && n > 0 {
			return n
		}
	}
	return def
}

type perfSample struct {
	name    string
	samples []time.Duration
}

func measureNamed(name string, n int, fn func()) perfSample {
	out := perfSample{name: name, samples: make([]time.Duration, 0, n)}
	for range n {
		start := time.Now()
		fn()
		out.samples = append(out.samples, time.Since(start))
	}
	return out
}

func measureQuery(name string, sh *core.Shared, n int, sql string, args ...any) perfSample {
	return measureNamed(name, n, func() {
		rows, err := sh.Store.Read.Query(sql, args...)
		if err != nil {
			panic(err)
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				panic(err)
			}
		}
	})
}

func (s perfSample) p(q float64) time.Duration {
	if len(s.samples) == 0 {
		return 0
	}
	cp := append([]time.Duration(nil), s.samples...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	idx := int(float64(len(cp)-1) * q)
	return cp[idx]
}

func formatSamples(samples []perfSample) string {
	var out string
	for _, s := range samples {
		out += fmt.Sprintf("| %s | %s | %s | %s |\n", s.name,
			ms(s.p(0.5)), ms(s.p(0.95)), ms(s.p(1)))
	}
	return out
}

func formatNamed(samples []perfSample) string {
	var out string
	for _, s := range samples {
		out += fmt.Sprintf("| %s | %s | %s |\n", s.name, ms(s.p(0.5)), ms(s.p(0.95)))
	}
	return out
}

func pick(samples []perfSample, names ...string) []perfSample {
	var out []perfSample
	for _, s := range samples {
		for _, name := range names {
			if s.name == name {
				out = append(out, s)
			}
		}
	}
	return out
}

func ms(d time.Duration) string { return fmt.Sprintf("%.2f ms", float64(d)/float64(time.Millisecond)) }

func joinPerf(items []string, sep string) string {
	out := ""
	for i, s := range items {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}

// seedPerfData 造与审计 §1.3 同量级的合成数据：多 bot、多群、多用户，
// 文本与理由带真实长度的中文，搜索路径才会像生产一样扫表。
func seedPerfData(t *testing.T, sh *core.Shared, rows int) {
	t.Helper()
	tx, err := sh.Store.Write.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	bots := []int64{42, 43, 44, 45}
	statuses := []string{"statement", "ai", "lifted", "web", "noweb", "code", "redeemed", "rejected", "expired"}

	logStmt, _ := tx.Prepare(`INSERT INTO antiad_log
		(bot_id,chat_id,user_id,message_id,text,verdict,confidence,decider,
		 ad_kind,action,reason,prompt_tokens,completion_tokens,quota_cost,created_at,user_name)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	gmsgStmt, _ := tx.Prepare(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at,punished) VALUES (?,?,?,?,?,0)`)
	appealStmt, _ := tx.Prepare(`INSERT INTO appeals
		(bot_id,user_id,status,statement,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
	aiStmt, _ := tx.Prepare(`INSERT INTO ai_log
		(ts,endpoint,model,upstream,status,latency_ms,prompt_tokens,completion_tokens,
		 cached_tokens,quota_cost,input,output) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)

	for i := 0; i < rows; i++ {
		bot := bots[i%len(bots)]
		chat := -100 - int64(i%20)
		uid := 100000 + int64(i%5000)
		verdict := "clean"
		action := "none"
		reason := ""
		// 10% 命中：取与 bot 轮换周期（4）互质的步长，避免所有「已删除」
		// 都落在同一个 bot 上 —— 否则次管视角的列表会一条都查不到。
		if i%10 == 0 {
			verdict = "ad"
			action = "deleted_muted"
			reason = "推广｜正文含加群引流与收益承诺，命中内容哈希"
		} else if i%37 == 0 {
			verdict = "skipped"
			action = "skipped"
			reason = "超出本群送检频率上限"
		}
		if _, err := logStmt.Exec(bot, chat, uid, 100000+i,
			fmt.Sprintf("测试消息 %d：今天天气不错，聊聊技术与产品价格", i),
			verdict, 0.93, "systemone+llm", "scam", action, reason,
			1200, 90, 2800, now-int64(i*20), "perf-user"); err != nil {
			t.Fatalf("seed antiad_log: %v", err)
		}
		if _, err := gmsgStmt.Exec(chat, 100000+i, uid,
			fmt.Sprintf("测试消息 %d：今天天气不错，聊聊技术与产品价格", i), now-int64(i*20)); err != nil {
			t.Fatalf("seed group_messages: %v", err)
		}
		if i%4 == 0 {
			// 未结申诉在 (bot_id,user_id) 上有唯一部分索引，合成数据的申诉人
			// 必须逐行唯一，否则会撞 idx_appeal_open。
			if _, err := appealStmt.Exec(bots[(i/4)%len(bots)], int64(1_000_000+i),
				statuses[(i/4)%len(statuses)],
				fmt.Sprintf("申诉陈述 %d：我认为这条消息不是广告，只是分享链接。", i),
				now-int64(i*60), now-int64(i*30)); err != nil {
				t.Fatalf("seed appeals: %v", err)
			}
		}
		if i%10 == 0 {
			if _, err := aiStmt.Exec(now-int64(i*20), "systemone", "so-model", "fake", "ok",
				180, 1200, 90, 0, 2800,
				`{"state":{"text":"`+fmt.Sprint("测试载荷 ", i)+`"}}`, `{"answers":{"is_ad":"ad"}}`); err != nil {
				t.Fatalf("seed ai_log: %v", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
}
