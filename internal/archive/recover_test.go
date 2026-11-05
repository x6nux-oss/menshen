package archive

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// visionInput 造一条与 antiad.logAICall 落库形状一致的识图请求体。
func visionInput(b64 string, truncated bool) string {
	s := `{"messages":[{"content":"You are an image content reporter.","role":"system"},` +
		`{"content":[{"text":"Describe this image.","type":"text"},` +
		`{"image_url":{"url":"data:image/jpeg;base64,` + b64 + `"},"type":"image_url"}],` +
		`"role":"user"}],"stream":true}`
	if truncated {
		s += "\n…（已截断，原文 99999 字节）"
	}
	return s
}

// TestRedactImageDataURLs：按顺序替换，空 ref 保留该帧的 base64。
func TestRedactImageDataURLs(t *testing.T) {
	input := []byte(`{"a":"data:image/jpeg;base64,AAAA","b":"data:image/png;base64,BBBB"}`)
	out := string(RedactImageDataURLs(input, []string{"x/1_0.*", ""}))
	if strings.Contains(out, "AAAA") || strings.Contains(out, "data:image/jpeg") {
		t.Errorf("第一张应替换: %s", out)
	}
	if !strings.Contains(out, "«图片已存档: x/1_0.*»") {
		t.Errorf("占位符不对: %s", out)
	}
	if !strings.Contains(out, "data:image/png;base64,BBBB") {
		t.Errorf("空 ref 应保留原 base64: %s", out)
	}
	if got := string(RedactImageDataURLs(input, nil)); got != string(input) {
		t.Errorf("没有 refs 时不应改动")
	}
}

