package antiad

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"menshen/internal/core"
	"menshen/internal/localvision"
	"menshen/internal/store"
)

func localVisionKey(group string, media visual) string {
	identity := media.uniqueID
	if identity == "" {
		identity = media.fileID
	}
	if identity == "" {
		return ""
	}
	return localvision.Revision() + ":" + group + "\x00" + identity
}

func describeVisual(bot *core.Bot, snapshot *store.Snapshot, media visual) (string, visionSpend, error) {
	remoteOCR := strings.TrimSpace(snapshot.Setting("antiad_ocr_model"))
	useOCR := snapshot.SettingInt("antiad_local_ocr", 0) == 1
	useNSFW := snapshot.SettingInt("antiad_local_nsfw", 0) == 1
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	slots := cachesOf(bot.Shared).localMedia
	admitted := false
	defer func() {
		if admitted {
			<-slots
		}
	}()
	var parts []any
	var partsErr error
	prepared := false
	load := func() ([]any, error) {
		if prepared {
			return parts, partsErr
		}
		prepared = true
		if media.size > visionFileMax {
			partsErr = fmt.Errorf("文件超过 %d 字节", visionFileMax)
			return nil, partsErr
		}
		if useOCR || useNSFW {
			select {
			case <-ctx.Done():
				partsErr = ctx.Err()
				return nil, partsErr
			case slots <- struct{}{}:
				admitted = true
			}
			if partsErr = ctx.Err(); partsErr != nil {
				return nil, partsErr
			}
		}
		file, err := fetchTGFile(bot, media.fileID)
		if err != nil {
			partsErr = err
			return nil, err
		}
		parts, partsErr = visualParts(file, media)
		return parts, partsErr
	}
	if !useOCR && !useNSFW {
		content, spend, err := describeRemoteVisual(bot, snapshot, media, remoteOCR, load)
		if content == "" {
			return "", spend, err
		}
		return media.render(content), spend, err
	}
	cache := &cachesOf(bot.Shared).localVision
	infer := func(group string) (localvision.Result, error) {
		key := localVisionKey(group, media)
		if key != "" {
			if cached, exists := cache.Get(key); exists {
				return cached, nil
			}
		}
		if bot.LocalModels == nil {
			return localvision.Result{}, errors.New("本地模型管理器未启用")
		}
		loaded, err := load()
		if err != nil {
			return localvision.Result{}, err
		}
		images, err := localImages(loaded)
		if err != nil {
			return localvision.Result{}, err
		}
		result, err := bot.LocalModels.Infer(ctx, localvision.Request{
			Images: images, OCR: group == "ocr", NSFW: group == "nsfw"})
		if err == nil && key != "" {
			cache.Set(key, result, visionTTL)
		}
		return result, err
	}
	var ocrResult, nsfwResult localvision.Result
	var ocrErr, nsfwErr error
	if useNSFW {
		nsfwResult, nsfwErr = infer("nsfw")
	}
	if useOCR {
		ocrResult, ocrErr = infer("ocr")
		if ocrErr == nil {
			remoteOCR = ""
		}
	}
	for group, err := range map[string]error{"OCR": ocrErr, "NSFW": nsfwErr} {
		if err != nil {
			slog.Warn("反广告：本地视觉推理失败", "model", group, "err", err)
		}
	}
	var contents []string
	var ocrLines, nsfwLines, qrLines []string
	framePrefix := func(index int) string {
		if len(media.frames) == 0 {
			return ""
		}
		return fmt.Sprintf("Frame %d: ", index+1)
	}
	qrFrames := map[int]bool{}
	for index, frame := range ocrResult.Frames {
		if text := strings.TrimSpace(frame.Text); text != "" {
			ocrLines = append(ocrLines, framePrefix(index)+text)
		}
		qrFrames[index] = frame.QR
	}
	threshold := float64(snapshot.SettingInt("antiad_nsfw_threshold", 85)) / 100
	for index, frame := range nsfwResult.Frames {
		if frame.NSFW >= threshold {
			nsfwLines = append(nsfwLines, framePrefix(index)+fmt.Sprintf("疑似色情内容，本地分类分数 %.1f%%", frame.NSFW*100))
		}
		qrFrames[index] = qrFrames[index] || frame.QR
	}
	for index := 0; index < max(len(ocrResult.Frames), len(nsfwResult.Frames)); index++ {
		if qrFrames[index] {
			qrLines = append(qrLines, framePrefix(index)+"[QR]")
		}
	}
	if len(ocrLines) > 0 {
		contents = append(contents, tag("ocr", core.TruncateRunes(oneLine(strings.Join(ocrLines, "\n")), visionDescMax)))
	}
	var spend visionSpend
	var remoteErr error
	if !useOCR || ocrErr != nil || nsfwErr != nil || len(ocrLines) == 0 && len(qrLines) == 0 {
		var remote string
		remote, spend, remoteErr = describeRemoteVisual(bot, snapshot, media, remoteOCR, load)
		if remote != "" {
			contents = append(contents, remote)
		}
		if nsfwErr != nil && remoteOCR != "" && strings.TrimSpace(snapshot.Setting("antiad_vision_model")) != "" {
			visualContent, visualSpend, visualErr := describeRemoteVisual(bot, snapshot, media, "", load)
			spend.merge(visualSpend)
			remoteErr = errors.Join(remoteErr, visualErr)
			if visualContent != "" && visualContent != remote {
				contents = append(contents, visualContent)
			}
		}
		if remoteErr != nil {
			slog.Warn("反广告：本地视觉的远程回退失败", "err", remoteErr)
		}
	}
	if len(nsfwLines) > 0 {
		contents = append(contents, tag("nsfw", strings.Join(nsfwLines, "；")))
	}
	if len(qrLines) > 0 {
		contents = append(contents, tag("qr", strings.Join(qrLines, "；")))
	}
	if len(contents) == 0 {
		return "", spend, errors.Join(ocrErr, nsfwErr, remoteErr)
	}
	return media.render(strings.Join(contents, "\n")), spend, nil
}

func localImages(parts []any) ([][]byte, error) {
	var images [][]byte
	for _, part := range parts {
		object, ok := part.(map[string]any)
		if !ok || object["type"] != "image_url" {
			continue
		}
		image, ok := object["image_url"].(map[string]any)
		if !ok {
			return nil, errors.New("图片内容格式错误")
		}
		data, _ := image["url"].(string)
		prefix, encoded, ok := strings.Cut(data, ",")
		if !ok || !strings.HasPrefix(prefix, "data:image/") || !strings.HasSuffix(prefix, ";base64") {
			return nil, errors.New("本地推理只接受已下载的图片")
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, err
		}
		images = append(images, decoded)
	}
	if len(images) == 0 {
		return nil, errors.New("没有可供本地推理的图片")
	}
	return images, nil
}
