package antiad

import (
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"menshen/internal/core"
	"menshen/internal/localvision"
	"menshen/internal/testutil"
)

func enableLocalVision(t *testing.T, bot *core.Bot) {
	t.Helper()
	for _, key := range []string{"antiad_local_ocr", "antiad_local_nsfw"} {
		if err := bot.PutSetting(key, "1"); err != nil {
			t.Fatal(err)
		}
	}
}

func cacheLocalResult(bot *core.Bot, media visual, group string, frames ...localvision.FrameResult) {
	cachesOf(bot.Shared).localVision.Set(localVisionKey(group, media), localvision.Result{Frames: frames}, visionTTL)
}

func TestLegacyRemoteVisionNeverCalled(t *testing.T) {
	for _, scenario := range []string{"disabled", "failure", "empty", "ocr_only", "nsfw_only"} {
		t.Run(scenario, func(t *testing.T) {
			bot, fake := testutil.NewTestBot(t, 1)
			bot.LocalModels = nil
			downloads := fakeFiles(t, bot, fake, 200)
			var remoteCalls atomic.Int32
			fakeAI(t, bot, func(writer http.ResponseWriter, request *http.Request) {
				remoteCalls.Add(1)
				writer.Write([]byte(`{"choices":[{"message":{"content":"remote result"}}]}`))
			})
			if err := bot.PutSetting("antiad_ocr_model", "ocr-model"); err != nil {
				t.Fatal(err)
			}
			if err := bot.PutSetting("antiad_vision_model", "vision-model"); err != nil {
				t.Fatal(err)
			}
			media, _ := visualOf(photoMsg(310, scenario))
			if scenario != "disabled" {
				enableLocalVision(t, bot)
			}
			if scenario == "empty" {
				cacheLocalResult(bot, media, "ocr", localvision.FrameResult{})
				cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{})
			}
			if scenario == "ocr_only" {
				cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "local text"})
			}
			if scenario == "nsfw_only" {
				cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
			}
			line, err := describeVisual(bot, bot.Cache.Snap(), media)
			if remoteCalls.Load() != 0 || downloads.Load() != 0 {
				t.Fatalf("legacy configuration triggered remote processing: calls=%d downloads=%d", remoteCalls.Load(), downloads.Load())
			}
			if (err != nil) != (scenario == "failure") {
				t.Fatalf("unexpected inference error: %v", err)
			}
			if scenario == "disabled" && visionOn(bot.Cache.Snap()) {
				t.Fatal("legacy settings enabled visual inference")
			}
			if (scenario == "empty" || scenario == "disabled" || scenario == "failure") && line != "" {
				t.Fatalf("unexpected evidence: %q", line)
			}
			if scenario == "ocr_only" && !strings.Contains(line, "<ocr>local text</ocr>") || scenario == "nsfw_only" && !strings.Contains(line, "<nsfw>") {
				t.Fatalf("lost successful local evidence: %q", line)
			}
		})
	}
}

func TestLocalVisionCombinesOCRAndNSFWWithoutDownloadingCachedMedia(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	media, _ := visualOf(photoMsg(301, "local-combined"))
	cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "加微信 abc123", QR: true})
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
	line, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "<ocr>加微信 abc123</ocr>") || !strings.Contains(line, "<nsfw>") || !strings.Contains(line, "[QR]") {
		t.Fatalf("combined local evidence = %q, %v", line, err)
	}
	if !strings.HasPrefix(line, "<image id=301>") || !strings.HasSuffix(line, "</image>") || fake.CountCalls("getFile") != 0 {
		t.Fatalf("cached evidence lost attribution or triggered download: %q", line)
	}
	if !visionOn(bot.Cache.Snap()) {
		t.Fatal("local models must enable media-only adjudication")
	}
}

func TestLocalVisionThresholdAppliesToCachedScores(t *testing.T) {
	bot, _ := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	media, _ := visualOf(photoMsg(302, "local-threshold"))
	cacheLocalResult(bot, media, "ocr", localvision.FrameResult{})
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.87})
	if err := bot.PutSetting("antiad_nsfw_threshold", "90"); err != nil {
		t.Fatal(err)
	}
	line, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || line != "" {
		t.Fatalf("clean no-text image = %q, %v", line, err)
	}
	if err := bot.PutSetting("antiad_nsfw_threshold", "80"); err != nil {
		t.Fatal(err)
	}
	line, err = describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "<nsfw>") {
		t.Fatalf("updated threshold ignored for cached score: %q, %v", line, err)
	}
}

func TestLocalVisionFailureKeepsEvidenceWithoutCachingFailure(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	fakeFiles(t, bot, fake, 200)
	media, _ := visualOf(photoMsg(303, "local-partial"))
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
	line, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || strings.Contains(line, "<ocr>") || !strings.Contains(line, "<nsfw>") {
		t.Fatalf("discarded successful NSFW evidence: %q, %v", line, err)
	}
	if _, exists := cachesOf(bot.Shared).localVision.Get(localVisionKey("ocr", media)); exists {
		t.Fatal("failed local inference must not become an empty cache entry")
	}
}

func TestLocalVisionAllFailedIsNotNoText(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	fakeFiles(t, bot, fake, 200)
	media, _ := visualOf(photoMsg(304, "local-unavailable"))
	if _, err := describeVisual(bot, bot.Cache.Snap(), media); err == nil {
		t.Fatal("missing local models must be reported as failure, not a clean image")
	}
}

func TestLocalVisionPreservesFrameAttribution(t *testing.T) {
	bot, _ := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	media := visual{uniqueID: "local-video", id: "305", tag: "video", frames: []int{0, 1, 2}}
	cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "第一帧"}, localvision.FrameResult{}, localvision.FrameResult{Text: "第三帧"})
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{}, localvision.FrameResult{}, localvision.FrameResult{NSFW: 0.98})
	line, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "Frame 1: 第一帧") || !strings.Contains(line, "Frame 3: 第三帧") || !strings.Contains(line, "<nsfw>Frame 3:") {
		t.Fatalf("lost frame attribution: %q, %v", line, err)
	}
}

func TestLocalVisionBoundsMediaLoadingBeforeInference(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	downloads := fakeFiles(t, bot, fake, 200)
	media, _ := visualOf(photoMsg(307, "local-capacity"))
	slots := cachesOf(bot.Shared).localMedia
	for index := 0; index < cap(slots); index++ {
		slots <- struct{}{}
	}
	done := make(chan struct{})
	go func() {
		describeVisual(bot, bot.Cache.Snap(), media)
		close(done)
	}()
	early := false
	select {
	case <-done:
		early = true
	case <-time.After(50 * time.Millisecond):
	}
	before := downloads.Load()
	for index := 0; index < cap(slots); index++ {
		<-slots
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("media did not resume after capacity became available")
	}
	if early || before != 0 {
		t.Fatalf("saturated local inference still downloaded media: early=%v downloads=%d", early, before)
	}
}
