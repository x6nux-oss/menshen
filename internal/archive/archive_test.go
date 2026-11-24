package archive

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"menshen/internal/config"
	"menshen/internal/core"
	"menshen/internal/testutil"
	"menshen/internal/tg"
)

// archiveBot 建一个开启了存档的测试 bot，存档根目录指向临时目录。
func archiveBot(t *testing.T, chatID int64) (*core.Bot, *testutil.FakeTG, string) {
	t.Helper()
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, chatID)
	if err := b.PutSetting("archive_enabled", "1"); err != nil {
		t.Fatalf("开启存档: %v", err)
	}
	// 这些用例的消息时间戳固定在 2023 年；关闭保留期，避免它们随当前时间
	// 漂移成「过期」而改变导出结果。保留期本身在 TestSweepAndExportRetention 里测。
	if err := b.PutSetting("archive_retention_days", "0"); err != nil {
		t.Fatalf("关闭归档保留期: %v", err)
	}
	root := t.TempDir()
	b.Cfg.ArchiveDir = root
	return b, fake, root
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: uint8(x ^ y), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 98}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读 %s: %v", path, err)
	}
	s := strings.TrimSpace(string(data))
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// dayOf 按存档默认时区（UTC+8）算日期目录，与 cache.Snapshot.Location 一致。
func dayOf(ts int64) string {
	return time.Unix(ts, 0).In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02")
}

// TestHandleMessageWritesPerChatJSONL：文本按群、按天写进 messages-*.jsonl。
func TestHandleMessageWritesPerChatJSONL(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)

	m := testutil.GroupMsg(chatID, 42, 7, "你好，存档")
	HandleMessage(b, m)

	path := filepath.Join(root, strconv.FormatInt(chatID, 10), "messages-"+dayOf(1700000000)+".jsonl")
	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("应有 1 行，得到 %d", len(lines))
	}
	var rec MessageRecord
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatalf("解析: %v", err)
	}
	if rec.Type != "message" || rec.Text != "你好，存档" || rec.Kind != "text" {
		t.Errorf("记录不对: %+v", rec)
	}
	if rec.ChatID != chatID || rec.MessageID != 7 || rec.UserID != 42 {
		t.Errorf("字段不对: %+v", rec)
	}
	if rec.Source != "live" {
		t.Errorf("source=%q", rec.Source)
	}

	// 同一条消息被另一个 bot 再投一次：去重索引保证不写第二行。
	HandleMessage(b, m)
	if lines := readLines(t, path); len(lines) != 1 {
		t.Errorf("重复投递不应重复写，得到 %d 行", len(lines))
	}
}

// TestHandleMessageSkipsCommandAndDisabled：命令不进存档，关掉开关后什么都不写。
func TestHandleMessageSkipsCommandAndDisabled(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)

	HandleMessage(b, testutil.GroupMsg(chatID, 42, 1, "/check 42"))
	if _, err := os.Stat(filepath.Join(root, strconv.FormatInt(chatID, 10))); !os.IsNotExist(err) {
		t.Errorf("命令不该建存档目录: %v", err)
	}

	if err := b.PutSetting("archive_enabled", "0"); err != nil {
		t.Fatal(err)
	}
	HandleMessage(b, testutil.GroupMsg(chatID, 42, 2, "关掉之后"))
	if _, err := os.Stat(filepath.Join(root, strconv.FormatInt(chatID, 10))); !os.IsNotExist(err) {
		t.Errorf("关掉开关后不该写存档: %v", err)
	}
}

