package antiad

import (
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"menshen/internal/core"
	"menshen/internal/testutil"
)

// ocrAI 起假上游：OCR 模型与识图模型分别计数，systemone 记下收到的正文。
func ocrAI(t *testing.T, b *core.Bot, ocrReply, visionReply string) (
	seen *atomic.Value, ocrN, visionN *atomic.Int32) {

	t.Helper()
	seen, ocrN, visionN = new(atomic.Value), new(atomic.Int32), new(atomic.Int32)
	seen.Store("")
	fakeAI(t, b, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/systemone"):
			seen.Store(string(body))
			w.Write([]byte(soReply("clean", 0.9, "none", "message")))
		case strings.Contains(string(body), `"ocr-model"`):
			ocrN.Add(1)
			w.Write([]byte(`{"choices":[{"message":{"content":"` + ocrReply + `"}}]}`))
		case strings.Contains(string(body), `"vision-model"`):
			visionN.Add(1)
			w.Write([]byte(`{"choices":[{"message":{"content":"` + visionReply + `"}}]}`))
		default:
			w.Write([]byte(llmReply(false, 0.9, "none", "message")))
		}
	})
	return seen, ocrN, visionN
}

// viewBody 把请求体里的 HTML 转义还原，方便直接断言 <ocr> 标签。
func viewBody(s string) string {
	return strings.NewReplacer(`\u003c`, "<", `\u003e`, ">").Replace(s)
}

// TestOCRFirstRendersTag：配了 OCR 模型时优先逐字转写，以
// `<image id=消息ID><ocr>原文</ocr></image>` 进正文，不再调识图模型。
func TestOCRFirstRendersTag(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	seen, ocrN, visionN := ocrAI(t, b, `加微信 abc123\n领福利`, "画面描述")
	for k, v := range map[string]string{
		"antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model",
	} {
		if err := b.PutSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(7, "u-ocr"))
	waitIdle(t, b)

	body := viewBody(seen.Load().(string))
	if !strings.Contains(body, "<image id=7><ocr>加微信 abc123 领福利</ocr></image>") {
		t.Fatalf("送检正文应带 OCR 标签，得到 %s", body)
	}
	if ocrN.Load() != 1 || visionN.Load() != 0 {
		t.Errorf("OCR 命中后不该再调识图：OCR %d 次、识图 %d 次",
			ocrN.Load(), visionN.Load())
	}
	var text string
	b.Store.Read.QueryRow(`SELECT text FROM group_messages WHERE message_id=7`).Scan(&text)
	if !strings.Contains(text, "<image id=7><ocr>") {
		t.Errorf("留底应带 OCR 标签，得到 %q", text)
	}
}

// TestOCRNoTextFallsBackToVision：OCR 明确回答没有文字时才回落识图模型，
// 画面类信息（二维码、色情）不能因为 OCR 为空就丢掉。
func TestOCRNoTextFallsBackToVision(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	seen, ocrN, visionN := ocrAI(t, b, ocrNoText, "画面里有一张二维码")
	for k, v := range map[string]string{
		"antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model",
	} {
		if err := b.PutSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(8, "u-no-text"))
	waitIdle(t, b)

	body := viewBody(seen.Load().(string))
	if !strings.Contains(body, "画面里有一张二维码") {
		t.Fatalf("OCR 没有文字时应回落识图描述，得到 %s", body)
	}
	if strings.Contains(body, "<image id=8><ocr>") {
		t.Errorf("没有文字时不该生成空 OCR 标签: %s", body)
	}
	if ocrN.Load() != 1 || visionN.Load() != 1 {
		t.Errorf("应各调一次：OCR %d 次、识图 %d 次", ocrN.Load(), visionN.Load())
	}
}

// TestOCRAloneEnablesImageJudge：只配 OCR 模型、没配识图模型时，纯图也判；
// 否则 OCR 配了等于没生效。
func TestOCRAloneEnablesImageJudge(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	seen, ocrN, visionN := ocrAI(t, b, "日入5000 加微 abc123", "画面描述")
	if err := b.PutSetting("antiad_ocr_model", "ocr-model"); err != nil {
		t.Fatal(err)
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(9, "u-ocr-only"))
	waitIdle(t, b)

	body := viewBody(seen.Load().(string))
	if !strings.Contains(body, "<image id=9><ocr>日入5000 加微 abc123</ocr></image>") {
		t.Fatalf("只配 OCR 时纯图也应送检并带 OCR 标签，得到 %s", body)
	}
	if ocrN.Load() != 1 || visionN.Load() != 0 {
		t.Errorf("只应调 OCR：OCR %d 次、识图 %d 次", ocrN.Load(), visionN.Load())
	}
}

// TestOCRNoTextViewPassesSilently：只配 OCR 且图里没有文字时，没有可判的
// 内容，直接放行，不记「判定失败」——图片没有文字不是故障。
func TestOCRNoTextViewPassesSilently(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	seen, ocrN, _ := ocrAI(t, b, ocrNoText, "")
	if err := b.PutSetting("antiad_ocr_model", "ocr-model"); err != nil {
		t.Fatal(err)
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(10, "u-empty"))
	waitIdle(t, b)

	if seen.Load().(string) != "" {
		t.Error("没有文字又没有识图模型时不该送检")
	}
	if ocrN.Load() != 1 {
		t.Errorf("应尝试一次 OCR，实际 %d 次", ocrN.Load())
	}
	var n int
	b.Store.Read.QueryRow(`SELECT COUNT(*) FROM antiad_log WHERE reason LIKE '%识图失败%'`).Scan(&n)
	if n != 0 {
		t.Errorf("没有文字不是失败，不该记识图失败流水（%d 条）", n)
	}
}

