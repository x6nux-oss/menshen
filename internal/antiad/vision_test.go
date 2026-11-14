package antiad

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"menshen/internal/core"
	"menshen/internal/localvision"
	"menshen/internal/testutil"
	"menshen/internal/tg"
)

var pngBytes = []byte("\x89PNG\r\n\x1a\n0000000000000000")

func fakeFiles(t *testing.T, bot *core.Bot, fake *testutil.FakeTG, status int) *atomic.Int32 {
	t.Helper()
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		downloads.Add(1)
		writer.WriteHeader(status)
		writer.Write(pngBytes)
	}))
	t.Cleanup(server.Close)
	bot.Cfg.TGAPIBase = server.URL
	fake.Resp["getFile"] = `{"ok":true,"result":{"file_path":"photos/x.png"}}`
	return &downloads
}

func visionAI(t *testing.T, bot *core.Bot) (*atomic.Value, *atomic.Int32) {
	t.Helper()
	seen, imageCalls := new(atomic.Value), new(atomic.Int32)
	seen.Store("")
	fakeAI(t, bot, func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		if strings.Contains(string(body), "image_url") {
			imageCalls.Add(1)
		}
		if strings.HasSuffix(request.URL.Path, "/systemone") {
			seen.Store(string(body))
			writer.Write([]byte(soReply("clean", 0.9, "none", "message")))
		} else {
			writer.Write([]byte(llmReply(false, 0.9, "none", "message")))
		}
	})
	enableLocalVision(t, bot)
	return seen, imageCalls
}

func photoMsg(msgID int64, unique string) *tg.Message {
	message := testutil.GroupMsg(-100, 42, msgID, "")
	message.Photo = []tg.PhotoSize{
		{FileID: "small", FileUniqueID: unique + "s", Width: 90, Height: 90},
		{FileID: "mid", FileUniqueID: unique, Width: 1280, Height: 720},
		{FileID: "big", FileUniqueID: unique + "b", Width: 2560, Height: 1440},
	}
	return message
}

func viewBody(body string) string {
	return strings.NewReplacer(`\u003c`, "<", `\u003e`, ">").Replace(body)
}

func TestVisualOf(t *testing.T) {
	if media, ok := visualOf(photoMsg(1, "u")); !ok || media.fileID != "mid" {
		t.Errorf("图片应取 mid 档，得到 %+v", media)
	}
	message := testutil.GroupMsg(-100, 42, 1, "")
	message.Sticker = &tg.Sticker{FileID: "s", FileUniqueID: "su", IsAnimated: true, Emoji: "😀",
		SetName: "赚钱群", Thumbnail: &tg.PhotoSize{FileID: "th", FileUniqueID: "thu"}}
	media, ok := visualOf(message)
	if !ok || media.fileID != "th" || !strings.Contains(media.meta, "赚钱群") {
		t.Errorf("动态贴纸应看缩略图并带包名，得到 %+v", media)
	}
	if _, ok := visualOf(testutil.GroupMsg(-100, 42, 1, "纯文字")); ok {
		t.Error("没有图不该识图")
	}
}

func TestVisualImages(t *testing.T) {
	images, err := visualImages(pngBytes, visual{})
	if err != nil || len(images) != 1 || !bytes.Equal(images[0], pngBytes) {
		t.Fatalf("image bytes changed: %v, %v", images, err)
	}
	if _, err := visualImages([]byte("not an image"), visual{}); err == nil {
		t.Fatal("non-image input accepted")
	}
}

func TestPurePhotoNeedsLocalModel(t *testing.T) {
	bot, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, bot, -100)
	calls, _ := fakeAIWith(t, bot, soReply("clean", 0.9, "none", "message"), llmReply(false, 0.9, "none", "message"))
	HandleGroupMessage(bot, photoMsg(1, "u1"))
	waitIdle(t, bot)
	if calls.Load() != 0 {
		t.Fatal("disabled local models must skip pure images")
	}
}

func TestLocalPhotoEvidenceAndLogs(t *testing.T) {
	for _, archive := range []string{"0", "1"} {
		t.Run("archive="+archive, func(t *testing.T) {
			bot, _ := testutil.NewTestBot(t, 1)
			testutil.EnableAntiad(t, bot, -100)
			bot.Cfg.ArchiveDir = t.TempDir()
			if err := bot.PutSetting("archive_enabled", archive); err != nil {
				t.Fatal(err)
			}
			seen, imageCalls := visionAI(t, bot)
			media, _ := visualOf(photoMsg(1, "u1"))
			cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "加微信 abc123\n领福利", QR: true})
			cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
			for _, messageID := range []int64{1, 2} {
				HandleGroupMessage(bot, photoMsg(messageID, "u1"))
				waitIdle(t, bot)
			}
			body := viewBody(seen.Load().(string))
			for _, evidence := range []string{"<image id=2>", "<ocr>加微信 abc123 领福利</ocr>", "<nsfw>", "[QR]"} {
				if !strings.Contains(body, evidence) {
					t.Errorf("missing evidence %q in %s", evidence, body)
				}
			}
			var text string
			if err := bot.Store.Read.QueryRow(`SELECT text FROM group_messages WHERE message_id=2`).Scan(&text); err != nil || !strings.Contains(text, "abc123") {
				t.Fatalf("stored evidence = %q, %v", text, err)
			}
			var imageLogs int
			if err := bot.Store.Read.QueryRow(`SELECT COUNT(*) FROM ai_log WHERE input LIKE '%data:image/%' OR input LIKE '%image_url%'`).Scan(&imageLogs); err != nil || imageLogs != 0 || imageCalls.Load() != 0 {
				t.Fatalf("image uploaded or logged: requests=%d logs=%d error=%v", imageCalls.Load(), imageLogs, err)
			}
		})
	}
}

func TestLocalVisionFailureAndEmptyEvidence(t *testing.T) {
	for _, caption := range []string{"", "保留配文 abc123"} {
		for _, fail := range []bool{false, true} {
			bot, _ := testutil.NewTestBot(t, 1)
			testutil.EnableAntiad(t, bot, -100)
			seen, imageCalls := visionAI(t, bot)
			bot.LocalModels = nil
			message := photoMsg(1, "u1")
			message.Caption = caption
			media, _ := visualOf(message)
			if !fail {
				cacheLocalResult(bot, media, "ocr", localvision.FrameResult{})
				cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{})
			}
			HandleGroupMessage(bot, message)
			waitIdle(t, bot)
			if (seen.Load().(string) != "") != (caption != "") || imageCalls.Load() != 0 {
				t.Fatalf("caption=%q fail=%v produced unexpected judgement: %s", caption, fail, seen.Load())
			}
			if caption == "" {
				_, _, reason := logRow(t, bot)
				if strings.Contains(reason, "识图失败") != fail {
					t.Fatalf("failure confused with empty result: %q", reason)
				}
			}
		}
	}
}

func TestDownloadErrorHidesToken(t *testing.T) {
	bot, _ := testutil.NewTestBot(t, 1)
	bot.Cfg.TGAPIBase = "http://127.0.0.1:1"
	_, err := bot.DownloadFile("photos/x.png")
	if err == nil || strings.Contains(err.Error(), testutil.TestToken) {
		t.Fatalf("download error exposed token: %v", err)
	}
}
