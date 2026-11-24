package antiad

import (
	"strings"
	"sync"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/store"
	"menshen/internal/testutil"
)

// mergeAlertBot 建一个开了群内展示的测试 bot，并设定合并窗口。
func mergeAlertBot(t *testing.T, cooldown string) (*core.Bot, *testutil.FakeTG) {
	t.Helper()
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	if _, err := b.Store.Write.Exec(
		`UPDATE bot_chats SET group_alert=1 WHERE chat_id=-100`); err != nil {
		t.Fatal(err)
	}
	if err := b.PutBotSetting(b.BotID(), "antiad_alert_cooldown", cooldown); err != nil {
		t.Fatal(err)
	}
	if err := b.Cache.Reload(); err != nil {
		t.Fatal(err)
	}
	return b, fake
}

// fireMergeAlert 模拟一次命中，用户与消息号固定，只关心群内告警的去向。
func fireMergeAlert(b *core.Bot, conf store.BotChat) {
	sendAdAlert(b, conf, testutil.GroupMsg(-100, 555, 7, "日入过万 加我"),
		adVerdict{IsAd: true, Confidence: 0.95, Decider: "llm"},
		adAction{Delete: true, Alert: true, Name: "deleted"}, "", 9, false)
}

// TestGroupAlertMergesSameUser：同一用户窗口内多次命中只发一条，后两条
// 编辑最早那条并累计命中数（第 3 条仍继续合并，不受每分钟告警上限影响）。
func TestGroupAlertMergesSameUser(t *testing.T) {
	b, fake := mergeAlertBot(t, "600")
	conf := testutil.ChatConfOf(t, b, -100)

	fireMergeAlert(b, conf)
	fireMergeAlert(b, conf)
	fireMergeAlert(b, conf)

	if n := fake.CountCalls("sendMessage"); n != 1 {
		t.Fatalf("同一用户窗口内应只发一条告警，发了 %d 条", n)
	}
	edits := fake.Calls("editMessageText")
	if len(edits) != 2 {
		t.Fatalf("后两次命中应各编辑一次原告警，实际 %d 次", len(edits))
	}
	if id := int64(edits[0]["message_id"].(float64)); id != 1 {
		t.Errorf("应编辑最早那条告警（message_id=1），实际 %d", id)
	}
	text := edits[len(edits)-1]["text"].(string)
	if !strings.Contains(text, "该用户另有 2 条命中") {
		t.Errorf("编辑后的告警应累计命中数:\n%s", text)
	}
	if !strings.Contains(text, "–") {
		t.Errorf("编辑后的告警应带首末命中时间:\n%s", text)
	}
	if i, j := strings.Index(text, "该用户另有"), strings.Index(text, "点我申诉"); i < 0 || j < 0 || i > j {
		t.Errorf("命中行应插在链接之前:\n%s", text)
	}
}

// TestGroupAlertMergeSeparateUsers：合并只按 (群,人)，不同用户各发各的。
func TestGroupAlertMergeSeparateUsers(t *testing.T) {
	b, fake := mergeAlertBot(t, "600")
	conf := testutil.ChatConfOf(t, b, -100)

	fireMergeAlert(b, conf)
	sendAdAlert(b, conf, testutil.GroupMsg(-100, 556, 8, "另一个广告"),
		adVerdict{IsAd: true, Confidence: 0.95, Decider: "llm"},
		adAction{Delete: true, Alert: true, Name: "deleted"}, "", 10, false)

	if n := fake.CountCalls("sendMessage"); n != 2 {
		t.Errorf("不同用户应各发一条告警，发了 %d 条", n)
	}
	if n := fake.CountCalls("editMessageText"); n != 0 {
		t.Errorf("不同用户之间不该合并，编辑了 %d 次", n)
	}
}

// TestGroupAlertMergeDisabled：窗口为 0 时退回逐条发送，不编辑。
func TestGroupAlertMergeDisabled(t *testing.T) {
	b, fake := mergeAlertBot(t, "0")
	conf := testutil.ChatConfOf(t, b, -100)

	fireMergeAlert(b, conf)
	fireMergeAlert(b, conf)

	if n := fake.CountCalls("sendMessage"); n != 2 {
		t.Errorf("关闭合并后应逐条发送，发了 %d 条", n)
	}
	if n := fake.CountCalls("editMessageText"); n != 0 {
		t.Errorf("关闭合并后不该编辑，编辑了 %d 次", n)
	}
}

// TestGroupAlertMergeRepostWhenEditFails：原告警已被撤回/删除时编辑会失败，
// 此时重发一条新告警，并把窗口重置到这条上。
func TestGroupAlertMergeRepostWhenEditFails(t *testing.T) {
	b, fake := mergeAlertBot(t, "600")
	conf := testutil.ChatConfOf(t, b, -100)
	fireMergeAlert(b, conf)

	fake.Err["editMessageText"] = testutil.TGNotFound("editMessageText", "message to edit not found")
	fireMergeAlert(b, conf)
	if n := fake.CountCalls("sendMessage"); n != 2 {
		t.Fatalf("编辑失败后应重发一条告警，共发了 %d 条", n)
	}

	// 窗口已重置到新告警：恢复编辑后第 3 条继续合并进新消息，不再发第 3 条。
	delete(fake.Err, "editMessageText")
	fireMergeAlert(b, conf)
	if n := fake.CountCalls("sendMessage"); n != 2 {
		t.Errorf("重发后窗口应重新起算并继续合并，发了 %d 条", n)
	}
	edits := fake.Calls("editMessageText")
	if !strings.Contains(edits[len(edits)-1]["text"].(string), "该用户另有 1 条命中") {
		t.Errorf("新告警应展示它自己的累计命中数:\n%s", edits[len(edits)-1]["text"])
	}
}

// TestGroupAlertMergeWindowExpires：窗口过期后下一次命中重新发一条。
func TestGroupAlertMergeWindowExpires(t *testing.T) {
	b, fake := mergeAlertBot(t, "600")
	conf := testutil.ChatConfOf(t, b, -100)
	fireMergeAlert(b, conf)

	e := alertMerges(b).entry(alertMergeKey(b, -100, 555))
	e.mu.Lock()
	e.expires = time.Now().Add(-time.Second)
	e.mu.Unlock()

	fireMergeAlert(b, conf)
	if n := fake.CountCalls("sendMessage"); n != 2 {
		t.Errorf("窗口过期后应重新发一条，共发了 %d 条", n)
	}
	if n := fake.CountCalls("editMessageText"); n != 0 {
		t.Errorf("窗口过期后不该编辑旧告警，编辑了 %d 次", n)
	}
}

// TestGroupAlertMergeConcurrent：同一用户两条消息并发判定，至多一条初始告警。
func TestGroupAlertMergeConcurrent(t *testing.T) {
	b, fake := mergeAlertBot(t, "600")
	conf := testutil.ChatConfOf(t, b, -100)

	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); fireMergeAlert(b, conf) }()
	}
	wg.Wait()

	if n := fake.CountCalls("sendMessage"); n != 1 {
		t.Errorf("并发命中应只发一条初始告警，发了 %d 条", n)
	}
	if n := fake.CountCalls("editMessageText"); n != 1 {
		t.Errorf("后到的那条应合并进原告警，编辑了 %d 次", n)
	}
}
