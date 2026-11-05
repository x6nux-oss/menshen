package antiad

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"menshen/internal/testutil"
	"menshen/internal/tg"
)

// TestExportCommandDM：主管理员按 chat_id 直接导出历史记录，文件落到存档目录。
func TestExportCommandDM(t *testing.T) {
	const chatID = int64(-1001234)
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	root := t.TempDir()
	b.Cfg.ArchiveDir = root

	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 3, 42, "历史消息", 1700000000); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO antiad_log
		(chat_id,user_id,message_id,text,verdict,confidence,decider,ad_kind,
		 action,reason,created_at,bot_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		chatID, 42, 3, "历史消息", "ad", 0.95, "llm", "spam",
		"deleted", "", 1700000000, b.BotID()); err != nil {
		t.Fatal(err)
	}

	dm := &tg.Message{MessageID: 9, Chat: &tg.Chat{ID: 1, Type: "private"},
		From: &tg.TGUser{ID: 1}, Text: "/export " + strconv.FormatInt(chatID, 10)}
	HandleExportCommandDM(b, dm, strconv.FormatInt(chatID, 10))

	calls := fake.Calls("sendMessage")
	if len(calls) == 0 {
		t.Fatal("应回复导出开始")
	}
	text, _ := calls[len(calls)-1]["text"].(string)
	if !strings.Contains(text, "正在导出") {
		t.Errorf("应先回正在导出，得到: %s", text)
	}

	path := filepath.Join(root, strconv.FormatInt(chatID, 10),
		"messages-"+dayOfForTest(1700000000)+".jsonl")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("消息未导出: %s", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// 完成消息是异步发的，等它出现。
	for {
		calls = fake.Calls("sendMessage")
		last, _ := calls[len(calls)-1]["text"].(string)
		if strings.Contains(last, "消息：1") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("没等到导出完成消息，最后一条: %s", last)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func dayOfForTest(ts int64) string {
	// 存档默认时区 UTC+8（见 store.resolveLocation）。
	return time.Unix(ts, 0).In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02")
}
