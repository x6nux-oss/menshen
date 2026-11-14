package localvision

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testAsset(body string) asset {
	sum := sha256.Sum256([]byte(body))
	return asset{Group: "ocr", File: "model.onnx", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}
}

func TestDownloadVerifiesAndReusesBundledFiles(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write([]byte("correct model"))
	}))
	defer server.Close()
	manager := New(Config{Dir: t.TempDir(), BundledDir: t.TempDir(), Client: server.Client()})
	defer manager.Close()
	artifact := testAsset("correct model")
	artifact.URL = server.URL
	manager.assets = []asset{artifact}
	if err := manager.Download(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := manager.Download(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 || !manager.Status().Models[0].Ready {
		t.Fatalf("downloaded %d times, status %+v", requests.Load(), manager.Status())
	}
	if err := os.Rename(filepath.Join(manager.cfg.Dir, artifact.File), filepath.Join(manager.cfg.BundledDir, artifact.File)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manager.cfg.Dir, artifact.File), []byte("corrupt model"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := manager.Download(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 || !manager.Status().Models[0].Ready {
		t.Fatal("a valid baked model must survive an empty or corrupt data volume")
	}
}

func TestDownloadRejectsCorruptionWithoutPublishing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("corrupt model"))
	}))
	defer server.Close()
	manager := New(Config{Dir: t.TempDir(), Client: server.Client()})
	defer manager.Close()
	artifact := testAsset("correct model")
	artifact.URL = server.URL
	manager.assets = []asset{artifact}
	if err := manager.Download(context.Background()); err == nil {
		t.Fatal("checksum mismatch must fail")
	}
	entries, err := os.ReadDir(manager.cfg.Dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("unverified files leaked: %v, %v", entries, err)
	}
	if manager.Status().Error == "" || manager.Status().Models[0].Ready {
		t.Fatalf("download failure was hidden: %+v", manager.Status())
	}
}

func TestDownloadSingleFlightAndCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	manager := New(Config{Dir: t.TempDir(), Client: server.Client()})
	artifact := testAsset("correct model")
	artifact.URL = server.URL
	manager.assets = []asset{artifact}
	var completed atomic.Bool
	if err := manager.StartDownload(func() error { completed.Store(true); return nil }); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("download did not start")
	}
	if err := manager.StartDownload(nil); !errors.Is(err, ErrDownloading) {
		t.Fatalf("duplicate download = %v", err)
	}
	manager.Close()
	if completed.Load() || manager.Status().Downloading {
		t.Fatal("shutdown must stop download without enabling models")
	}
}

func workerFixture(t *testing.T, command string) *Manager {
	t.Helper()
	directory := t.TempDir()
	python := filepath.Join(directory, "worker")
	if err := os.WriteFile(python, []byte("#!/bin/sh\n"+command+"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	manager := New(Config{Dir: directory, Python: python})
	artifact := testAsset("model")
	manager.assets = []asset{artifact}
	if err := os.WriteFile(filepath.Join(directory, artifact.File), []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Close)
	return manager
}

func TestWorkerReuseAndMalformedOutput(t *testing.T) {
	manager := workerFixture(t, `while IFS= read -r request; do printf '%s\n' '{"frames":[{"text":"hello 123","nsfw":0.1,"qr":true}]}'; done`)
	for attempt := 0; attempt < 2; attempt++ {
		result, err := manager.Infer(context.Background(), Request{Images: [][]byte{[]byte("image")}, OCR: true})
		if err != nil || len(result.Frames) != 1 || result.Frames[0].Text != "hello 123" || !result.Frames[0].QR {
			t.Fatalf("inference = %+v, %v", result, err)
		}
	}
	bad := workerFixture(t, `while IFS= read -r request; do printf '%s\n' '{"frames":[{"nsfw":3}]}'; done`)
	if _, err := bad.Infer(context.Background(), Request{Images: [][]byte{[]byte("image")}, OCR: true}); err == nil {
		t.Fatal("invalid worker probability must be rejected")
	}
}

func TestWorkerWarmupUsesEmptyImageArray(t *testing.T) {
	manager := workerFixture(t, `while IFS= read -r request; do case "$request" in *'"images":[]'*) printf '%s\n' '{"frames":[]}';; *) printf '%s\n' '{"error":"images must be an array"}';; esac; done`)
	if _, err := manager.Infer(context.Background(), Request{OCR: true}); err != nil {
		t.Fatalf("empty-image warmup failed: %v", err)
	}
}

func TestWorkerKeepsPartialEvidenceAndBoundsOCRText(t *testing.T) {
	partial, err := decodeResult([]byte(`{"frames":[{"nsfw":0.99}],"error":"Frame 2: invalid image"}`), Request{Images: [][]byte{{1}, {2}}, NSFW: true})
	if err == nil || len(partial.Frames) != 1 || partial.Frames[0].NSFW != 0.99 {
		t.Fatalf("successful earlier frames were discarded: %+v, %v", partial, err)
	}
	encoded, err := json.Marshal(Result{Frames: []FrameResult{{Text: strings.Repeat("汉", 2000)}}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := decodeResult(encoded, Request{Images: [][]byte{{1}}, OCR: true})
	if err != nil || len([]rune(result.Frames[0].Text)) != 500 {
		t.Fatalf("OCR cache input was not bounded: %d, %v", len([]rune(result.Frames[0].Text)), err)
	}
}

func TestWorkerTimeoutReleasesQueue(t *testing.T) {
	manager := workerFixture(t, `while IFS= read -r request; do read -r another; done`)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := manager.Infer(ctx, Request{Images: [][]byte{[]byte("image")}, OCR: true}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout = %v", err)
	}
	if err := os.WriteFile(manager.cfg.Python, []byte("#!/bin/sh\nwhile IFS= read -r request; do printf '%s\\n' '{\"frames\":[{\"text\":\"recovered\"}]}'; done\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	result, err := manager.Infer(context.Background(), Request{Images: [][]byte{[]byte("image")}, OCR: true})
	if err != nil || !strings.Contains(result.Frames[0].Text, "recovered") {
		t.Fatalf("worker did not recover: %+v, %v", result, err)
	}
}
