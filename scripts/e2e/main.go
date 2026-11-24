// 申诉链路离线端到端演示。
//
// 一条命令把 menshen 完整跑起来并验证：
//
//	群消息广告 → 初判 → 删除 + 临时禁言 → 复判定案 → 用户申诉
//	→ AI 复核维持 → 网页人机验证 → 签发解禁码 → 群内兑换 → 白名单 24h
//
// 不需要真实 Telegram、模型或 Cloudflare：Telegram Bot API、OpenAI 兼容
// 上游与 Turnstile siteverify 全部指向本进程里的假服务；数据库与日志都在
// 临时目录，进程退出即删。用法见 docs/e2e-appeal-demo.md。
package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"menshen/internal/store"
)

const (
	mainToken   = "100001:AAEEe2eMainTokenOfflineOnly1234567890"
	workerToken = "200002:AAEEe2eWorkerTokenOfflineOnly1234567890"
	mainBotID   = int64(100001)
	workerBotID = int64(200002)
	adminID     = int64(900009)
	userID      = int64(300003)
	chatID      = int64(-1001234567890)

	adText = "USDT 代收代付，日结高返点，加我微信 xxx 领取福利"
)

func main() {
	var (
		repo = flag.String("repo", ".", "menshen 仓库根目录")
		bin  = flag.String("bin", "", "复用已构建的 menshen 二进制（空 = 现场 go build）")
		fail = flag.String("fail", "", "失败注入：initial（模型返回空）/ turnstile（验证不通过）")
	)
	flag.Parse()

	d := &demo{repo: *repo, bin: *bin, fail: *fail}
	err := d.run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n✗ %v\n", err)
		d.diagnostics()
	}
	d.cleanup()
	if err != nil {
		os.Exit(1)
	}
}

type demo struct {
	repo string
	bin  string
	fail string

	dir     string
	dbPath  string
	db      *sql.DB
	port    int
	proc    *exec.Cmd
	logFile *os.File
	cleans  []func()

	tg    *fakeTG
	model *fakeModel
	ts    *fakeTurnstile

	updateID int64
	lastWeb  string

	steps []string
}

func (d *demo) run() (err error) {
	if err = step(1, "准备临时环境并启动 menshen", d.setup); err != nil {
		return err
	}
	if err = step(2, "群消息初判 → 删除 + 临时禁言 + 复判定案", d.injectAd); err != nil {
		return err
	}
	if err = step(3, "用户申诉 → AI 复核维持原判", d.appeal); err != nil {
		return err
	}
	if err = step(4, "网页人机验证 → 签发解禁码", d.webCheck); err != nil {
		return err
	}
	if err = step(5, "群内兑换 → 白名单 24h", d.redeem); err != nil {
		return err
	}
	d.report()
	return nil
}

// ---- 步骤 ----

