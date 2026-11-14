package panel

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"menshen/internal/localvision"
	"menshen/internal/testutil"
)

func TestLocalModelsDownloadEnablesBothWithBundledModels(t *testing.T) {
	bundled := os.Getenv("MENSHEN_LOCAL_MODELS_TEST_DIR")
	python := os.Getenv("MENSHEN_LOCAL_MODELS_TEST_PYTHON")
	if bundled == "" || python == "" {
		t.Skip("set MENSHEN_LOCAL_MODELS_TEST_DIR and MENSHEN_LOCAL_MODELS_TEST_PYTHON to run the real-model integration test")
	}
	if _, err := os.Stat(bundled); err != nil {
		t.Fatalf("MENSHEN_LOCAL_MODELS_TEST_DIR: %v", err)
	}

	env := newMiniEnv(t)
	env.sh.LocalModels.Close()
	env.sh.LocalModels = localvision.New(localvision.Config{
		Dir:        t.TempDir(),
		BundledDir: bundled,
		Python:     python,
		Threads:    2,
	})
	t.Cleanup(env.sh.LocalModels.Close)
	main := env.adminInit()

	w := miniDo(t, env.h, testutil.TestToken, main, testutil.TestBotID,
		"localmodels", map[string]any{"action": "download"})
	if w.Code != http.StatusOK {
		t.Fatalf("download should start asynchronously, got %d: %s", w.Code, w.Body.String())
	}

	deadline := time.Now().Add(4 * time.Minute)
	for {
		w = miniDo(t, env.h, testutil.TestToken, main, testutil.TestBotID,
			"localmodels", map[string]any{"action": "status"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body.String())
		}
		var status localModelsStatus
		if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if status.Error != "" {
			t.Fatalf("download/warmup failed: %s", status.Error)
		}
		ready, enabled := 0, 0
		for _, model := range status.Models {
			if model.Ready {
				ready++
			}
			if model.Enabled {
				enabled++
			}
		}
		if !status.Downloading {
			if ready != 2 || enabled != 2 {
				t.Fatalf("download finished without enabling both models: %+v", status)
			}
			if status.DownloadedBytes != status.TotalBytes {
				t.Fatalf("downloaded %d of %d bytes", status.DownloadedBytes, status.TotalBytes)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("download did not finish: %+v", status)
		}
		time.Sleep(200 * time.Millisecond)
	}

	snap := env.sh.Cache.Snap()
	if snap.Setting("antiad_local_ocr") != "1" || snap.Setting("antiad_local_nsfw") != "1" {
		t.Fatalf("both settings must be enabled atomically, got ocr=%q nsfw=%q",
			snap.Setting("antiad_local_ocr"), snap.Setting("antiad_local_nsfw"))
	}
}