// TestDocumentImageSavedAndCompressed：以文件形式发送的图片也会下载并压缩落盘。
func TestDocumentImageSavedAndCompressed(t *testing.T) {
	const chatID = int64(-1001234)
	b, fake, root := archiveBot(t, chatID)

	img := jpegBytes(t, 2400, 1200)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(img)
	}))
	defer srv.Close()
	b.Cfg.TGAPIBase = srv.URL
	fake.Resp["getFile"] = `{"ok":true,"result":{"file_path":"documents/x.jpg"}}`
	fake.Resp["getUserProfilePhotos"] = `{"ok":true,"result":{"total_count":0,"photos":[]}}`

	m := testutil.GroupMsg(chatID, 42, 9, "配文")
	m.Document = &tg.FileNamed{FileID: "doc1", FileUniqueID: "du1",
		FileName: "x.jpg", MimeType: "image/jpeg"}
	HandleMessage(b, m)
	WaitIdle()

	path := filepath.Join(root, strconv.FormatInt(chatID, 10),
		"images", dayOf(1700000000), "9_0.jpg")
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("图片未落盘: %v", err)
	}
	defer f.Close()
	cfg, err := jpeg.DecodeConfig(f)
	if err != nil {
		t.Fatalf("落盘的不是 JPEG: %v", err)
	}
	if cfg.Width > defaultImageMaxSide || cfg.Height > defaultImageMaxSide {
		t.Errorf("未按长边压缩: %dx%d", cfg.Width, cfg.Height)
	}

	// 记录里要有图片元信息，正文与配文都在。
	lines := readLines(t, filepath.Join(root, strconv.FormatInt(chatID, 10),
		"messages-"+dayOf(1700000000)+".jsonl"))
	var rec MessageRecord
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatal(err)
	}
	if len(rec.Images) != 1 || rec.Images[0].FileID != "doc1" {
		t.Errorf("图片元信息缺失: %+v", rec.Images)
	}
	if rec.Kind != "document_image" {
		t.Errorf("kind=%q", rec.Kind)
	}
}

// TestAvatarSaved：用户头像按群落盘，且 24 小时内不重复抓。
func TestAvatarSaved(t *testing.T) {
	const chatID = int64(-1001234)
	b, fake, root := archiveBot(t, chatID)

	img := jpegBytes(t, 300, 300)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(img)
	}))
	defer srv.Close()
	b.Cfg.TGAPIBase = srv.URL
	fake.Resp["getFile"] = `{"ok":true,"result":{"file_path":"photos/a.jpg"}}`
	fake.Resp["getUserProfilePhotos"] = `{"ok":true,"result":{"total_count":1,` +
		`"photos":[[{"file_id":"av1","file_unique_id":"avu1","width":300,"height":300}]]}}`

	HandleMessage(b, testutil.GroupMsg(chatID, 42, 1, "第一条"))
	WaitIdle()

	path := filepath.Join(root, strconv.FormatInt(chatID, 10), "avatars", "42.jpg")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("头像未落盘: %v", err)
	}

	fake.Reset()
	HandleMessage(b, testutil.GroupMsg(chatID, 42, 2, "第二条"))
	WaitIdle()
	if n := fake.CountCalls("getUserProfilePhotos"); n != 0 {
		t.Errorf("24 小时内不该重复抓头像，实际 %d 次", n)
	}
}

