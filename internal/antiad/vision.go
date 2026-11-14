package antiad

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"menshen/internal/core"
	"menshen/internal/store"
	"menshen/internal/tg"
)

const (
	visionMaxSide = 1280
	visionTTL     = 24 * time.Hour
	visionDescMax = 500
	visionFileMax = 20 << 20
)

type visual struct {
	fileID, uniqueID string
	id               string
	tag              string
	meta             string
	frames           []int
	size             int64
}

func (media visual) render(content string) string {
	name := media.tag
	if name == "" {
		name = "image"
	}
	content = strings.TrimSpace(joinNonEmpty("", media.meta, content))
	if content == "" {
		return "<" + name + "/>"
	}
	attr := ""
	if media.id != "" {
		attr = " id=" + media.id
	}
	return "<" + name + attr + ">" + content + "</" + name + ">"
}

func visualOf(message *tg.Message) (visual, bool) {
	if len(message.Photo) > 0 {
		media := photoVisual(message.Photo, "image")
		media.id = visualID(message)
		return media, true
	}
	if photo := message.LivePhoto; photo != nil && len(photo.Photo) > 0 {
		media := photoVisual(photo.Photo, "live_photo")
		media.id = visualID(message)
		return media, true
	}
	if media, name := movingMediaOf(message); media != nil {
		return visual{fileID: media.FileID, uniqueID: media.FileUniqueID, tag: name,
			id: visualID(message), frames: frameSeconds(), size: media.FileSize}, true
	}
	if sticker := message.Sticker; sticker != nil {
		meta := joinNonEmpty("", sticker.Emoji, sticker.SetName)
		if !sticker.IsAnimated && !sticker.IsVideo {
			return visual{fileID: sticker.FileID, uniqueID: sticker.FileUniqueID, tag: "sticker",
				meta: meta, id: visualID(message)}, true
		}
		if sticker.Thumbnail != nil {
			return visual{fileID: sticker.Thumbnail.FileID, uniqueID: sticker.Thumbnail.FileUniqueID,
				tag: "sticker", meta: meta, id: visualID(message)}, true
		}
	}
	return visual{}, false
}

func visualID(message *tg.Message) string {
	if message.MessageID > 0 {
		return strconv.FormatInt(message.MessageID, 10)
	}
	return ""
}

func photoVisual(sizes []tg.PhotoSize, tag string) visual {
	photo := sizes[0]
	for _, size := range sizes {
		if max(size.Width, size.Height) <= visionMaxSide {
			photo = size
		}
	}
	return visual{fileID: photo.FileID, uniqueID: photo.FileUniqueID, tag: tag}
}

func visionOn(snapshot *store.Snapshot) bool {
	return snapshot.SettingInt("antiad_local_ocr", 0) == 1 || snapshot.SettingInt("antiad_local_nsfw", 0) == 1
}

func seeVisual(bot *core.Bot, snapshot *store.Snapshot, message *tg.Message, state adState,
	text string) (*tg.Message, adState, bool) {

	media, ok := visualOf(message)
	if !ok || !visionOn(snapshot) {
		return message, state, true
	}
	if len(media.frames) > 0 && !ffmpegReady() {
		ffmpegMissingOnce.Do(func() {
			slog.Warn("反广告：服务器上没有 ffmpeg，视频类只按文件名与配文判，抽帧识图已跳过")
		})
		return message, state, text != ""
	}
	line, err := describeVisual(bot, snapshot, media)
	if err != nil {
		slog.Warn("反广告：识图失败", "chat", message.Chat.ID, "uid", message.From.ID, "err", err)
		if text == "" {
			logAd(bot, message, adVerdict{Reason: "识图失败: " + err.Error()}, "none", "判定失败")
			return message, state, false
		}
		return message, state, true
	}
	if line == "" {
		return message, state, text != ""
	}
	copyMessage := *message
	copyMessage.Vision = line
	full := msgText(&copyMessage)
	state.Message.Text = core.TruncateRunes(full, adStateTextLimit)
	state.Message.Length = len([]rune(full))
	recordMessage(bot, copyMessage.Chat.ID, copyMessage.MessageID, copyMessage.From.ID, displayText(&copyMessage), copyMessage.Date, copyMessage.MediaGroupID)
	return &copyMessage, state, true
}

func visualImages(file []byte, media visual) ([][]byte, error) {
	if len(media.frames) == 0 {
		mime := http.DetectContentType(file)
		if !strings.HasPrefix(mime, "image/") {
			return nil, fmt.Errorf("不是图片（%s）", mime)
		}
		return [][]byte{file}, nil
	}
	frames, err := extractFrames(file, media.frames)
	if err != nil {
		return nil, err
	}
	images := make([][]byte, 0, len(frames))
	for _, frame := range frames {
		images = append(images, frame.jpeg)
	}
	return images, nil
}

func oneLine(text string) string { return strings.Join(strings.Fields(text), " ") }

func fetchTGFile(bot *core.Bot, fileID string) ([]byte, error) {
	raw, err := bot.TG.Call("getFile", map[string]any{"file_id": fileID})
	if err != nil {
		return nil, err
	}
	var resp struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
		Result      struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &resp) != nil || !resp.OK || resp.Result.FilePath == "" {
		return nil, fmt.Errorf("getFile: %s", resp.Description)
	}
	return bot.DownloadFile(resp.Result.FilePath)
}
