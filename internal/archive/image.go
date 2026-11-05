package archive

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	stddraw "image/draw"
	"image/jpeg"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
	_ "image/png"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"menshen/internal/core"
)

// maxPixels 是允许解码的像素上限。聊天图片不会这么大；超过的多半是
// 解压炸弹，直接放弃压缩、保存原始字节。
const maxPixels = 50_000_000

// saveMessageImage 下载并压缩一张消息图片，写到
// images/<YYYY-MM-DD>/<message_id>_<index>.<ext>。
//
// 跑在后台队列上；任何一步失败都只记日志，不影响已经写好的文字存档。
func saveMessageImage(b *core.Bot, chatID, msgID int64, index int, img ImageMeta, at int64) {
	if img.FileID == "" {
		return
	}
	// Bot API 对 bot 的下载上限是 20 MB；file_size 缺失时也照样试一次。
	if img.Size > imageMaxBytes {
		slog.Info("存档：图片超过下载上限，跳过",
			"chat", chatID, "msg", msgID, "size", img.Size)
		return
	}
	loc := b.Cache.Snap().Location()
	day := time.Unix(at, 0).In(loc).Format("2006-01-02")
	dir := filepath.Join(chatDir(b, chatID), "images", day)
	base := fmt.Sprintf("%d_%d", msgID, index)
	// 已经落过盘就不再下载：编辑消息会再走一遍存档，图片通常没变；
	// 进程重启后 TG 重推同一条更新也走这里。
	if old, _ := filepath.Glob(filepath.Join(dir, base+".*")); len(old) > 0 {
		return
	}
	data, err := fetchFile(b, img.FileID)
	if err != nil {
		slog.Warn("存档：下载图片失败", "chat", chatID, "msg", msgID, "err", err)
		return
	}
	path, err := saveImage(dir, base, data, imageMaxSide(b), imageQuality(b), extOfMIME(img.MIME))
	if err != nil {
		slog.Warn("存档：保存图片失败", "chat", chatID, "msg", msgID, "err", err)
		return
	}
	slog.Debug("存档：图片已保存", "chat", chatID, "msg", msgID, "path", path)
}

// ImageRef 返回一张存档图片的相对路径（相对存档根目录），扩展名用 `*`
// 表示：实际落盘可能是 .jpg/.png/.webp，取决于压缩结果。用于把 ai_log
// 里的 base64 替换成指向图片的占位符。
func ImageRef(b *core.Bot, chatID, msgID, index, at int64) string {
	loc := b.Cache.Snap().Location()
	day := time.Unix(at, 0).In(loc).Format("2006-01-02")
	return path.Join(strconv.FormatInt(chatID, 10), "images", day,
		fmt.Sprintf("%d_%d.*", msgID, index))
}

// RedactImageDataURLs 把请求体里的 data:image/...;base64,... 按顺序替换成
// 指向存档图片的占位符。refs 里的空串表示这一张没有存档，保留原 base64
// （用于部分帧保存失败的情况）。
func RedactImageDataURLs(input []byte, refs []string) []byte {
	if len(refs) == 0 {
		return input
	}
	i := 0
	return dataURLRe.ReplaceAllFunc(input, func(m []byte) []byte {
		if i >= len(refs) {
			return m
		}
		ref := refs[i]
		i++
		if ref == "" {
			return m
		}
		return []byte("«图片已存档: " + ref + "»")
	})
}

// findImagePath 找一条消息在某个图片位上的存档文件；优先完整图，只有
// .partial 时才退回半张图。
func findImagePath(dir string, msgID, index int64) string {
	patterns := []string{
		filepath.Join(dir, fmt.Sprintf("%d_%d.*", msgID, index)),
		filepath.Join(dir, fmt.Sprintf("%d_hist_*_%d.*", msgID, index)),
	}
	if index == 0 {
		patterns = append(patterns, filepath.Join(dir, fmt.Sprintf("%d_tg.*", msgID)))
	}
	var partial string
	for _, pat := range patterns {
		files, _ := filepath.Glob(pat)
		for _, f := range files {
			if !strings.Contains(filepath.Base(f), ".partial.") {
				return f
			}
			if partial == "" {
				partial = f
			}
		}
	}
	return partial
}

// relToRoot 把绝对/相对文件路径转成相对存档根目录的展示路径。
func relToRoot(b *core.Bot, p string) string {
	if rel, err := filepath.Rel(Root(b), p); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(p)
}