// TestRecordJudgment：antiad_log 的判定流水写进 judgments-*.jsonl。
func TestRecordJudgment(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)

	res, err := b.Store.Write.Exec(`INSERT INTO antiad_log
		(chat_id,user_id,message_id,text,verdict,confidence,decider,ad_kind,
		 action,reason,prompt_tokens,completion_tokens,quota_cost,created_at,
		 bot_id,user_name,so_verdict,llm_verdict)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		chatID, 42, 7, "加微信 abc", "ad", 0.91, "llm", "spam",
		"deleted_muted", "证据：微信", 10, 20, 30, 1700000000,
		b.BotID(), "广告号", `{"confidence":0.91}`, `{"is_ad":true}`)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	RecordJudgment(b, id)

	lines := readLines(t, filepath.Join(root, strconv.FormatInt(chatID, 10),
		"judgments-"+dayOf(1700000000)+".jsonl"))
	if len(lines) != 1 {
		t.Fatalf("应有 1 行，得到 %d", len(lines))
	}
	var rec JudgmentRecord
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatal(err)
	}
	if rec.ID != id || rec.Verdict != "ad" || rec.Decider != "llm" || rec.Kind != "spam" {
		t.Errorf("字段不对: %+v", rec)
	}
	if len(rec.SoVerdict) == 0 || len(rec.LlmVerdict) == 0 {
		t.Errorf("两级结论应作为 JSON 保留: %+v", rec)
	}

	// 重复调用不重复写。
	RecordJudgment(b, id)
	if lines := readLines(t, filepath.Join(root, strconv.FormatInt(chatID, 10),
		"judgments-"+dayOf(1700000000)+".jsonl")); len(lines) != 1 {
		t.Errorf("重复入档不应重复写，得到 %d 行", len(lines))
	}
}

// TestExportChatExportsSQLiteHistory：旧库里的消息与判定都导出来，重复导出不重复写。
func TestExportChatExportsSQLiteHistory(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)

	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 1, 42, "旧消息一", 1700000000); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 2, 42, "旧消息二", 1700000100); err != nil {
		t.Fatal(err)
	}
	res, err := b.Store.Write.Exec(`INSERT INTO antiad_log
		(chat_id,user_id,message_id,text,verdict,confidence,decider,ad_kind,
		 action,reason,created_at,bot_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		chatID, 42, 2, "旧消息二", "clean", 0.9, "systemone", "none",
		"none", "", 1700000100, b.BotID())
	if err != nil {
		t.Fatal(err)
	}
	logID, _ := res.LastInsertId()

	st, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatalf("导出: %v", err)
	}
	if st.Messages != 2 || st.Judgments != 1 {
		t.Fatalf("计数不对: %+v", st)
	}

	msgPath := filepath.Join(root, strconv.FormatInt(chatID, 10), "messages-"+dayOf(1700000000)+".jsonl")
	if lines := readLines(t, msgPath); len(lines) != 2 {
		t.Errorf("消息应有 2 行，得到 %d", len(lines))
	}
	judPath := filepath.Join(root, strconv.FormatInt(chatID, 10), "judgments-"+dayOf(1700000000)+".jsonl")
	lines := readLines(t, judPath)
	if len(lines) != 1 {
		t.Fatalf("判定应有 1 行，得到 %d", len(lines))
	}
	var rec JudgmentRecord
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatal(err)
	}
	if rec.ID != logID || rec.Source != "export" {
		t.Errorf("导出记录不对: %+v", rec)
	}

	// 再导一次：全部已入档，不新增行。
	st2, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatalf("二次导出: %v", err)
	}
	if st2.Messages != 0 || st2.Judgments != 0 || st2.Skipped != 3 {
		t.Errorf("二次导出应全部跳过: %+v", st2)
	}
	if lines := readLines(t, msgPath); len(lines) != 2 {
		t.Errorf("二次导出写了重复行: %d", len(lines))
	}
}

