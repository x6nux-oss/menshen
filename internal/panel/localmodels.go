package panel

import (
	"context"
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"menshen/internal/core"
	"menshen/internal/localvision"
)

const localModelWarmupTimeout = 2 * time.Minute

var errLocalModelsUnavailable = errors.New("本地模型管理器未启用")

type localModelView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Ready     bool   `json:"ready"`
	SizeBytes int64  `json:"size_bytes"`
	Enabled   bool   `json:"enabled"`
}

type localModelsStatus struct {
	Models          []localModelView `json:"models"`
	Downloading     bool             `json:"downloading"`
	DownloadedBytes int64            `json:"downloaded_bytes"`
	TotalBytes      int64            `json:"total_bytes"`
	Error           string           `json:"error"`
	NSFWThreshold   int              `json:"nsfw_threshold"`
}

// miniLocalModels 管理本地视觉模型：只有主管理员能查看、下载和配置。
// 客户端只能选择固定动作，不能指定下载地址或落盘路径。
func miniLocalModels(sh *core.Shared, w http.ResponseWriter, uid int64, body map[string]any) {
	if !sh.IsMain(uid) {
		miniErr(w, http.StatusForbidden, "只有主管理员能管理本地模型")
		return
	}
	switch action := miniStr(body, "action"); action {
	case "status":
		if err := localModelKeys(body, "action"); err != nil {
			miniFail(w, err, "读取本地模型状态失败")
			return
		}
		status, err := localModelsView(sh)
		if err != nil {
			localModelFail(w, err)
			return
		}
		miniOK(w, status)
	case "download":
		if err := localModelKeys(body, "action"); err != nil {
			miniFail(w, err, "下载失败")
			return
		}
		if err := startLocalModelsDownload(sh); err != nil {
			localModelFail(w, err)
			return
		}
		miniOK(w, map[string]any{"ok": true,
			"note": "已开始下载，完成后会自动启用 OCR 与 NSFW"})
	case "configure":
		if err := configureLocalModel(sh, body); err != nil {
			localModelFail(w, err)
			return
		}
		miniOK(w, map[string]any{"ok": true})
	default:
		miniErr(w, http.StatusBadRequest, "未知操作")
	}
}

func localModelsView(sh *core.Shared) (localModelsStatus, error) {
	manager := sh.LocalModels
	if manager == nil {
		return localModelsStatus{}, errLocalModelsUnavailable
	}
	status := manager.Status()
	snap := sh.Cache.Snap()
	out := localModelsStatus{
		Downloading:     status.Downloading,
		DownloadedBytes: status.DownloadedBytes,
		TotalBytes:      status.TotalBytes,
		Error:           status.Error,
		NSFWThreshold:   int(snap.SettingInt("antiad_nsfw_threshold", 85)),
	}
	out.Models = make([]localModelView, 0, len(status.Models))
	for _, model := range status.Models {
		out.Models = append(out.Models, localModelView{
			ID:        model.ID,
			Name:      model.Name,
			Ready:     model.Ready,
			SizeBytes: model.SizeBytes,
			Enabled:   snap.Setting(localModelSettingKey(model.ID)) == "1",
		})
	}
	return out, nil
}

func startLocalModelsDownload(sh *core.Shared) error {
	manager := sh.LocalModels
	if manager == nil {
		return errLocalModelsUnavailable
	}
	return manager.StartDownload(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), localModelWarmupTimeout)
		defer cancel()
		if _, err := manager.Infer(ctx, localvision.Request{OCR: true, NSFW: true}); err != nil {
			return err
		}
		if _, err := sh.Store.Write.Exec(`INSERT INTO settings(k,v)
			VALUES('antiad_local_ocr','1'),('antiad_local_nsfw','1')
			ON CONFLICT(k) DO UPDATE SET v=excluded.v`); err != nil {
			return err
		}
		return sh.Cache.Reload()
	})
}

func configureLocalModel(sh *core.Shared, body map[string]any) error {
	if err := localModelKeys(body, "action", "model", "enabled", "threshold"); err != nil {
		return err
	}
	_, hasModel := body["model"]
	_, hasEnabled := body["enabled"]
	rawThreshold, hasThreshold := body["threshold"]

	if hasThreshold {
		if hasModel || hasEnabled {
			return core.Bad("threshold 不能与 model/enabled 同时提交")
		}
		threshold, ok := rawThreshold.(float64)
		if !ok || threshold != math.Trunc(threshold) || threshold < 1 || threshold > 100 {
			return core.Bad("threshold 必须是 1-100 的整数")
		}
		return sh.PutSetting("antiad_nsfw_threshold", strconv.Itoa(int(threshold)))
	}

	model, _ := body["model"].(string)
	key, ok := localModelSettingKeyForName(model)
	if !ok {
		return core.Bad("model 必须是 ocr 或 nsfw")
	}
	enabled, ok := body["enabled"].(bool)
	if !ok {
		return core.Bad("enabled 必须是布尔值")
	}
	if enabled {
		manager := sh.LocalModels
		if manager == nil {
			return errLocalModelsUnavailable
		}
		if !localModelReady(manager.Status(), model) {
			return core.Bad("模型尚未下载完成，请先一键下载")
		}
		ctx, cancel := context.WithTimeout(context.Background(), localModelWarmupTimeout)
		defer cancel()
		request := localvision.Request{}
		if model == "ocr" {
			request.OCR = true
		} else {
			request.NSFW = true
		}
		if _, err := manager.Infer(ctx, request); err != nil {
			return core.Bad("本地模型运行校验失败：%s", err.Error())
		}
	}
	value := "0"
	if enabled {
		value = "1"
	}
	return sh.PutSetting(key, value)
}

func localModelKeys(body map[string]any, allowed ...string) error {
	for key := range body {
		if !slices.Contains(allowed, key) {
			return core.Bad("未知参数：%s", key)
		}
	}
	return nil
}

func localModelSettingKeyForName(name string) (string, bool) {
	switch name {
	case "ocr":
		return "antiad_local_ocr", true
	case "nsfw":
		return "antiad_local_nsfw", true
	}
	return "", false
}

func localModelSettingKey(id string) string {
	switch id {
	case "ocr":
		return "antiad_local_ocr"
	case "nsfw":
		return "antiad_local_nsfw"
	}
	return ""
}

func localModelReady(status localvision.Status, model string) bool {
	for _, item := range status.Models {
		if model == "ocr" && item.ID == "ocr" ||
			model == "nsfw" && item.ID == "nsfw" {
			return item.Ready
		}
	}
	return false
}

func localModelFail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errLocalModelsUnavailable):
		miniErr(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, localvision.ErrDownloading):
		miniErr(w, http.StatusConflict, err.Error())
	default:
		miniFail(w, err, "本地模型操作失败")
	}
}