// HasImage 报告这条消息是否已经有一张完整的存档图片（任意来源）。
// .partial 文件不算：那是 ai_log 64 KB 截断的半张图，后续 MTProto 回捞
// 到完整图时应当覆盖补全。
func HasImage(b *core.Bot, chatID, msgID, at int64) bool {
	loc := b.Cache.Snap().Location()
	day := time.Unix(at, 0).In(loc).Format("2006-01-02")
	dir := filepath.Join(chatDir(b, chatID), "images", day)
	return hasCompleteImage(dir, msgID)
}

func hasCompleteImage(dir string, msgID int64) bool {
	files, _ := filepath.Glob(filepath.Join(dir, strconv.FormatInt(msgID, 10)+"_*"))
	for _, f := range files {
		if !strings.Contains(filepath.Base(f), ".partial.") {
			return true
		}
	}
	return false
}

// SaveHistoryImage 保存一张从 MTProto 历史消息下载的图片。已经有完整
// 图片时返回 false（不覆盖更早的存档），返回 true 表示这次确实写入了。
func SaveHistoryImage(b *core.Bot, chatID, msgID, at int64, data []byte, mime string) (bool, error) {
	if len(data) == 0 {
		return false, nil
	}
	loc := b.Cache.Snap().Location()
	day := time.Unix(at, 0).In(loc).Format("2006-01-02")
	dir := filepath.Join(chatDir(b, chatID), "images", day)
	if hasCompleteImage(dir, msgID) {
		return false, nil
	}
	if _, err := saveImage(dir, strconv.FormatInt(msgID, 10)+"_tg", data,
		imageMaxSide(b), imageQuality(b), extOfMIME(mime)); err != nil {
		return false, err
	}
	return true, nil
}

// saveAvatar 抓取并保存用户头像，写到 avatars/<user_id>.<ext>。//
// 头像按 (chat_id,user_id) 记账，同一个群里的同一个人最多每 24 小时问
// 一次 getUserProfilePhotos；换头像后靠 TTL 自然追上。
func saveAvatar(b *core.Bot, chatID, uid int64) {
	var fileUnique, rel string
	var updatedAt int64
	err := b.Store.Read.QueryRow(`SELECT file_unique_id,file,updated_at
		FROM archive_avatars WHERE chat_id=? AND user_id=?`, chatID, uid).
		Scan(&fileUnique, &rel, &updatedAt)
	now := time.Now().Unix()
	if err == nil && now-updatedAt < int64(avatarRefresh/time.Second) {
		return
	}

	photos, uniqueID, err := profilePhotos(b, uid)
	if err != nil {
		slog.Debug("存档：读取用户头像失败", "chat", chatID, "uid", uid, "err", err)
		rememberAvatar(b, chatID, uid, fileUnique, rel, now)
		return
	}
	if len(photos) == 0 {
		rememberAvatar(b, chatID, uid, "", rel, now)
		return
	}
	if uniqueID == fileUnique && rel != "" {
		if _, statErr := os.Stat(filepath.Join(chatDir(b, chatID), rel)); statErr == nil {
			rememberAvatar(b, chatID, uid, fileUnique, rel, now)
			return
		}
	}

	data, err := fetchFile(b, photos[len(photos)-1].FileID)
	if err != nil {
		slog.Debug("存档：下载用户头像失败", "chat", chatID, "uid", uid, "err", err)
		rememberAvatar(b, chatID, uid, fileUnique, rel, now)
		return
	}
	dir := filepath.Join(chatDir(b, chatID), "avatars")
	path, err := saveImage(dir, fmt.Sprintf("%d", uid), data,
		avatarMaxSide, 85, ".jpg")
	if err != nil {
		slog.Warn("存档：保存用户头像失败", "chat", chatID, "uid", uid, "err", err)
		rememberAvatar(b, chatID, uid, fileUnique, rel, now)
		return
	}
	rel, err = filepath.Rel(chatDir(b, chatID), path)
	if err != nil {
		rel = path
	}
	rememberAvatar(b, chatID, uid, uniqueID, rel, now)
}

func rememberAvatar(b *core.Bot, chatID, uid int64, uniqueID, rel string, at int64) {
	if _, err := b.Store.Write.Exec(`INSERT INTO archive_avatars
		(chat_id,user_id,file_unique_id,file,updated_at) VALUES (?,?,?,?,?)
		ON CONFLICT(chat_id,user_id) DO UPDATE SET
			file_unique_id=excluded.file_unique_id,
			file=excluded.file,
			updated_at=excluded.updated_at`,
		chatID, uid, uniqueID, rel, at); err != nil {
		slog.Error("存档：写头像索引失败", "chat", chatID, "uid", uid, "err", err)
	}
}

