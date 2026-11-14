package panel

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"menshen/internal/localvision"
	"menshen/internal/testutil"
)

func newLocalModelsEnv(t *testing.T) *miniTestEnv {
	t.Helper()
	env := newMiniEnv(t)
	env.sh.LocalModels.Close()
	env.sh.LocalModels = localvision.New(localvision.Config{
		Dir:        t.TempDir(),
		BundledDir: t.TempDir(),
		Python:     "/bin/false",
		Threads:    2,
	})
	t.Cleanup(env.sh.LocalModels.Close)
	return env
}

func TestLegacyVisionSettingsAreNotExposed(t *testing.T) {
	env := newLocalModelsEnv(t)
	for _, key := range []string{"antiad_ocr_model", "antiad_vision_model"} {
		if err := env.sh.PutSetting(key, "old/remote-model"); err != nil {
			t.Fatal(err)
		}
	}
	response := miniDo(t, env.h, testutil.TestToken, env.adminInit(), testutil.TestBotID, "state", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("state failed: %d %s", response.Code, response.Body.String())
	}
	for _, key := range []string{"antiad_ocr_model", "antiad_vision_model"} {
		if strings.Contains(response.Body.String(), key) {
			t.Errorf("state exposes retired setting %s", key)
		}
	}
}

func TestLocalModelsPermissions(t *testing.T) {
	env := newLocalModelsEnv(t)
	if err := env.sh.AddAdmin(888, "次管", 777); err != nil {
		t.Fatal(err)
	}
	sub := signInitData(t, testutil.TestToken, map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10), "user": `{"id":888}`})

	for _, body := range []map[string]any{
		{"action": "status"},
		{"action": "download"},
		{"action": "configure", "threshold": 90},
	} {
		w := miniDo(t, env.h, testutil.TestToken, sub, testutil.TestBotID, "localmodels", body)
		if w.Code != http.StatusForbidden {
			t.Errorf("次级管理员执行 %v 应 403，得到 %d", body, w.Code)
		}
	}

	outsider := signInitData(t, testutil.TestToken, map[string]string{
		"auth_date": strconv.FormatInt(time.Now().Unix(), 10), "user": `{"id":12345}`})
	w := miniDo(t, env.h, testutil.TestToken, outsider, testutil.TestBotID, "localmodels",
		map[string]any{"action": "status"})
	if w.Code != http.StatusForbidden {
		t.Errorf("非管理员应 403，得到 %d", w.Code)
	}
}

func TestLocalModelsStatusDefaultsAndSettings(t *testing.T) {
	env := newLocalModelsEnv(t)
	w := miniDo(t, env.h, testutil.TestToken, env.adminInit(), testutil.TestBotID,
		"localmodels", map[string]any{"action": "status"})
	if w.Code != http.StatusOK {
		t.Fatalf("主管理员状态应 200，得到 %d：%s", w.Code, w.Body.String())
	}
	var status localModelsStatus
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if len(status.Models) != 2 {
		t.Fatalf("应返回 OCR 与 NSFW 两个模型，得到 %+v", status.Models)
	}
	if status.NSFWThreshold != 85 {
		t.Errorf("NSFW 阈值默认应为 85，得到 %d", status.NSFWThreshold)
	}
	for _, model := range status.Models {
		if model.Enabled {
			t.Errorf("新安装不应默认启用 %s", model.ID)
		}
	}

	for _, key := range []string{"antiad_local_ocr", "antiad_local_nsfw"} {
		if err := env.sh.PutSetting(key, "1"); err != nil {
			t.Fatal(err)
		}
	}
	if err := env.sh.PutSetting("antiad_nsfw_threshold", "91"); err != nil {
		t.Fatal(err)
	}
	w = miniDo(t, env.h, testutil.TestToken, env.adminInit(), testutil.TestBotID,
		"localmodels", map[string]any{"action": "status"})
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.NSFWThreshold != 91 {
		t.Errorf("阈值应读全局设置，得到 %d", status.NSFWThreshold)
	}
	for _, model := range status.Models {
		if !model.Enabled {
			t.Errorf("%s 应显示为已启用", model.ID)
		}
	}
}

func TestLocalModelsValidation(t *testing.T) {
	env := newLocalModelsEnv(t)
	main := env.adminInit()
	cases := []struct {
		name string
		body map[string]any
		want int
	}{
		{"未知动作", map[string]any{"action": "nope"}, http.StatusBadRequest},
		{"未知参数", map[string]any{"action": "configure", "url": "https://evil"}, http.StatusBadRequest},
		{"未知模型", map[string]any{"action": "configure", "model": "other", "enabled": true}, http.StatusBadRequest},
		{"缺少 enabled", map[string]any{"action": "configure", "model": "ocr"}, http.StatusBadRequest},
		{"enabled 非布尔", map[string]any{"action": "configure", "model": "ocr", "enabled": "yes"}, http.StatusBadRequest},
		{"未下载就启用", map[string]any{"action": "configure", "model": "ocr", "enabled": true}, http.StatusBadRequest},
		{"阈值过小", map[string]any{"action": "configure", "threshold": 0}, http.StatusBadRequest},
		{"阈值过大", map[string]any{"action": "configure", "threshold": 101}, http.StatusBadRequest},
		{"阈值非整数", map[string]any{"action": "configure", "threshold": 50.5}, http.StatusBadRequest},
		{"阈值与模型混用", map[string]any{"action": "configure", "model": "ocr", "enabled": false, "threshold": 50}, http.StatusBadRequest},
		{"关闭不需要运行时", map[string]any{"action": "configure", "model": "nsfw", "enabled": false}, http.StatusOK},
		{"合法阈值", map[string]any{"action": "configure", "threshold": 70}, http.StatusOK},
	}
	for _, c := range cases {
		w := miniDo(t, env.h, testutil.TestToken, main, testutil.TestBotID, "localmodels", c.body)
		if w.Code != c.want {
			t.Errorf("%s：应为 %d，得到 %d：%s", c.name, c.want, w.Code, w.Body.String())
		}
	}
	if got := env.sh.Cache.Snap().Setting("antiad_nsfw_threshold"); got != "70" {
		t.Errorf("阈值应落库为 70，得到 %q", got)
	}
	if got := env.sh.Cache.Snap().Setting("antiad_local_nsfw"); got != "0" {
		t.Errorf("关闭后应落库为 0，得到 %q", got)
	}
}

func TestLocalModelsUnavailableWithoutManager(t *testing.T) {
	env := newMiniEnv(t)
	env.sh.LocalModels.Close()
	env.sh.LocalModels = nil
	main := env.adminInit()
	for _, body := range []map[string]any{
		{"action": "status"},
		{"action": "download"},
		{"action": "configure", "model": "ocr", "enabled": true},
	} {
		w := miniDo(t, env.h, testutil.TestToken, main, testutil.TestBotID, "localmodels", body)
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%v 在管理器缺失时应 503，得到 %d", body, w.Code)
		}
	}
}

func TestLocalModelsEnableRequiresReadyModel(t *testing.T) {
	env := newLocalModelsEnv(t)
	w := miniDo(t, env.h, testutil.TestToken, env.adminInit(), testutil.TestBotID,
		"localmodels", map[string]any{"action": "configure", "model": "ocr", "enabled": true})
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "尚未下载") {
		t.Fatalf("未就绪模型启用应被拒并说明原因，得到 %d：%s", w.Code, w.Body.String())
	}
}