func (d *demo) setup() error {
	var err error
	if d.dir, err = os.MkdirTemp("", "menshen-e2e-*"); err != nil {
		return err
	}
	d.dbPath = filepath.Join(d.dir, "data.db")

	d.tg = newFakeTG()
	tgSrv := httptest.NewServer(d.tg)
	d.addCleanup(tgSrv.Close)

	d.model = &fakeModel{fail: d.fail == "initial"}
	modelSrv := httptest.NewServer(d.model)
	d.addCleanup(modelSrv.Close)

	d.ts = &fakeTurnstile{fail: d.fail == "turnstile"}
	tsSrv := httptest.NewServer(d.ts)
	d.addCleanup(tsSrv.Close)

	if err := d.seedDB(modelSrv.URL); err != nil {
		return err
	}

	// 配置里 public_url 必须是 https（Telegram 的要求），但演示不会让
	// Telegram 回调；网页请求直接按路径打到本地监听端口。
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	d.port = ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	cfgPath := filepath.Join(d.dir, "config.yaml")
	cfg := fmt.Sprintf(`admin_ids:
  - %d
bot_token: "%s"
public_url: "https://demo.local"
listen_addr: "127.0.0.1:%d"
db_path: "%s"
archive_dir: "%s"
local_models_dir: "%s"
local_models_bundled_dir: ""
tg_api_base: "%s"
tg_api_id: 0
turnstile_site_key: "demo-site-key"
turnstile_secret: "demo-secret"
turnstile_verify_url: "%s/siteverify"
`, adminID, mainToken, d.port, d.dbPath, filepath.Join(d.dir, "archive"),
		filepath.Join(d.dir, "models"), tgSrv.URL, tsSrv.URL)
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		return err
	}

	bin := d.bin
	if bin == "" {
		bin = filepath.Join(d.dir, "menshen")
		build := exec.Command("go", "build", "-o", bin, ".")
		build.Dir = d.repo
		build.Env = append(os.Environ(), "CGO_ENABLED=0")
		if out, err := build.CombinedOutput(); err != nil {
			return fmt.Errorf("go build 失败：%v\n%s", err, tail(string(out), 2000))
		}
	}
	if !filepath.IsAbs(bin) {
		abs, err := filepath.Abs(bin)
		if err != nil {
			return err
		}
		bin = abs
	}

	d.logFile, err = os.Create(filepath.Join(d.dir, "menshen.log"))
	if err != nil {
		return err
	}
	d.proc = exec.Command(bin, "-config", cfgPath)
	d.proc.Stdout = d.logFile
	d.proc.Stderr = d.logFile
	d.proc.Env = childEnv()
	if err := d.proc.Start(); err != nil {
		return fmt.Errorf("启动 menshen 失败：%v", err)
	}
	d.addCleanup(func() { d.stop() })

	// 健康检查只代表进程活着；还要确认工作 bot 已从库里拉起。
	httpc := &http.Client{Timeout: 2 * time.Second}
	err = waitFor(20*time.Second, "进程 /healthz 就绪", func() (bool, error) {
		resp, err := httpc.Get(d.baseURL() + "/healthz")
		if err != nil {
			return false, nil
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return false, nil
		}
		return d.tg.count("getMe") >= 1, nil
	})
	if err != nil {
		return err
	}

	// 只读句柄用于断言；写路径全部由被测进程自己走。
	d.db, err = sql.Open("sqlite", "file:"+d.dbPath+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return err
	}
	d.addCleanup(func() { d.db.Close() })
	return nil
}

func (d *demo) injectAd() error {
	date := time.Now().Unix()
	err := d.postUpdate(map[string]any{
		"message": map[string]any{
			"message_id": 501, "date": date,
			"from": map[string]any{"id": userID, "is_bot": false,
				"first_name": "广告号", "username": "ad_user"},
			"chat": map[string]any{"id": chatID, "type": "supergroup",
				"title": "E2E 演示群"},
			"text": adText,
		},
	})
	if err != nil {
		return err
	}

	var verdict, action, reason string
	err = waitFor(20*time.Second, "antiad_log 命中且假 Telegram 收到删除/禁言", func() (bool, error) {
		row := d.db.QueryRow(`SELECT verdict,action,reason FROM antiad_log
			WHERE bot_id=? AND chat_id=? AND user_id=? ORDER BY id DESC LIMIT 1`,
			workerBotID, chatID, userID)
		if err := row.Scan(&verdict, &action, &reason); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return false, nil
			}
			return false, err
		}
		if verdict != "ad" {
			return false, fmt.Errorf("verdict=%q reason=%q", verdict, reason)
		}
		if !strings.Contains(action, "deleted") {
			return false, fmt.Errorf("action=%q", action)
		}
		if !d.tg.hasCall("deleteMessage", "message_id", 501) {
			return false, nil
		}
		if !d.tg.hasCall("restrictChatMember", "user_id", userID) {
			return false, nil
		}
		return true, nil
	})
	if err != nil {
		return err
	}
	if d.model.chatCount() == 0 {
		return fmt.Errorf("初判命中但复判模型从未被调用")
	}
	d.steps = append(d.steps, fmt.Sprintf(
		"antiad_log: verdict=%s action=%s reason=%s", verdict, action, reason))
	d.steps = append(d.steps, fmt.Sprintf(
		"Telegram: deleteMessage×%d restrictChatMember×%d",
		d.tg.count("deleteMessage"), d.tg.count("restrictChatMember")))
	return nil
}