// TestOCRCache：同一张图重复投放时 OCR 只做一次。
func TestOCRCache(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	_, ocrN, visionN := ocrAI(t, b, "加微信 abc123", "画面描述")
	for k, v := range map[string]string{
		"antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model",
	} {
		if err := b.PutSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(11, "u-cache"))
	waitIdle(t, b)
	HandleGroupMessage(b, photoMsg(12, "u-cache"))
	waitIdle(t, b)

	if ocrN.Load() != 1 || visionN.Load() != 0 {
		t.Errorf("同一张图应只 OCR 一次：OCR %d 次、识图 %d 次",
			ocrN.Load(), visionN.Load())
	}
}

// TestOCRFailureFallsBackToVision：OCR 调用失败不是终局，继续用识图模型。
func TestOCRFailureFallsBackToVision(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	seen := new(atomic.Value)
	seen.Store("")
	var ocrN, visionN atomic.Int32
	fakeAI(t, b, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/systemone"):
			seen.Store(string(body))
			w.Write([]byte(soReply("clean", 0.9, "none", "message")))
		case strings.Contains(string(body), `"ocr-model"`):
			ocrN.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":{"message":"ocr unavailable"}}`))
		case strings.Contains(string(body), `"vision-model"`):
			visionN.Add(1)
			w.Write([]byte(`{"choices":[{"message":{"content":"画面描述"}}]}`))
		default:
			w.Write([]byte(llmReply(false, 0.9, "none", "message")))
		}
	})
	for k, v := range map[string]string{
		"antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model",
	} {
		if err := b.PutSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}
	fakeFiles(t, b, fake, 200)

	HandleGroupMessage(b, photoMsg(13, "u-fail"))
	waitIdle(t, b)

	body := viewBody(seen.Load().(string))
	if !strings.Contains(body, "画面描述") {
		t.Fatalf("OCR 失败后应回落识图，得到 %s", body)
	}
	if ocrN.Load() != 1 || visionN.Load() != 1 {
		t.Errorf("应各调一次：OCR %d 次、识图 %d 次", ocrN.Load(), visionN.Load())
	}
}

// TestVideoFramesOCRFirst：视频抽帧也先走 OCR，三帧一次请求带上去，
// 帧的时间点标注不能丢。
func TestVideoFramesOCRFirst(t *testing.T) {
	b, fake := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	videoFiles(t, b, fake, testVideo(t, 3))

	seen := new(atomic.Value)
	seen.Store("")
	ocrBody := new(atomic.Value)
	ocrBody.Store("")
	var ocrN, visionN atomic.Int32
	fakeAI(t, b, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/systemone"):
			seen.Store(string(body))
			w.Write([]byte(soReply("clean", 0.9, "none", "message")))
		case strings.Contains(string(body), `"ocr-model"`):
			ocrN.Add(1)
			ocrBody.Store(string(body))
			w.Write([]byte(`{"choices":[{"message":{"content":"Frame 1: 加微信 abc123"}}]}`))
		case strings.Contains(string(body), `"vision-model"`):
			visionN.Add(1)
			w.Write([]byte(`{"choices":[{"message":{"content":"画面描述"}}]}`))
		default:
			w.Write([]byte(llmReply(false, 0.9, "none", "message")))
		}
	})
	for k, v := range map[string]string{
		"antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model",
	} {
		if err := b.PutSetting(k, v); err != nil {
			t.Fatal(err)
		}
	}

	HandleGroupMessage(b, videoMsg(14, "v-ocr", 1024))
	waitIdle(t, b)

	body := viewBody(seen.Load().(string))
	if !strings.Contains(body, "<video id=14><ocr>Frame 1: 加微信 abc123</ocr></video>") {
		t.Fatalf("视频送检正文应带 OCR 标签，得到 %s", body)
	}
	req := ocrBody.Load().(string)
	if n := strings.Count(req, "data:image/jpeg;base64,"); n != 3 {
		t.Errorf("三帧应各带一张图，实际 %d 张", n)
	}
	for _, w := range []string{"at 0 s", "at 1 s", "at 2 s", "OCR engine"} {
		if !strings.Contains(req, w) {
			t.Errorf("OCR 请求里缺 %q", w)
		}
	}
	if ocrN.Load() != 1 || visionN.Load() != 0 {
		t.Errorf("视频也应 OCR 优先：OCR %d 次、识图 %d 次", ocrN.Load(), visionN.Load())
	}
}

// TestOCRText：OCR 响应的规整口径——哨兵、代码围栏、逐帧全部无文字。
func TestOCRText(t *testing.T) {
	cases := map[string]string{
		"NO_TEXT":                            "",
		"no_text。":                           "",
		"图片中没有文字":                            "",
		"```\n加微信 abc123\n```":               "加微信 abc123",
		"Frame 1: NO_TEXT":                   "",
		"Frame 1: NO_TEXT\nFrame 2: NO_TEXT": "",
		"Frame 1: NO_TEXT\nFrame 2: 加微信":     "Frame 1: NO_TEXT Frame 2: 加微信",
		"加微信\nabc123":                        "加微信 abc123",
	}
	for in, want := range cases {
		if got := ocrText(in); got != want {
			t.Errorf("ocrText(%q) = %q，期望 %q", in, got, want)
		}
	}
}
