package panel

import (
	"strings"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/testutil"
	"menshen/internal/tg"
)

// seedTimedLog 落一条指定时间、判定与类型的流水。
func seedTimedLog(t *testing.T, b *core.Bot, at int64, verdict, kind, action string, cost int64) {
	t.Helper()
	if _, err := b.Store.Write.Exec(`INSERT INTO antiad_log
		(chat_id,user_id,message_id,text,verdict,confidence,decider,ad_kind,
		 action,reason,quota_cost,created_at,bot_id)
		VALUES (-100,555,7,'x',?,0.9,'systemone',?,?,'',?,?,?)`,
		verdict, kind, action, cost, at, b.BotID()); err != nil {
		t.Fatal(err)
	}
}

// TestStatusCommandCountsWindow：近 24 小时的送检 / 命中 / 失败 / 未送检 /
// 误判 / 开销都要计入，窗口外的历史不计。
func TestStatusCommandCountsWindow(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	now := time.Now().Unix()
	old := now - 48*3600

	seedTimedLog(t, b, now, "ad", "scam", "deleted_muted", 100)
	seedTimedLog(t, b, now, "ad", "promo", "deleted", 50)
	seedTimedLog(t, b, now, "clean", "", "none", 20)
	seedTimedLog(t, b, now, "error", "", "none", 0)
	seedTimedLog(t, b, now, "skipped", "", "none", 0)
	seedTimedLog(t, b, now, "ad", "scam", "undone", 10)
	// 窗口外：一条都不能进统计。
	seedTimedLog(t, b, old, "ad", "scam", "deleted_muted", 999)

	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (-100,1,555,'x',?),
		(-100,2,555,'y',?)`, now, old); err != nil {
		t.Fatal(err)
	}
	// 群配置：生效群 1 个，留底统计才圈得到 -100。
	testutil.EnableAntiad(t, b, -100)
	// 一张未结申诉单：状态在 AppealOpenStatusesSQL 里就要计入。
	if _, err := b.Store.Write.Exec(`INSERT INTO appeals
		(bot_id,user_id,status,created_at,updated_at) VALUES (?,?,'ai',?,?)`,
		b.BotID(), 555, now, now); err != nil {
		t.Fatal(err)
	}

	HandleStatusCommand(b, &tg.Message{
		Chat: &tg.Chat{ID: 1, Type: "private"},
		From: &tg.TGUser{ID: 1}, Text: "/status",
	})
	p := fake.LastCall("sendMessage")
	if p == nil {
		t.Fatal("/status 应发送状态消息")
	}
	text := p["text"].(string)
	for _, want := range []string{
		"运行状态",
		"送检 5 条：广告 3 · 正常 1 · 失败 1",
		"未送检 1 条 ｜ 误判 1 条",
		"群消息留底 1 条",
		"未结申诉 1 个",
		"命中类型",
		"诈骗 2",           // scam 两条（含误判那条）
		"开销 $0.00036000", // 窗口内 100+50+20+10 = 180 quota
	} {
		if !strings.Contains(text, want) {
			t.Errorf("状态消息缺少 %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "$0.00200000") { // 999 quota 的窗口外记录
		t.Errorf("窗口外的开销不该计入:\n%s", text)
	}
}

// TestStatusCommandRespectsTenancy：次级管理员只看自己名下 bot 的流水，
// 别人的记录既不进统计也不进命中类型。
func TestStatusCommandRespectsTenancy(t *testing.T) {
	b, fake, sh := testutil.NewTestBotOwned(t, 1, 100)
	if err := sh.AddAdmin(200, "另一个次管", 1); err != nil {
		t.Fatal(err)
	}
	// 归属人也要是服务管理员才用得了命令（dispatch 与面板同一道门）。
	if err := sh.AddAdmin(100, "归属人", 1); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	seedTimedLog(t, b, now, "ad", "gambling", "deleted_muted", 0)

	// 次管 200 名下没有 bot：查询被 AND 0 过滤，数字全为 0。
	HandleStatusCommand(b, &tg.Message{
		Chat: &tg.Chat{ID: 200, Type: "private"},
		From: &tg.TGUser{ID: 200}, Text: "/status",
	})
	p := fake.LastCall("sendMessage")
	if p == nil {
		t.Fatal("次级管理员也应得到状态消息")
	}
	text := p["text"].(string)
	if strings.Contains(text, "博彩") || !strings.Contains(text, "送检 0 条") {
		t.Errorf("次管不该看到别人 bot 的流水:\n%s", text)
	}

	// 归属人看到同一条记录。
	fake.Reset()
	HandleStatusCommand(b, &tg.Message{
		Chat: &tg.Chat{ID: 100, Type: "private"},
		From: &tg.TGUser{ID: 100}, Text: "/status",
	})
	p = fake.LastCall("sendMessage")
	if p == nil || !strings.Contains(p["text"].(string), "送检 1 条") {
		t.Fatalf("归属人应看到自己的流水: %v", p)
	}
}

// TestStatusCommandIgnoresNonStaff：非管理员发 /status 不得得到任何回复，
// 否则等于确认管理入口存在。
func TestStatusCommandIgnoresNonStaff(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	HandleStatusCommand(b, &tg.Message{
		Chat: &tg.Chat{ID: 12345, Type: "private"},
		From: &tg.TGUser{ID: 12345}, Text: "/status",
	})
	if n := fake.CountCalls("sendMessage"); n != 0 {
		t.Errorf("非管理员不该收到状态消息，发了 %d 条", n)
	}
}

// TestFormatUptime：运行时长按天/时/分/秒分档。
func TestFormatUptime(t *testing.T) {
	cases := []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "30 秒"},
		{5*time.Minute + 3*time.Second, "5 分 3 秒"},
		{2*time.Hour + 4*time.Minute, "2 小时 4 分"},
		{50 * time.Hour, "2 天 2 小时"},
		{-time.Minute, "0 秒"},
	}
	for _, c := range cases {
		if got := formatUptime(c.d); got != c.want {
			t.Errorf("formatUptime(%v) = %q，期望 %q", c.d, got, c.want)
		}
	}
}

// TestStatusShowsRunningBots：有 Registry 时，「运行中」按实例是否存在统计，
// 停用的 bot 记录仍在表里但不算运行。
func TestStatusShowsRunningBots(t *testing.T) {
	_, b := testutil.NewTestRegistry(t, dispatch)
	fake := b.TG.(*testutil.FakeTG)

	HandleStatusCommand(b, &tg.Message{
		Chat: &tg.Chat{ID: 777, Type: "private"},
		From: &tg.TGUser{ID: 777}, Text: "/status",
	})
	p := fake.LastCall("sendMessage")
	if p == nil {
		t.Fatal("/status 应发送状态消息")
	}
	if text := p["text"].(string); !strings.Contains(text, "机器人 1 个（启用 1 · 运行中 1）") {
		t.Errorf("应显示 1 个运行中的 bot:\n%s", text)
	}
}