// profilePhotos 取一个用户当前的头像各档尺寸。返回最大那一档的文件
// 与 file_unique_id（用于判断头像有没有换过）。
func profilePhotos(b *core.Bot, uid int64) ([]ImageMeta, string, error) {
	raw, err := b.TG.Call("getUserProfilePhotos", map[string]any{
		"user_id": uid, "offset": 0, "limit": 1,
	})
	if err != nil {
		return nil, "", err
	}
	var resp struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
		Result      struct {
			TotalCount int `json:"total_count"`
			Photos     [][]struct {
				FileID       string `json:"file_id"`
				FileUniqueID string `json:"file_unique_id"`
				Width        int    `json:"width"`
				Height       int    `json:"height"`
			} `json:"photos"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &resp) != nil || !resp.OK {
		return nil, "", fmt.Errorf("getUserProfilePhotos: %s", resp.Description)
	}
	if resp.Result.TotalCount == 0 || len(resp.Result.Photos) == 0 {
		return nil, "", nil
	}
	var best ImageMeta
	bestArea := 0
	for _, p := range resp.Result.Photos[0] {
		if p.FileID == "" {
			continue
		}
		if area := p.Width * p.Height; area >= bestArea {
			best = ImageMeta{FileID: p.FileID, UniqueID: p.FileUniqueID, MIME: "image/jpeg"}
			bestArea = area
		}
	}
	if best.FileID == "" {
		return nil, "", nil
	}
	return []ImageMeta{best}, best.UniqueID, nil
}

// fetchFile 用 getFile 换出路径再下载。上限按 Bot API 的 20 MB。
func fetchFile(b *core.Bot, fileID string) ([]byte, error) {
	raw, err := b.TG.Call("getFile", map[string]any{"file_id": fileID})
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
	return b.DownloadFileLimit(resp.Result.FilePath, imageMaxBytes)
}

// saveImage 压缩并写盘；压缩失败时保存原始字节，尽量不丢图。
func saveImage(dir, base string, data []byte, maxSide, quality int, fallbackExt string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	out, ext, err := compressImage(data, maxSide, quality)
	if err != nil {
		out, ext = data, fallbackExt
	}
	if ext == "" {
		ext = ".img"
	}
	path := filepath.Join(dir, base+ext)
	if err := os.WriteFile(path, out, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// compressImage 把任意可解码的图片缩放后转成 JPEG。
//
// 缩放用 CatmullRom，先把透明区域铺白再合成：聊天里的 PNG 截图常有透明
// 像素，直接编码 JPEG 会得到一片黑。已经足够小的 JPEG 如果重新编码反而
// 更大，就保留原图（返回值仍是原格式）。
func compressImage(data []byte, maxSide, quality int) ([]byte, string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, "", fmt.Errorf("图片尺寸非法")
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return nil, "", fmt.Errorf("图片像素过多")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	if quality < 1 || quality > 100 {
		quality = defaultImageQuality
	}
	if maxSide <= 0 {
		maxSide = defaultImageMaxSide
	}

	w, h := fitWithin(cfg.Width, cfg.Height, maxSide)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	stddraw.Draw(dst, dst.Bounds(), image.White, image.Point{}, stddraw.Src)
	if w == cfg.Width && h == cfg.Height {
		stddraw.Draw(dst, dst.Bounds(), img, img.Bounds().Min, stddraw.Over)
	} else {
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), stddraw.Over, nil)
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: quality}); err != nil {
		return nil, "", err
	}
	// 没有缩放且 JPEG 比原图大：保留原图，避免「压缩」把文件压大。
	if w == cfg.Width && h == cfg.Height && buf.Len() >= len(data) {
		return data, extForFormat(format), nil
	}
	return buf.Bytes(), ".jpg", nil
}

// fitWithin 按长边等比缩放。
func fitWithin(w, h, maxSide int) (int, int) {
	if maxSide <= 0 || (w <= maxSide && h <= maxSide) {
		return w, h
	}
	if w >= h {
		nh := h * maxSide / w
		if nh < 1 {
			nh = 1
		}
		return maxSide, nh
	}
	nw := w * maxSide / h
	if nw < 1 {
		nw = 1
	}
	return nw, maxSide
}

func extForFormat(format string) string {
	switch strings.ToLower(format) {
	case "jpeg":
		return ".jpg"
	case "png":
		return ".png"
	case "gif":
		return ".gif"
	case "webp":
		return ".webp"
	case "bmp":
		return ".bmp"
	default:
		return ".img"
	}
}

func extOfMIME(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tif"
	default:
		return ".img"
	}
}