// TestExportChatFiltersOtherTenants：次管导出时只能拿到自己 bot 的判定流水。
func TestExportChatFiltersOtherTenants(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)

	for _, row := range []struct {
		botID int64
		text  string
	}{{b.BotID(), "自己的"}, {999, "别人的"}} {
		if _, err := b.Store.Write.Exec(`INSERT INTO antiad_log
			(chat_id,user_id,message_id,text,verdict,confidence,decider,ad_kind,
			 action,reason,created_at,bot_id)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			chatID, 42, 1, row.text, "clean", 0.9, "systemone", "none",
			"none", "", 1700000000, row.botID); err != nil {
			t.Fatal(err)
		}
	}

	st, err := ExportChat(b, chatID, []int64{b.BotID()})
	if err != nil {
		t.Fatal(err)
	}
	if st.Judgments != 1 {
		t.Fatalf("只应导出自己的 1 条，得到 %+v", st)
	}
	data, _ := os.ReadFile(filepath.Join(root, strconv.FormatInt(chatID, 10),
		"judgments-"+dayOf(1700000000)+".jsonl"))
	if strings.Contains(string(data), "别人的") {
		t.Errorf("导出了别家租户的判定")
	}
}

// TestCompressImageKeepsSmallFile：小图重编码更大时保留原图，不把「压缩」压大。
func TestCompressImageKeepsSmallFile(t *testing.T) {
	data := jpegBytes(t, 64, 64)
	out, ext, err := compressImage(data, 1600, 60)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) > len(data) {
		t.Errorf("输出比原图大: %d > %d", len(out), len(data))
	}
	if ext != ".jpg" && ext != ".jpeg" {
		t.Errorf("ext=%q", ext)
	}
}

// TestSweepRemovesExpiredAndHardens：过期文件按文件名日期删除，权限纠正为
// 0600/0700，空日期目录一并回收。
func TestSweepRemovesExpiredAndHardens(t *testing.T) {
	root := t.TempDir()
	cfg := &config.Config{DBPath: filepath.Join(root, "data.db"), ArchiveDir: root}
	now := time.Now().In(time.UTC)
	oldDay := now.AddDate(0, 0, -40).Format("2006-01-02")
	newDay := now.Format("2006-01-02")
	chat := filepath.Join(root, "-100")

	oldJSONL := filepath.Join(chat, "messages-"+oldDay+".jsonl")
	newJSONL := filepath.Join(chat, "messages-"+newDay+".jsonl")
	oldImage := filepath.Join(chat, "images", oldDay, "1_0.jpg")
	newImage := filepath.Join(chat, "images", newDay, "2_0.jpg")
	oldAvatar := filepath.Join(chat, "avatars", "1.jpg")
	newAvatar := filepath.Join(chat, "avatars", "2.jpg")
	for _, p := range []string{oldJSONL, newJSONL, oldImage, newImage, oldAvatar, newAvatar} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(`{"type":"message"}`+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	past := now.AddDate(0, 0, -40)
	os.Chtimes(oldAvatar, past, past)

	Sweep(cfg, 30, time.UTC)

	for _, p := range []string{oldJSONL, oldImage, oldAvatar} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("过期文件应删除: %s (%v)", p, err)
		}
	}
	for _, p := range []string{newJSONL, newImage, newAvatar} {
		info, err := os.Stat(p)
		if err != nil {
			t.Errorf("未过期文件被删: %s", p)
			continue
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("%s 权限 = %o，期望 600", p, info.Mode().Perm())
		}
	}
	if info, err := os.Stat(chat); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("群目录权限未纠正: %v", err)
	}
	if _, err := os.Stat(filepath.Join(chat, "images", oldDay)); !os.IsNotExist(err) {
		t.Errorf("空日期目录应回收: %v", err)
	}
}

// TestExportSkipsExpiredRecords：保留期之外的历史不补写进归档，避免刚清完
// 又被 /export 写回来。
func TestExportSkipsExpiredRecords(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)
	if err := b.PutSetting("archive_retention_days", "30"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 1, 42, "很久以前", 1700000000); err != nil {
		t.Fatal(err)
	}
	st, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if st.Messages != 0 || st.Skipped != 1 {
		t.Fatalf("过期记录应跳过: %+v", st)
	}
	if _, err := os.Stat(filepath.Join(root, strconv.FormatInt(chatID, 10),
		"messages-"+dayOf(1700000000)+".jsonl")); !os.IsNotExist(err) {
		t.Errorf("不应为过期记录建归档文件: %v", err)
	}
}

// TestFileKeys：去重兜底能认出文件里已有的消息与判定。
func TestFileKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.jsonl")
	data := `{"type":"message","message_id":7}` + "\n" +
		`{"type":"judgment","id":9}` + "\n" +
		`垃圾行` + "\n"
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	keys := fileKeys(path)
	if !keys["m:7"] || !keys["j:9"] {
		t.Errorf("keys = %v", keys)
	}
	if len(keys) != 2 {
		t.Errorf("应只有 2 个键，得到 %v", keys)
	}
}
