// Package archive 把群消息与判定流水按群写成普通文件。
//
// 数据库里的 group_messages / antiad_log 是给判定与面板用的热数据，有保留
// 天数、会被清理；这里的存档是另一份长期副本：
//
//	<root>/<chat_id>/messages-YYYY-MM-DD.jsonl
//	<root>/<chat_id>/judgments-YYYY-MM-DD.jsonl
//	<root>/<chat_id>/images/YYYY-MM-DD/<message_id>_<n>.jpg
//	<root>/<chat_id>/avatars/<user_id>.jpg
//
// 文本直接进 JSONL；图片（照片、以文件形式发送的图片、用户头像）下载后
// 自动缩放到上限并转成 JPEG。目录按群分，不按 bot 分：同一个群挂着几个
// bot 时，一份归档就够了。
package archive

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"menshen/internal/core"
	"menshen/internal/tg"
)

const (
	// imageMaxBytes 是单个存档图片的下载上限。Bot API 的 getFile 对 bot
	// 最大只给 20 MB，超过的文件本来就下载不到。
	imageMaxBytes = 20 << 20
	// 默认压缩参数：长边 1600 足够看清聊天图片里的字，又能显著缩小截图。
	defaultImageMaxSide = 1600
	defaultImageQuality = 82
	// avatarMaxSide 是头像的长边上限。头像只用来认人，不需要原图。
	avatarMaxSide = 512
	// avatarRefresh 是头像的重抓间隔。头像是用户级的，换头像后不必立刻
	// 让每条消息都去问一次 getUserProfilePhotos。
	avatarRefresh = 24 * time.Hour
	// textLimit 是写入存档的正文上限（字符）。Telegram 单条消息本身
	// 不超过 4096 字符，配文更短，这个上限只是防意外。
	textLimit = 8192
)

