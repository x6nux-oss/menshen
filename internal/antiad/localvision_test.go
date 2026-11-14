package antiad

import (
	"strings"
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

func TestLocalVisionCombinesOCRAndNSFWWithoutDownloadingCachedMedia(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	media, _ := visualOf(photoMsg(301, "local-combined"))
	cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "加微信 abc123", QR: true})
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
	line, spend, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "<ocr>加微信 abc123</ocr>") || !strings.Contains(line, "<nsfw>") || !strings.Contains(line, "[QR]") {
		t.Fatalf("combined local evidence = %q, %v", line, err)
	}
	if !strings.HasPrefix(line, "<image id=301>") || !strings.HasSuffix(line, "</image>") || fake.CountCalls("getFile") != 0 || spend.Cost != 0 {
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
	cachesOf(bot.Shared).vision.Set(media.uniqueID, "已停用的远程模型旧结果", visionTTL)
	if err := bot.PutSetting("antiad_nsfw_threshold", "90"); err != nil {
		t.Fatal(err)
	}
	line, _, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || line != "" {
		t.Fatalf("clean no-text image = %q, %v", line, err)
	}
	if err := bot.PutSetting("antiad_nsfw_threshold", "80"); err != nil {
		t.Fatal(err)
	}
	line, _, err = describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "<nsfw>") {
		t.Fatalf("updated threshold ignored for cached score: %q, %v", line, err)
	}
}

func TestLocalVisionFailureKeepsEvidenceAndUsesRemoteFallback(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	fakeFiles(t, bot, fake, 200)
	_, ocrCalls, _ := ocrAI(t, bot, "加微信 fallback", "画面描述")
	if err := bot.PutSetting("antiad_ocr_model", "ocr-model"); err != nil {
		t.Fatal(err)
	}
	media, _ := visualOf(photoMsg(303, "local-fallback"))
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{NSFW: 0.99})
	line, _, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "fallback") || !strings.Contains(line, "<nsfw>") || ocrCalls.Load() != 1 {
		t.Fatalf("fallback discarded successful NSFW evidence: %q, %v", line, err)
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
	if _, _, err := describeVisual(bot, bot.Cache.Snap(), media); err == nil {
		t.Fatal("missing local models must be reported as failure, not a clean image")
	}
}

func TestLocalNSFWFailureStillChecksRemoteVisionAfterOCR(t *testing.T) {
	bot, fake := testutil.NewTestBot(t, 1)
	for key, value := range map[string]string{"antiad_local_nsfw": "1", "antiad_ocr_model": "ocr-model", "antiad_vision_model": "vision-model"} {
		if err := bot.PutSetting(key, value); err != nil {
			t.Fatal(err)
		}
	}
	fakeFiles(t, bot, fake, 200)
	_, ocrCalls, visionCalls := ocrAI(t, bot, "联系 abc123", "画面疑似色情")
	media, _ := visualOf(photoMsg(306, "local-nsfw-fallback"))
	line, _, err := describeVisual(bot, bot.Cache.Snap(), media)
	if err != nil || !strings.Contains(line, "联系 abc123") || !strings.Contains(line, "画面疑似色情") || ocrCalls.Load() != 1 || visionCalls.Load() != 1 {
		t.Fatalf("OCR bypassed the failed NSFW model's vision fallback: %q, %v, calls %d/%d", line, err, ocrCalls.Load(), visionCalls.Load())
	}
}

func TestLocalVisionPreservesFrameAttribution(t *testing.T) {
	bot, _ := testutil.NewTestBot(t, 1)
	enableLocalVision(t, bot)
	media := visual{uniqueID: "local-video", id: "305", tag: "video", frames: []int{0, 1, 2}}
	cacheLocalResult(bot, media, "ocr", localvision.FrameResult{Text: "第一帧"}, localvision.FrameResult{}, localvision.FrameResult{Text: "第三帧"})
	cacheLocalResult(bot, media, "nsfw", localvision.FrameResult{}, localvision.FrameResult{}, localvision.FrameResult{NSFW: 0.98})
	line, _, err := describeVisual(bot, bot.Cache.Snap(), media)
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