func TestExportRecoversImageFromAILog(t *testing.T) {
	const chatID = int64(-1001234)
	b, _, root := archiveBot(t, chatID)
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 5, 42, "［图片］图中文字：加微信 abc123", 1700000000); err != nil {
		t.Fatal(err)
	}

	img := jpegBytes(t, 320, 200)
	b64 := base64.StdEncoding.EncodeToString(img)
	res, err := b.Store.Write.Exec(`INSERT INTO ai_log
		(ts,endpoint,status,input,output) VALUES (?,?,?,?,?)`,
		1700000005, "chat", "ok", visionInput(b64, false),
		`{"choices":[{"message":{"content":"图中文字：加微信 abc123"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	logID, _ := res.LastInsertId()

	st, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if st.Recovered != 1 || st.Partial != 0 {
		t.Fatalf("找回计数不对: %+v", st)
	}
	if st.Rewritten != 1 {
		t.Errorf("识图流水应改写成占位符，rewritten=%d", st.Rewritten)
	}
	var input string
	if err := b.Store.Read.QueryRow(`SELECT input FROM ai_log WHERE id=?`, logID).
		Scan(&input); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(input, "data:image/") {
		t.Errorf("ai_log 里仍带 base64: %s", input)
	}
	if !strings.Contains(input, "«图片已存档:") ||
		!strings.Contains(input, "5_hist_"+strconv.FormatInt(logID, 10)+"_0.") {
		t.Errorf("占位符没有指向存档文件: %s", input)
	}
	pattern := filepath.Join(root, strconv.FormatInt(chatID, 10), "images",
		dayOf(1700000000), "5_hist_"+strconv.FormatInt(logID, 10)+"_0.*")
	got, _ := filepath.Glob(pattern)
	if len(got) != 1 {
		t.Fatalf("图片未落盘: %v", got)
	}
	data, err := os.ReadFile(got[0])
	if err != nil || len(data) == 0 {
		t.Fatalf("读图片: %v", err)
	}

	// 再导一次不重复写。
	st2, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if st2.Recovered != 0 {
		t.Errorf("二次导出不应重复找回: %+v", st2)
	}
}

func TestExportRecoversPartialImage(t *testing.T) {
	const chatID = int64(-1001235)
	b, _, root := archiveBot(t, chatID)
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 6, 42, "［图片］截断图的描述", 1700000100); err != nil {
		t.Fatal(err)
	}

	img := jpegBytes(t, 800, 600)
	b64 := base64.StdEncoding.EncodeToString(img)
	// 截掉后半段并带上落库层的截断标记。
	b64 = b64[:len(b64)*3/5]
	res, err := b.Store.Write.Exec(`INSERT INTO ai_log
		(ts,endpoint,status,input,output) VALUES (?,?,?,?,?)`,
		1700000105, "chat", "ok", visionInput(b64, true),
		`{"choices":[{"message":{"content":"截断图的描述"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	logID, _ := res.LastInsertId()

	st, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if st.Partial != 1 || st.Recovered != 0 {
		t.Fatalf("截断图片计数不对: %+v", st)
	}
	if st.Rewritten != 1 {
		t.Errorf("截断图片也应改写占位符，rewritten=%d", st.Rewritten)
	}
	var input string
	if err := b.Store.Read.QueryRow(`SELECT input FROM ai_log WHERE id=?`, logID).
		Scan(&input); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(input, "data:image/") || !strings.Contains(input, ".partial.jpg") {
		t.Errorf("占位符应指向 .partial 文件: %s", input)
	}
	pattern := filepath.Join(root, strconv.FormatInt(chatID, 10), "images",
		dayOf(1700000100), "6_hist_"+strconv.FormatInt(logID, 10)+"_0.partial.jpg")
	if _, err := os.Stat(pattern); err != nil {
		t.Errorf("截断图片未保存: %v", err)
	}
}

// TestRecoverSkipsUnmatchedImage：匹配不到本群消息时不乱塞图片。
func TestRecoverSkipsUnmatchedImage(t *testing.T) {
	const chatID = int64(-1001236)
	b, _, root := archiveBot(t, chatID)
	if _, err := b.Store.Write.Exec(`INSERT INTO group_messages
		(chat_id,message_id,user_id,text,at) VALUES (?,?,?,?,?)`,
		chatID, 7, 42, "无关的聊天内容", 1700000200); err != nil {
		t.Fatal(err)
	}
	img := jpegBytes(t, 100, 100)
	b64 := base64.StdEncoding.EncodeToString(img)
	if _, err := b.Store.Write.Exec(`INSERT INTO ai_log
		(ts,endpoint,status,input,output) VALUES (?,?,?,?,?)`,
		1700000205, "chat", "ok", visionInput(b64, false),
		`{"choices":[{"message":{"content":"另一个群的图片描述"}}]}`); err != nil {
		t.Fatal(err)
	}

	st, err := ExportChat(b, chatID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if st.Recovered != 0 || st.Partial != 0 {
		t.Errorf("不该导出未匹配的图片: %+v", st)
	}
	imgs := filepath.Join(root, strconv.FormatInt(chatID, 10), "images")
	if entries, err := os.ReadDir(imgs); err == nil && len(entries) > 0 {
		t.Errorf("不该建图片目录: %v", entries)
	}
}

// TestExtractDataURLsKeepsFrames：视频多帧请求里，截断只影响最后一帧。
func TestExtractDataURLsKeepsFrames(t *testing.T) {
	a := base64.StdEncoding.EncodeToString(jpegBytes(t, 20, 20))
	b := a[:len(a)/2]
	input := `[{"url":"data:image/jpeg;base64,` + a + `"},` +
		`{"url":"data:image/jpeg;base64,` + b + `"}]` +
		"\n…（已截断，原文 99999 字节）"
	imgs := extractDataURLs(input)
	if len(imgs) != 2 {
		t.Fatalf("应抠出 2 张，得到 %d", len(imgs))
	}
	if imgs[0].partial {
		t.Error("第一帧完整")
	}
	if !imgs[1].partial {
		t.Error("最后一帧被截断")
	}
	if !strings.HasSuffix(imgs[0].mime, "jpeg") {
		t.Errorf("mime=%q", imgs[0].mime)
	}
}