func (d *demo) appeal() error {
	// 私聊点「写申诉理由」按钮。
	err := d.postUpdate(map[string]any{
		"callback_query": map[string]any{
			"id": "cb-appeal", "chat_instance": "ci",
			"from": map[string]any{"id": userID, "is_bot": false,
				"first_name": "广告号", "username": "ad_user"},
			"data": "a:ap:st",
			"message": map[string]any{
				"message_id": 700, "date": time.Now().Unix(),
				"chat": map[string]any{"id": userID, "type": "private"},
				"text": "📝 写申诉理由",
			},
		},
	})
	if err != nil {
		return err
	}

	var appealID int64
	err = waitFor(10*time.Second, "申诉单进入 statement", func() (bool, error) {
		err := d.db.QueryRow(`SELECT id FROM appeals
			WHERE bot_id=? AND user_id=? AND status='statement'
			ORDER BY id DESC LIMIT 1`, workerBotID, userID).Scan(&appealID)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return err
	}

	// 用户发送申诉理由：AI 复核维持原判 → 状态转 web。
	err = d.postUpdate(map[string]any{
		"message": map[string]any{
			"message_id": 701, "date": time.Now().Unix(),
			"from": map[string]any{"id": userID, "is_bot": false,
				"first_name": "广告号", "username": "ad_user"},
			"chat": map[string]any{"id": userID, "type": "private"},
			"text": "这条是朋友让我代发的，我不知道是广告，请撤销",
		},
	})
	if err != nil {
		return err
	}

	var status, aiResult string
	var aiConf float64
	err = waitFor(20*time.Second, "AI 复核维持原判（status=web）", func() (bool, error) {
		err := d.db.QueryRow(`SELECT status,ai_result,ai_conf FROM appeals
			WHERE id=?`, appealID).Scan(&status, &aiResult, &aiConf)
		if err != nil {
			return false, err
		}
		if status != "web" || aiResult != "uphold" {
			return false, fmt.Errorf("status=%q ai_result=%q", status, aiResult)
		}
		return true, nil
	})
	if err != nil {
		return err
	}
	if n := d.model.appealCount(); n == 0 {
		return fmt.Errorf("申诉复核模型从未被调用")
	}
	d.steps = append(d.steps, fmt.Sprintf(
		"appeals: #%d status=%s ai_result=%s conf=%.0f%%", appealID, status, aiResult, aiConf*100))
	return nil
}

func (d *demo) webCheck() error {
	link, ok := d.appealLink()
	if !ok {
		return fmt.Errorf("假 Telegram 没收到申诉验证链接")
	}
	u, err := url.Parse(link)
	if err != nil {
		return fmt.Errorf("解析验证链接失败：%v", err)
	}
	u.Scheme = "http"
	u.Host = fmt.Sprintf("127.0.0.1:%d", d.port)

	body, _ := json.Marshal(map[string]any{
		"token": "e2e-turnstile-token", "signals": map[string]any{},
	})
	req, _ := http.NewRequest(http.MethodPost, u.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "+
		"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("提交网页验证失败：%v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	d.lastWeb = fmt.Sprintf("%s %s", resp.Status, tail(string(raw), 1000))

	var out struct {
		OK   bool   `json:"ok"`
		Code string `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return fmt.Errorf("网页响应无法解析：%s", tail(string(raw), 500))
	}
	if !out.OK || out.Code == "" {
		return fmt.Errorf("验证未通过：%s", out.Msg)
	}

	var dbCode string
	err = waitFor(5*time.Second, "解禁码落库且 web_checks 记录通过", func() (bool, error) {
		err := d.db.QueryRow(`SELECT code FROM appeals
			WHERE bot_id=? AND user_id=? ORDER BY id DESC LIMIT 1`,
			workerBotID, userID).Scan(&dbCode)
		if err != nil {
			return false, err
		}
		var pass int
		err = d.db.QueryRow(`SELECT COUNT(*) FROM web_checks
			WHERE user_id=? AND result='pass'`, userID).Scan(&pass)
		return pass == 1, err
	})
	if err != nil {
		return err
	}
	if dbCode != out.Code {
		return fmt.Errorf("返回码 %q 与库中 %q 不一致", out.Code, dbCode)
	}
	if !d.tg.messageContains(userID, out.Code) {
		return fmt.Errorf("假 Telegram 没有收到解禁码消息")
	}
	if d.ts.count() == 0 {
		return fmt.Errorf("Turnstile 校验端点从未被调用")
	}
	d.steps = append(d.steps, fmt.Sprintf(
		"web_checks: 1 pass；解禁码 %s 已私聊下发", out.Code))
	return nil
}

func (d *demo) redeem() error {
	code := d.currentCode()
	if code == "" {
		return fmt.Errorf("库里没有可兑换的解禁码")
	}
	// 群管理员在群里发码（config 里的主管理员同时是工作 bot 归属人）。
	err := d.postUpdate(map[string]any{
		"message": map[string]any{
			"message_id": 900, "date": time.Now().Unix(),
			"from": map[string]any{"id": adminID, "is_bot": false,
				"first_name": "管理员", "username": "admin"},
			"chat": map[string]any{"id": chatID, "type": "supergroup",
				"title": "E2E 演示群"},
			"text": "核销解禁码 " + code,
		},
	})
	if err != nil {
		return err
	}

	var expires int64
	var source string
	err = waitFor(20*time.Second, "兑换后写入 ad_whitelist", func() (bool, error) {
		err := d.db.QueryRow(`SELECT expires_at,source FROM ad_whitelist
			WHERE bot_id=? AND chat_id=? AND user_id=?`,
			workerBotID, chatID, userID).Scan(&expires, &source)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	})
	if err != nil {
		return err
	}

	var status string
	err = waitFor(10*time.Second, "申诉单结案为 redeemed", func() (bool, error) {
		err := d.db.QueryRow(`SELECT status FROM appeals
			WHERE bot_id=? AND user_id=? ORDER BY id DESC LIMIT 1`,
			workerBotID, userID).Scan(&status)
		return status == "redeemed", err
	})
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	ttl := time.Duration(expires-now) * time.Second
	if ttl < 23*time.Hour || ttl > 25*time.Hour {
		return fmt.Errorf("白名单有效期 %s，不是 24h 量级", ttl.Round(time.Minute))
	}
	if source != "appeal" {
		return fmt.Errorf("白名单来源应是 appeal，得到 %q", source)
	}
	var redeems int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM appeal_redeems
		WHERE chat_id=?`, chatID).Scan(&redeems); err != nil {
		return err
	}
	if redeems != 1 {
		return fmt.Errorf("应写 1 条兑换记录，实际 %d", redeems)
	}
	if d.tg.count("unbanChatMember") == 0 {
		return fmt.Errorf("兑换后没有调用 unbanChatMember")
	}
	d.steps = append(d.steps, fmt.Sprintf(
		"ad_whitelist: source=%s 剩余 %s；appeals=redeemed；兑换记录 1 条",
		source, ttl.Round(time.Minute)))
	return nil
}

func (d *demo) report() {
	fmt.Println("✅ 申诉链路端到端通过")
	for i, s := range d.steps {
		fmt.Printf("  %d. %s\n", i+1, s)
	}
	fmt.Printf("\n临时目录：%s（退出后删除）\n", d.dir)
}

// ---- 数据库种子 ----

func (d *demo) seedDB(modelURL string) error {
	st, err := store.Open(d.dbPath)
	if err != nil {
		return fmt.Errorf("初始化临时库失败：%v", err)
	}
	defer st.Close()

	if err := store.SeedBuiltinRules(st); err != nil {
		return err
	}
	exec := func(q string, args ...any) error {
		if _, err := st.Write.Exec(q, args...); err != nil {
			return fmt.Errorf("%v\nSQL: %s", err, q)
		}
		return nil
	}
	// 工作 bot：主 bot 由被测进程按 config.bot_token 自动登记，它只做配置
	// 管理、不判定，所以真正接群的是这一行。
	if err := exec(`INSERT INTO bots
		(token,bot_id,username,owner_id,so_model,llm_model,enabled,created_at,is_main)
		VALUES (?,?,'e2e_worker_bot',?,'','',1,0,0)`,
		workerToken, workerBotID, adminID); err != nil {
		return err
	}
	if err := exec(`INSERT INTO bot_chats
		(bot_id,chat_id,title,enabled,dryrun,group_alert,created_at)
		VALUES (?,?,'E2E 演示群',1,0,0,0)`, workerBotID, chatID); err != nil {
		return err
	}
	soModels, _ := json.Marshal([]string{"demo/fake-so"})
	llmModels, _ := json.Marshal([]string{"demo/fake-llm"})
	for k, v := range map[string]string{
		"antiad_enabled":    "1",
		"antiad_so_models":  string(soModels),
		"antiad_llm_models": string(llmModels),
		"antiad_rpm_chat":   "1000",
	} {
		if err := exec(`INSERT INTO settings (k,v) VALUES (?,?)
			ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v); err != nil {
			return err
		}
	}
	if err := exec(`INSERT INTO upstreams
		(name,base_url,api_key,weight,status,supports_chat,supports_systemone,kind)
		VALUES ('demo',?,'e2e-key',1,1,1,1,'openai')`, modelURL); err != nil {
		return err
	}
	for _, name := range []string{"demo/fake-so", "demo/fake-llm"} {
		if err := exec(`INSERT INTO models
			(name,prompt_price,completion_price,enabled) VALUES (?,?,?,1)`,
			name, 0.000001, 0.000002); err != nil {
			return err
		}
	}
	return nil
}

// ---- 假 Telegram Bot API ----

type tgCall struct {
	method  string
	payload map[string]any
}

type fakeTG struct {
	mu       sync.Mutex
	calls    []tgCall
	messages []sentMsg
	nextID   int64
}

type sentMsg struct {
	chatID int64
	text   string
}

func newFakeTG() *fakeTG { return &fakeTG{nextID: 1000} }

func (f *fakeTG) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	var payload map[string]any
	json.Unmarshal(raw, &payload)

	segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	method, token := "", ""
	if len(segs) >= 2 && strings.HasPrefix(segs[0], "bot") {
		token, method = strings.TrimPrefix(segs[0], "bot"), segs[1]
	}

	f.mu.Lock()
	f.calls = append(f.calls, tgCall{method: method, payload: payload})
	f.mu.Unlock()

	var result any = true
	switch method {
	case "getMe":
		result = map[string]any{"id": tokenBotID(token), "is_bot": true,
			"first_name": "e2e_bot", "username": "e2e_bot"}
	case "getChat":
		id := num(payload["chat_id"])
		if id < 0 {
			result = map[string]any{"id": id, "type": "supergroup", "title": "E2E 演示群"}
		} else {
			result = map[string]any{"id": id, "type": "private",
				"first_name": "E2E User", "username": "e2e_user"}
		}
	case "getChatMember":
		uid := num(payload["user_id"])
		status := "member"
		if uid == adminID {
			status = "administrator"
		}
		result = map[string]any{"status": status,
			"user": map[string]any{"id": uid, "is_bot": false,
				"first_name": "E2E User", "username": "e2e_user"}}
	case "getChatAdministrators":
		result = []map[string]any{{
			"status": "administrator",
			"user": map[string]any{"id": adminID, "is_bot": false,
				"first_name": "管理员", "username": "admin"},
		}}
	case "getUserProfilePhotos":
		result = map[string]any{"total_count": 0, "photos": []any{}}
	case "getChatMemberCount":
		result = 3
	case "sendMessage":
		text := fmt.Sprint(payload["text"])
		cid := num(payload["chat_id"])
		f.mu.Lock()
		f.nextID++
		id := f.nextID
		f.messages = append(f.messages, sentMsg{chatID: cid, text: text})
		f.mu.Unlock()
		result = map[string]any{"message_id": id, "date": time.Now().Unix(),
			"chat": map[string]any{"id": cid, "type": "private"}, "text": text}
	case "getUpdates":
		result = []any{}
	}
	writeJSON(w, map[string]any{"ok": true, "result": result})
}

func tokenBotID(token string) int64 {
	prefix, _, _ := strings.Cut(token, ":")
	id, _ := strconv.ParseInt(prefix, 10, 64)
	return id
}

func (f *fakeTG) count(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c.method == method {
			n++
		}
	}
	return n
}

func (f *fakeTG) hasCall(method, key string, want int64) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if c.method == method && num(c.payload[key]) == want {
			return true
		}
	}
	return false
}

func (f *fakeTG) messageContains(chat int64, sub string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, m := range f.messages {
		if m.chatID == chat && strings.Contains(m.text, sub) {
			return true
		}
	}
	return false
}

func (f *fakeTG) messageContaining(chat int64, sub string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, m := range f.messages {
		if m.chatID == chat && strings.Contains(m.text, sub) {
			return m.text, true
		}
	}
	return "", false
}

func (f *fakeTG) lastCall() (string, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.calls) - 1; i >= 0; i-- {
		raw, _ := json.Marshal(f.calls[i].payload)
		return f.calls[i].method, tail(string(raw), 800)
	}
	return "", ""
}

// ---- 假模型上游 ----

type fakeModel struct {
	mu        sync.Mutex
	fail      bool
	lastReq   string
	lastResp  string
	chats     int
	appeals   int
	systemone int
}

func (f *fakeModel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	appeal := strings.Contains(string(raw), "handling an **appeal**")

	if strings.HasSuffix(r.URL.Path, "/systemone") {
		f.mu.Lock()
		f.systemone++
		f.lastReq = "POST " + r.URL.Path + " " + tail(string(raw), 1200)
		f.mu.Unlock()

		out := map[string]any{"answers": map[string]any{}}
		if !f.fail {
			out = map[string]any{"answers": map[string]any{
				"is_ad":    map[string]any{"choice": "ad", "confidence": 0.95},
				"ad_kind":  map[string]any{"choice": "scam"},
				"ad_scope": map[string]any{"choice": "message"},
				"severity": map[string]any{"score": 2.5},
			}}
		}
		body, _ := json.Marshal(out)
		f.mu.Lock()
		f.lastResp = tail(string(body), 1200)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
		return
	}

	var content any
	f.mu.Lock()
	f.chats++
	if appeal {
		f.appeals++
	}
	f.lastReq = "POST " + r.URL.Path + " " + tail(string(raw), 1200)
	f.mu.Unlock()
	if f.fail {
		content = ""
	} else if appeal {
		content = `{"uphold":true,"confidence":0.9,"reason":"原文仍是引流广告，维持原判"}`
	} else {
		content = `{"is_ad":true,"kind":"scam","scope":"message","severity":2.5,` +
			`"delete":true,"mute":"forever","reason":"引流广告",` +
			`"evidence":["USDT 代收代付"]}`
	}

	body := map[string]any{
		"id": "e2e", "object": "chat.completion", "model": "fake",
		"choices": []map[string]any{{
			"index":         0,
			"message":       map[string]any{"role": "assistant", "content": content},
			"finish_reason": "stop",
		}},
		"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
	}
	out, _ := json.Marshal(body)
	f.mu.Lock()
	f.lastResp = tail(string(out), 1200)
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Write(out)
}

func (f *fakeModel) chatCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.chats
}

func (f *fakeModel) appealCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.appeals
}

// ---- 假 Turnstile siteverify ----

type fakeTurnstile struct {
	mu   sync.Mutex
	fail bool
	n    int
}

func (f *fakeTurnstile) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	f.mu.Lock()
	f.n++
	f.mu.Unlock()
	if f.fail {
		writeJSON(w, map[string]any{"success": false, "error-codes": []string{"invalid-input-response"}})
		return
	}
	// 申诉页把申诉单号放进 idempotency_key（"<id>-<纳秒>"），照它回 cdata。
	id, _, _ := strings.Cut(r.Form.Get("idempotency_key"), "-")
	writeJSON(w, map[string]any{
		"success": true, "hostname": "demo.local",
		"action": "appeal", "cdata": id,
	})
}

func (f *fakeTurnstile) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.n
}

// ---- 工具 ----

func (d *demo) baseURL() string { return fmt.Sprintf("http://127.0.0.1:%d", d.port) }

func (d *demo) postUpdate(v map[string]any) error {
	d.updateID++
	v["update_id"] = d.updateID
	raw, _ := json.Marshal(v)
	resp, err := http.Post(d.baseURL()+"/"+workerToken+"/webhook",
		"application/json", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("投递 webhook 失败：%v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("webhook 返回 %s：%s", resp.Status, tail(string(body), 300))
	}
	return nil
}

var appealLinkRe = regexp.MustCompile(`https?://[^\s<>"']+/_w/ap/[0-9]+/[0-9A-Za-z]+`)

// appealLink 从发给申诉人的私聊里取出验证链接（消息正文含 HTML 标签）。
func (d *demo) appealLink() (string, bool) {
	text, ok := d.tg.messageContaining(userID, "/_w/ap/")
	if !ok {
		return "", false
	}
	return appealLinkRe.FindString(text), appealLinkRe.MatchString(text)
}

func (d *demo) currentCode() string {
	var code string
	d.db.QueryRow(`SELECT code FROM appeals WHERE bot_id=? AND user_id=?
		ORDER BY id DESC LIMIT 1`, workerBotID, userID).Scan(&code)
	return code
}

func (d *demo) cleanup() {
	for i := len(d.cleans) - 1; i >= 0; i-- {
		d.cleans[i]()
	}
	if d.dir != "" {
		os.RemoveAll(d.dir)
	}
}

func (d *demo) addCleanup(fn func()) { d.cleans = append(d.cleans, fn) }

func (d *demo) stop() {
	if d.proc == nil || d.proc.Process == nil {
		return
	}
	d.proc.Process.Signal(syscall.SIGTERM)
	done := make(chan struct{})
	go func() { d.proc.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		d.proc.Process.Kill()
	}
	if d.logFile != nil {
		d.logFile.Close()
	}
}

func (d *demo) diagnostics() {
	if d.model != nil {
		d.model.mu.Lock()
		req, resp := d.model.lastReq, d.model.lastResp
		d.model.mu.Unlock()
		fmt.Fprintf(os.Stderr, "\n最近模型请求: %s\n最近模型响应: %s\n", orNone(req), orNone(resp))
	}
	if d.tg != nil {
		method, payload := d.tg.lastCall()
		fmt.Fprintf(os.Stderr, "最近 Telegram 调用: %s %s\n", orNone(method), orNone(payload))
	}
	if d.lastWeb != "" {
		fmt.Fprintf(os.Stderr, "最近网页验证响应: %s\n", d.lastWeb)
	}
	if d.logFile != nil {
		if raw, err := os.ReadFile(d.logFile.Name()); err == nil {
			fmt.Fprintf(os.Stderr, "\nmenshen 日志尾部:\n%s\n", tail(string(raw), 4000))
		}
	}
}

func childEnv() []string {
	out := make([]string, 0, len(os.Environ())+2)
	for _, kv := range os.Environ() {
		key, _, _ := strings.Cut(kv, "=")
		switch {
		case strings.HasPrefix(key, "MENSHEN_"),
			strings.EqualFold(key, "http_proxy"),
			strings.EqualFold(key, "https_proxy"),
			strings.EqualFold(key, "all_proxy"):
			continue
		}
		out = append(out, kv)
	}
	return append(out, "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func num(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	case json.Number:
		n, _ := t.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(t, 10, 64)
		return n
	}
	return 0
}

func waitFor(timeout time.Duration, what string, fn func() (bool, error)) error {
	deadline := time.Now().Add(timeout)
	var last error
	for {
		ok, err := fn()
		if err != nil {
			last = err
		}
		if ok {
			return nil
		}
		if time.Now().After(deadline) {
			if last != nil {
				return fmt.Errorf("%s：超时（最近状态：%v）", what, last)
			}
			return fmt.Errorf("%s：超时", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

type stepError struct {
	n    int
	name string
	err  error
}

func (e stepError) Error() string { return fmt.Sprintf("步骤 %d %s：%v", e.n, e.name, e.err) }
func (e stepError) Unwrap() error { return e.err }

func step(n int, name string, fn func() error) error {
	if err := fn(); err != nil {
		return stepError{n: n, name: name, err: err}
	}
	return nil
}

func tail(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return "…" + string(r[len(r)-n:])
}

func orNone(s string) string {
	if s == "" {
		return "（无）"
	}
	return s
}