// ImageMeta 是存档记录里的图片元信息。实际文件按 message_id 命名，
// 不在每条记录里重复写路径。
type ImageMeta struct {
	FileID   string `json:"file_id,omitempty"`
	UniqueID string `json:"file_unique_id,omitempty"`
	MIME     string `json:"mime,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

// MessageRecord 是 messages-*.jsonl 的一行。
type MessageRecord struct {
	Type         string      `json:"type"`
	ChatID       int64       `json:"chat_id"`
	MessageID    int64       `json:"message_id"`
	UserID       int64       `json:"user_id"`
	UserName     string      `json:"user_name,omitempty"`
	Username     string      `json:"username,omitempty"`
	Date         int64       `json:"date"`
	EditDate     int64       `json:"edit_date,omitempty"`
	MediaGroupID string      `json:"media_group_id,omitempty"`
	Kind         string      `json:"kind"`
	Text         string      `json:"text,omitempty"`
	Caption      string      `json:"caption,omitempty"`
	FileName     string      `json:"file_name,omitempty"`
	MIME         string      `json:"mime,omitempty"`
	Images       []ImageMeta `json:"images,omitempty"`
	Punished     bool        `json:"punished,omitempty"`
	Source       string      `json:"source,omitempty"`
}

// JudgmentRecord 是 judgments-*.jsonl 的一行，字段与 antiad_log 对齐，
// 两级原始结论保留为嵌进 JSON 的对象，不再压成字符串。
type JudgmentRecord struct {
	Type             string          `json:"type"`
	ID               int64           `json:"id"`
	BotID            int64           `json:"bot_id"`
	ChatID           int64           `json:"chat_id"`
	UserID           int64           `json:"user_id"`
	MessageID        int64           `json:"message_id"`
	UserName         string          `json:"user_name,omitempty"`
	Text             string          `json:"text,omitempty"`
	Verdict          string          `json:"verdict"`
	Confidence       float64         `json:"confidence"`
	Decider          string          `json:"decider"`
	Kind             string          `json:"ad_kind,omitempty"`
	Action           string          `json:"action,omitempty"`
	Reason           string          `json:"reason,omitempty"`
	PromptTokens     int64           `json:"prompt_tokens,omitempty"`
	CompletionTokens int64           `json:"completion_tokens,omitempty"`
	QuotaCost        int64           `json:"quota_cost,omitempty"`
	CreatedAt        int64           `json:"created_at"`
	SoVerdict        json.RawMessage `json:"so_verdict,omitempty"`
	LlmVerdict       json.RawMessage `json:"llm_verdict,omitempty"`
	Source           string          `json:"source,omitempty"`
}

// Stats 是一次导出/入档的计数。
type Stats struct {
	Messages  int64
	Judgments int64
	Skipped   int64
	// Recovered / Partial 是从 ai_log 的识图请求里找回的图片数：
	// Recovered 是完整图片，Partial 是被 64 KB 上限截断、原样保留的
	// 半张图片。
	Recovered int64
	Partial   int64
	// Rewritten 是历史 ai_log.input 里被改写成存档占位符的行数。
	Rewritten int64
	Dir       string
}

// Root 返回存档根目录。配置里没写 archive_dir 时，取数据库同目录的
// archive/，与日志文件的落点一致，容器里挂一个卷即可。
func Root(b *core.Bot) string {
	if p := strings.TrimSpace(b.Cfg.ArchiveDir); p != "" {
		return p
	}
	dir := filepath.Dir(b.Cfg.DBPath)
	if dir == "" {
		dir = "."
	}
	return filepath.Join(dir, "archive")
}

// chatDir 是某个群的存档目录。chat_id 为负数（超级群）也是合法目录名。
func chatDir(b *core.Bot, chatID int64) string {
	return filepath.Join(Root(b), strconv.FormatInt(chatID, 10))
}

// Enabled 报告这个消息存档是否对这个群生效。
//
// 两级：archive_enabled 是 bot 级开关（可被单个 bot 覆盖），bot_chats
// 里那群还得是启用状态。与 antiad_enabled 无关 —— 反广告总开关关掉
// 只是不判定，存档仍然可以继续。
func Enabled(b *core.Bot, chatID int64) bool {
	snap := b.Cache.Snap()
	if snap.BotSettingInt(b.BotID(), "archive_enabled", 0) != 1 {
		return false
	}
	c, ok := snap.ChatConf(b.BotID(), chatID)
	return ok && c.Enabled
}

func imageMaxSide(b *core.Bot) int {
	n := b.Cache.Snap().BotSettingInt(b.BotID(), "archive_image_max_side", defaultImageMaxSide)
	if n < 320 {
		n = defaultImageMaxSide
	}
	if n > 10000 {
		n = 10000
	}
	return int(n)
}

func imageQuality(b *core.Bot) int {
	n := b.Cache.Snap().BotSettingInt(b.BotID(), "archive_image_quality", defaultImageQuality)
	if n < 1 || n > 100 {
		return defaultImageQuality
	}
	return int(n)
}

// HandleMessage 把一条群消息写进存档。调用方是群消息入口，已在
// asSender 之后——频道身份发言要记在实际发言者名下。
//
// 文本同步写（本地追加一行，很快）；图片与头像下载压缩交给后台队列，
// 不拖住更新处理。
func HandleMessage(b *core.Bot, m *tg.Message) {
	if m == nil || m.Chat == nil {
		return
	}
	if !Enabled(b, m.Chat.ID) {
		return
	}
	if m.ServiceSeen() {
		return
	}
	if looksLikeCommand(m) {
		return
	}

	imgs := imageTargets(m)
	text := core.TruncateRunes(m.Text, textLimit)
	caption := core.TruncateRunes(m.Caption, textLimit)
	if text == "" && caption == "" && len(imgs) == 0 {
		return
	}
	kind := messageKind(m, imgs, text, caption)

	at := m.Date
	if at == 0 {
		at = time.Now().Unix()
	}
	rec := MessageRecord{
		Type: "message", ChatID: m.Chat.ID, MessageID: m.MessageID,
		UserID: tgUserID(m.From), UserName: tgUserName(m.From),
		Username: tgUsername(m.From), Date: at, EditDate: m.EditDate,
		MediaGroupID: m.MediaGroupID, Kind: kind,
		Text: text, Caption: caption, Images: imgs, Source: "live",
	}
	if m.Document != nil {
		rec.FileName = m.Document.FileName
		rec.MIME = m.Document.MimeType
	}

	// 编辑消息不参与去重：消息 ID 相同，但群里显示的内容已经变了，
	// 存档要留下每一版。重复投递的同一版编辑极少，多一行可以接受。
	if m.EditDate == 0 {
		if !claim(b, "message", m.Chat.ID, m.MessageID, at) {
			return
		}
	}
	if _, err := appendRecord(b, m.Chat.ID, "messages", at, rec); err != nil {
		slog.Error("存档：写入消息失败", "chat", m.Chat.ID, "msg", m.MessageID, "err", err)
		if m.EditDate == 0 {
			release(b, "message", m.Chat.ID, m.MessageID)
		}
		return
	}

	// 图片与头像在后台队列里跑：getFile + 下载 + 解码压缩可能要几秒，
	// 同步等在这里会把整个群的更新处理一起卡住。
	for i, img := range imgs {
		enqueue(func() { saveMessageImage(b, m.Chat.ID, m.MessageID, i, img, at) })
	}
	if m.From != nil && m.From.ID > 0 {
		enqueue(func() { saveAvatar(b, m.Chat.ID, m.From.ID) })
	}
}

// messageKind 给存档记录一个粗粒度类型，方便按类型 grep/统计。
func messageKind(m *tg.Message, imgs []ImageMeta, text, caption string) string {
	switch {
	case m.Document != nil && len(imgs) > 0:
		return "document_image"
	case len(m.Photo) > 0:
		return "photo"
	case len(imgs) > 0:
		return "image"
	case m.Sticker != nil && text == "" && caption == "":
		return "sticker"
	case text != "" || caption != "":
		return "text"
	default:
		return "media"
	}
}

// imageTargets 取消息里需要落盘的图片：照片取最大一档，以文件形式发送的
// 图片（image/* 或常见图片扩展名）整份下载，实况照片的静态图一起存。
func imageTargets(m *tg.Message) []ImageMeta {
	var out []ImageMeta
	if p, ok := largestPhoto(m.Photo); ok {
		out = append(out, ImageMeta{FileID: p.FileID, UniqueID: p.FileUniqueID,
			MIME: "image/jpeg", Size: p.FileSize})
	}
	if lp := m.LivePhoto; lp != nil {
		if p, ok := largestPhoto(lp.Photo); ok {
			out = append(out, ImageMeta{FileID: p.FileID, UniqueID: p.FileUniqueID,
				MIME: "image/jpeg", Size: p.FileSize})
		}
	}
	if d := m.Document; d != nil && imageDocument(d) {
		out = append(out, ImageMeta{FileID: d.FileID, UniqueID: d.FileUniqueID,
			MIME: d.MimeType, Size: d.FileSize})
	}
	return out
}

func largestPhoto(sizes []tg.PhotoSize) (tg.PhotoSize, bool) {
	var best tg.PhotoSize
	found := false
	for _, s := range sizes {
		if s.FileID == "" {
			continue
		}
		if !found || s.Width*s.Height > best.Width*best.Height {
			best, found = s, true
		}
	}
	return best, found
}

// imageDocument 判断一个 document 是不是图片。Telegram 有时不给
// mime_type（老客户端、转发链），所以扩展名作为兜底。
func imageDocument(d *tg.FileNamed) bool {
	if d == nil || d.FileID == "" {
		return false
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(d.MimeType)), "image/") {
		return true
	}
	switch strings.ToLower(filepath.Ext(d.FileName)) {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff":
		return true
	}
	return false
}

// looksLikeCommand 跳过群内命令。命令是操作而非聊天内容，进存档只会把
// 复查语料搅浑。
func looksLikeCommand(m *tg.Message) bool {
	return strings.HasPrefix(strings.TrimSpace(m.Text), "/") ||
		strings.HasPrefix(strings.TrimSpace(m.Caption), "/")
}

func tgUserID(u *tg.TGUser) int64 {
	if u == nil {
		return 0
	}
	return u.ID
}

func tgUsername(u *tg.TGUser) string {
	if u == nil {
		return ""
	}
	return u.Username
}

func tgUserName(u *tg.TGUser) string {
	if u == nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimSpace(u.FirstName + " " + u.LastName))
}

// ---- 去重索引 ----

// claim 尝试占住一条存档记录：返回 true 表示本次调用负责写文件。
// 同一条群消息被多个 bot 收到、或历史导出与实时存档撞车时，
// INSERT OR IGNORE 的受影响行数保证只有一方会写。
func claim(b *core.Bot, kind string, chatID, refID, at int64) bool {
	res, err := b.Store.Write.Exec(`INSERT INTO archive_items (kind,chat_id,ref_id,at)
		VALUES (?,?,?,?) ON CONFLICT(kind,chat_id,ref_id) DO NOTHING`,
		kind, chatID, refID, at)
	if err != nil {
		slog.Error("存档：写去重索引失败", "kind", kind, "chat", chatID, "ref", refID, "err", err)
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// release 撤销占位，让下一次投递或导出还能再试。只在写文件失败时调用。
func release(b *core.Bot, kind string, chatID, refID int64) {
	if _, err := b.Store.Write.Exec(`DELETE FROM archive_items
		WHERE kind=? AND chat_id=? AND ref_id=?`, kind, chatID, refID); err != nil {
		slog.Error("存档：撤销去重索引失败", "kind", kind, "chat", chatID, "ref", refID, "err", err)
	}
}

// ---- JSONL 追加 ----

// writeMu 串行化所有追加。每条记录一次 Write，按日期分文件；不同群、
// 不同文件本可以并行，但本地追加的耗时可以忽略，简单更可靠。
var writeMu sync.Mutex

func appendRecord(b *core.Bot, chatID int64, prefix string, at int64, rec any) (string, error) {
	loc := b.Cache.Snap().Location()
	day := time.Unix(at, 0).In(loc).Format("2006-01-02")
	dir := chatDir(b, chatID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, prefix+"-"+day+".jsonl")
	line, err := json.Marshal(rec)
	if err != nil {
		return path, err
	}
	line = append(line, '\n')

	writeMu.Lock()
	defer writeMu.Unlock()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return path, err
	}
	if _, err := f.Write(line); err != nil {
		f.Close()
		return path, err
	}
	return path, f.Close()
}

// ---- 后台队列 ----

var (
	queueOnce sync.Once
	queueCh   chan func()
	pending   atomic.Int64
)

func enqueue(job func()) {
	queueOnce.Do(func() {
		queueCh = make(chan func(), 512)
		for i := 0; i < 2; i++ {
			go func() {
				for job := range queueCh {
					job()
					pending.Add(-1)
				}
			}()
		}
	})
	pending.Add(1)
	select {
	case queueCh <- job:
	default:
		pending.Add(-1)
		slog.Warn("存档：图片队列已满，跳过这一项")
	}
}

// WaitIdle 等后台队列清空。生产代码不调用它；测试用它等待图片/头像落盘。
func WaitIdle() {
	deadline := time.Now().Add(15 * time.Second)
	for pending.Load() > 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
}

// ---- 判定流水 ----

// RecordJudgment 由反广告流水落库后调用，把一条 antiad_log 写进文件存档。
// 传入 id 而不是整行：调用方刚做完 INSERT，让存档自己读回，字段口径只有
// 一处（antiad_log 的列定义），以后加列也不会两边漂移。
func RecordJudgment(b *core.Bot, id int64) {
	if id <= 0 {
		return
	}
	// 先看开关再读库：默认关闭时这条路径零数据库访问。
	if b.Cache.Snap().BotSettingInt(b.BotID(), "archive_enabled", 0) != 1 {
		return
	}
	var rec JudgmentRecord
	var so, llm string
	err := b.Store.Read.QueryRow(`SELECT id,bot_id,chat_id,user_id,message_id,
		user_name,text,verdict,confidence,decider,ad_kind,action,reason,
		prompt_tokens,completion_tokens,quota_cost,created_at,so_verdict,llm_verdict
		FROM antiad_log WHERE id=?`, id).
		Scan(&rec.ID, &rec.BotID, &rec.ChatID, &rec.UserID, &rec.MessageID,
			&rec.UserName, &rec.Text, &rec.Verdict, &rec.Confidence, &rec.Decider,
			&rec.Kind, &rec.Action, &rec.Reason, &rec.PromptTokens,
			&rec.CompletionTokens, &rec.QuotaCost, &rec.CreatedAt, &so, &llm)
	if err != nil {
		return
	}
	if !Enabled(b, rec.ChatID) {
		return
	}
	rec.Type = "judgment"
	rec.Source = "live"
	rec.SoVerdict = rawJSON(so)
	rec.LlmVerdict = rawJSON(llm)
	if !claim(b, "judgment", rec.ChatID, rec.ID, rec.CreatedAt) {
		return
	}
	if _, err := appendRecord(b, rec.ChatID, "judgments", rec.CreatedAt, rec); err != nil {
		slog.Error("存档：写入判定流水失败", "chat", rec.ChatID, "id", rec.ID, "err", err)
		release(b, "judgment", rec.ChatID, rec.ID)
	}
}

// rawJSON 只把合法 JSON 作为对象嵌入；历史脏数据按空处理，不让一行坏
// JSON 拖垮整条存档。
func rawJSON(s string) json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" || !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

// ---- 导出 ----

// ExportChat 把某个群在 SQLite 里的历史记录导出到存档目录。
//
// 只导出仍留在库里的数据：group_messages 的原文与 antiad_log 的判定。
// 历史图片的 file_id 没有落库，Bot API 也取不回来，所以旧记录只有文字。
// 导出与实时存档共用 archive_items 去重，重复执行不会写出重复行。
//
// botIDs 为 nil 表示不按 bot 过滤（主管理员）；否则只导出这些 bot 的
// 判定流水。群消息表没有 bot_id 列，按群导出即可。
func ExportChat(b *core.Bot, chatID int64, botIDs []int64) (Stats, error) {
	st := Stats{Dir: chatDir(b, chatID)}
	if err := os.MkdirAll(st.Dir, 0o755); err != nil {
		return st, err
	}

	var lastErr error

	rows, err := b.Store.Read.Query(`SELECT chat_id,message_id,user_id,text,at,media_group,punished
		FROM group_messages WHERE chat_id=? ORDER BY at,message_id`, chatID)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var rec MessageRecord
		var punished int64
		if err := rows.Scan(&rec.ChatID, &rec.MessageID, &rec.UserID, &rec.Text,
			&rec.Date, &rec.MediaGroupID, &punished); err != nil {
			lastErr = err
			continue
		}
		rec.Punished = punished == 1
		if !claim(b, "message", rec.ChatID, rec.MessageID, rec.Date) {
			st.Skipped++
			continue
		}
		rec.Type = "message"
		rec.Kind = "text"
		rec.Source = "export"
		rec.Text = core.TruncateRunes(rec.Text, textLimit)
		if rec.Text == "" {
			// 旧库里的纯图片/贴纸只留了 message_id，原文早已取不回来。
			rec.Kind = "media"
		}
		if _, err := appendRecord(b, rec.ChatID, "messages", rec.Date, rec); err != nil {
			release(b, "message", rec.ChatID, rec.MessageID)
			lastErr = err
			continue
		}
		st.Messages++
	}
	rows.Close()
	if err := rows.Err(); err != nil && lastErr == nil {
		lastErr = err
	}

	q := `SELECT id,bot_id,chat_id,user_id,message_id,user_name,text,verdict,
		confidence,decider,ad_kind,action,reason,prompt_tokens,completion_tokens,
		quota_cost,created_at,so_verdict,llm_verdict
		FROM antiad_log WHERE chat_id=?`
	args := []any{chatID}
	if botIDs != nil {
		if len(botIDs) == 0 {
			return st, lastErr
		}
		ph := make([]string, len(botIDs))
		for i, id := range botIDs {
			ph[i] = "?"
			args = append(args, id)
		}
		q += ` AND bot_id IN (` + strings.Join(ph, ",") + `)`
	}
	q += ` ORDER BY created_at,id`

	rows, err = b.Store.Read.Query(q, args...)
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var rec JudgmentRecord
		var so, llm string
		if err := rows.Scan(&rec.ID, &rec.BotID, &rec.ChatID, &rec.UserID,
			&rec.MessageID, &rec.UserName, &rec.Text, &rec.Verdict, &rec.Confidence,
			&rec.Decider, &rec.Kind, &rec.Action, &rec.Reason, &rec.PromptTokens,
			&rec.CompletionTokens, &rec.QuotaCost, &rec.CreatedAt, &so, &llm); err != nil {
			lastErr = err
			continue
		}
		if !claim(b, "judgment", rec.ChatID, rec.ID, rec.CreatedAt) {
			st.Skipped++
			continue
		}
		rec.Type = "judgment"
		rec.Source = "export"
		rec.SoVerdict = rawJSON(so)
		rec.LlmVerdict = rawJSON(llm)
		if _, err := appendRecord(b, rec.ChatID, "judgments", rec.CreatedAt, rec); err != nil {
			release(b, "judgment", rec.ChatID, rec.ID)
			lastErr = err
			continue
		}
		st.Judgments++
	}
	rows.Close()
	if err := rows.Err(); err != nil && lastErr == nil {
		lastErr = err
	}

	// 图片在旧库里没有单独存放，但识图请求体里带着 base64。尽力按描述
	// 与时间窗把能对上的图片补回本群目录。
	recoverAILogImages(b, chatID, &st)

	return st, lastErr
}
