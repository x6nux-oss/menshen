package localvision

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestPerfRealOfflineModels 是 localvision 的真实模型基线：需要本机已下载
// 模型，默认跳过。它测图片解码 + 缩图 + OCR + NSFW 的整段耗时，以及 4 槽
// 位队列在 8 路突发下的接受/拒绝行为。
//
//	MENSHEN_PERF=1 MENSHEN_LOCAL_MODELS_TEST_DIR=/path/to/models \
//	  go test ./internal/localvision -run TestPerfRealOfflineModels -v
//
// 内存与 CPU 用 /usr/bin/time -l 或容器 cgroup 从进程外采；Go 侧只报墙钟。
func TestPerfRealOfflineModels(t *testing.T) {
	directory := os.Getenv("MENSHEN_LOCAL_MODELS_TEST_DIR")
	if directory == "" || os.Getenv("MENSHEN_PERF") == "" {
		t.Skip("需要 MENSHEN_PERF=1 和 MENSHEN_LOCAL_MODELS_TEST_DIR")
	}
	manager := New(Config{Dir: t.TempDir(), BundledDir: directory,
		Python: os.Getenv("MENSHEN_LOCAL_MODELS_TEST_PYTHON"), Threads: 2})
	defer manager.Close()
	if _, err := manager.Infer(context.Background(), Request{OCR: true, NSFW: true}); err != nil {
		t.Fatalf("模型预热失败: %v", err)
	}

	small := perfJPEG(t, 640, 360)
	large := perfJPEG(t, 6000, 4000)
	var report strings.Builder
	fmt.Fprintf(&report, "\n### localvision 真实模型基线\n\n| 图片 | 字节 | p50 | p95 |\n|---|---|---|---|\n")
	for _, c := range []struct {
		name string
		data []byte
	}{{"640x360", small}, {"6000x4000", large}} {
		var times []time.Duration
		for i := 0; i < 5; i++ {
			start := time.Now()
			if _, err := manager.Infer(context.Background(), Request{
				Images: [][]byte{c.data}, OCR: true, NSFW: true}); err != nil {
				t.Fatalf("%s 推理失败: %v", c.name, err)
			}
			times = append(times, time.Since(start))
		}
		fmt.Fprintf(&report, "| %s | %d | %s | %s |\n", c.name, len(c.data),
			perfPercentile(times, 0.5), perfPercentile(times, 0.95))
	}

	// 8 路同时打进来：槽位只有 4，后到的最多 4 路应立即失败，而不是排队
	// 把判定 worker 拖住（这是审计 §4.3 的队列背压行为）。
	var mu sync.Mutex
	ok, full := 0, 0
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := manager.Infer(context.Background(), Request{
				Images: [][]byte{small}, OCR: true, NSFW: true})
			mu.Lock()
			defer mu.Unlock()
			if err != nil && strings.Contains(err.Error(), "队列已满") {
				full++
				return
			}
			if err != nil {
				t.Errorf("意外错误: %v", err)
				return
			}
			ok++
		}()
	}
	wg.Wait()
	fmt.Fprintf(&report, "\n8 路突发：成功 %d，槽位满立即失败 %d。\n", ok, full)
	t.Logf("%s", report.String())
}

func perfJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	// 画几道黑条，避免纯色图让 OCR 检测直接空跑；不是为了测识别准确率。
	draw.Draw(canvas, image.Rect(width/10, height/3, width*9/10, height/3+height/20),
		image.NewUniform(color.Black), image.Point{}, draw.Src)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, canvas, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func perfPercentile(times []time.Duration, q float64) time.Duration {
	cp := append([]time.Duration(nil), times...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	return cp[int(float64(len(cp)-1)*q)]
}
