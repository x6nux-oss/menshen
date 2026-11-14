package localvision

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"strings"
	"testing"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

func TestRealOfflineModels(t *testing.T) {
	directory := os.Getenv("MENSHEN_LOCAL_MODELS_TEST_DIR")
	if directory == "" {
		t.Skip("set MENSHEN_LOCAL_MODELS_TEST_DIR to run with downloaded models")
	}
	manager := New(Config{Dir: t.TempDir(), BundledDir: directory,
		Python: os.Getenv("MENSHEN_LOCAL_MODELS_TEST_PYTHON"), Threads: 2})
	t.Cleanup(manager.Close)
	if _, err := manager.Infer(context.Background(), Request{OCR: true, NSFW: true}); err != nil {
		t.Fatalf("model warmup failed: %v", err)
	}
	typeface, err := opentype.Parse(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	face, err := opentype.NewFace(typeface, &opentype.FaceOptions{Size: 48, DPI: 72})
	if err != nil {
		t.Fatal(err)
	}
	defer face.Close()
	canvas := image.NewRGBA(image.Rect(0, 0, 512, 160))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	drawer := font.Drawer{Dst: canvas, Src: image.NewUniform(color.Black), Face: face, Dot: fixed.P(24, 90)}
	drawer.DrawString("HELLO 123")
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, canvas); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		result, err := manager.Infer(context.Background(), Request{Images: [][]byte{encoded.Bytes()}, OCR: true, NSFW: true})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Frames) != 1 || strings.Join(strings.Fields(result.Frames[0].Text), " ") != "HELLO 123" || result.Frames[0].NSFW >= 0.85 {
			t.Fatalf("unexpected benign-image inference: %+v", result)
		}
		t.Logf("OCR=%q NSFW=%.6f", result.Frames[0].Text, result.Frames[0].NSFW)
	}
}
