package antiad

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/testutil"
)

func historyJPEG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 32, 32)),
		&jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func historyDay(ts int64) string {
	return time.Unix(ts, 0).In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02")
}

func swapHistoryRunner(t *testing.T, fn func(*core.Bot, int64, []int64) ([]historyMediaRow, error)) {
	t.Helper()
	old := historyMediaRunner
	historyMediaRunner = fn
	t.Cleanup(func() { historyMediaRunner = old })
}

// TestFetchHistoryImages：候选消息走 MTProto 下载后写进存档并记 ok。
func TestFetchHistoryImages(t *testing.T) {
	const chatID = int64(-1001234)
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	root := t.TempDir()
	b.Cfg.ArchiveDir = root
	b.Cfg.TGAPIID = 1
	b.Cfg.TGAPIHash = "hash"
	if err := b.PutSetting("archive_fetch_history", "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 11, 42, "［图片］历史图", 1700000000); err != nil {
		t.Fatal(err)
	}

	calls := 0
	swapHistoryRunner(t, func(_ *core.Bot, _ int64, ids []int64) ([]historyMediaRow, error) {
		calls++
		if len(ids) != 1 || ids[0] != 11 {
			t.Errorf("批次不对: %v", ids)
		}
		return []historyMediaRow{{MessageID: 11, MIME: "image/jpeg", Data: historyJPEG(t)}}, nil
	})

	res := fetchHistoryImages(b, chatID)
	if res.Candidates != 1 || res.Saved != 1 || res.Failed != 0 {
		t.Fatalf("结果不对: %+v", res)
	}
	pattern := filepath.Join(root, strconv.FormatInt(chatID, 10), "images",
		historyDay(1700000000), "11_tg.*")
	if got, _ := filepath.Glob(pattern); len(got) != 1 {
		t.Fatalf("图片未落盘: %v", got)
	}
	var status string
	if err := b.Store.Read.QueryRow(`SELECT status FROM archive_fetches
		WHERE chat_id=? AND message_id=?`, chatID, 11).Scan(&status); err != nil || status != "ok" {
		t.Errorf("状态应为 ok，得到 %q err=%v", status, err)
	}

	// 已 ok 的不再进候选，第二次不会调用脚本。
	if res2 := fetchHistoryImages(b, chatID); res2.Candidates != 0 || calls != 1 {
		t.Errorf("第二次不该再拉: %+v calls=%d", res2, calls)
	}
}

// TestFetchHistoryImagesSkipsExisting：已经有完整图片的消息不进候选。
func TestFetchHistoryImagesSkipsExisting(t *testing.T) {
	const chatID = int64(-1001235)
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	root := t.TempDir()
	b.Cfg.ArchiveDir = root
	b.Cfg.TGAPIID = 1
	b.Cfg.TGAPIHash = "hash"
	if err := b.PutSetting("archive_fetch_history", "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 12, 42, "［图片］已有图", 1700000000); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, strconv.FormatInt(chatID, 10), "images", historyDay(1700000000))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "12_0.jpg"), historyJPEG(t), 0o644); err != nil {
		t.Fatal(err)
	}

	calls := 0
	swapHistoryRunner(t, func(*core.Bot, int64, []int64) ([]historyMediaRow, error) {
		calls++
		return nil, nil
	})
	res := fetchHistoryImages(b, chatID)
	if res.Candidates != 0 || calls != 0 {
		t.Errorf("已有完整图不该回捞: %+v calls=%d", res, calls)
	}
}

// TestFetchHistoryImagesErrorRetry：脚本失败记 error，24 小时内不重试。
func TestFetchHistoryImagesErrorRetry(t *testing.T) {
	const chatID = int64(-1001236)
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	b.Cfg.ArchiveDir = t.TempDir()
	b.Cfg.TGAPIID = 1
	b.Cfg.TGAPIHash = "hash"
	if err := b.PutSetting("archive_fetch_history", "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 13, 42, "［贴纸］历史贴纸", 1700000000); err != nil {
		t.Fatal(err)
	}

	calls := 0
	swapHistoryRunner(t, func(*core.Bot, int64, []int64) ([]historyMediaRow, error) {
		calls++
		return nil, os.ErrDeadlineExceeded
	})
	res := fetchHistoryImages(b, chatID)
	if res.Failed != 1 || res.Reason == "" {
		t.Fatalf("失败计数不对: %+v", res)
	}
	var status string
	if err := b.Store.Read.QueryRow(`SELECT status FROM archive_fetches
		WHERE chat_id=? AND message_id=?`, chatID, 13).Scan(&status); err != nil || status != "error" {
		t.Errorf("状态应为 error，得到 %q err=%v", status, err)
	}
	if res2 := fetchHistoryImages(b, chatID); res2.Candidates != 0 || calls != 1 {
		t.Errorf("错后 24 小时内不该重试: %+v calls=%d", res2, calls)
	}
}

// TestFetchHistoryImagesSettingOff：开关关着时一次脚本都不跑。
func TestFetchHistoryImagesSettingOff(t *testing.T) {
	const chatID = int64(-1001237)
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	b.Cfg.ArchiveDir = t.TempDir()
	b.Cfg.TGAPIID = 1
	b.Cfg.TGAPIHash = "hash"
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 14, 42, "［图片］关闭开关", 1700000000); err != nil {
		t.Fatal(err)
	}
	calls := 0
	swapHistoryRunner(t, func(*core.Bot, int64, []int64) ([]historyMediaRow, error) {
		calls++
		return nil, nil
	})
	if res := fetchHistoryImages(b, chatID); res.Candidates != 0 || calls != 0 {
		t.Errorf("开关关闭时不该回捞: %+v calls=%d", res, calls)
	}
}
