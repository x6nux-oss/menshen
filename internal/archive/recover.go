package archive

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"menshen/internal/core"
)

// ---- 从模型调用流水里找回历史图片 ----
//
// 消息存档上线前，图片本身没有单独的落库位置；但每次识图都会把完整请求
// 体写进 ai_log.input（见 antiad/ailog.go），图片以
// data:image/...;base64,... 的形式嵌在里面。这是旧库里唯一能直接拿到
// 图片字节的地方。
//
// 两个限制决定了它只能「尽力找回」：
//   - ai_log.input 单行上限 64 KB（aiLogInputCap）。图片 base64 通常比
//     这个大，只有较小的一部分图片能完整拿到，其余是截断的半个文件。
//   - ai_log 没有 chat_id / message_id，只能靠识图描述与时间窗去匹配
//     group_messages。匹配不到就不导，避免把别人的图写进这个群。
//
// 因此导出时先按群找出候选消息，再把 ai_log 里带图片的识图流水按描述
// 匹配过去；完整图片走压缩，截断图片原样存成 .partial 文件。

var dataURLRe = regexp.MustCompile(`data:(image/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)`)

// recoverMaxGap 是识别流水与群消息之间允许的时间差。识图在判定 worker
// 上执行，通常晚于消息几秒；队列积压时可能晚几分钟，给到 1 小时。
const recoverMaxGap = int64(3600)

type msgCandidate struct {
	id   int64
	at   int64
	text string
	norm string
}

// recoverAILogImages 把能在 ai_log 里找到、且能匹配到本群消息的历史图片
// 补写进存档。只处理有识图描述的成功调用。
func recoverAILogImages(b *core.Bot, chatID int64, st *Stats) {
	var minTS, maxTS int64
	err := b.Store.Read.QueryRow(`SELECT MIN(ts),MAX(ts) FROM ai_log
		WHERE status='ok' AND input LIKE '%data:image/%'`).Scan(&minTS, &maxTS)
	if err != nil || minTS == 0 || maxTS == 0 {
		return
	}

	cands, err := loadMsgCandidates(b, chatID, minTS-recoverMaxGap, maxTS+recoverMaxGap)
	if err != nil || len(cands) == 0 {
		return
	}

	rows, err := b.Store.Read.Query(`SELECT id,ts,input,output FROM ai_log
		WHERE status='ok' AND input LIKE '%data:image/%'
		AND ts BETWEEN ? AND ? ORDER BY ts`,
		minTS-recoverMaxGap, maxTS+recoverMaxGap)
	if err != nil {
		slog.Warn("存档：读取识图流水失败", "chat", chatID, "err", err)
		return
	}
	defer rows.Close()

	assigned := map[int64]bool{}
	for rows.Next() {
		var id, ts int64
		var input, output string
		if err := rows.Scan(&id, &ts, &input, &output); err != nil {
			continue
		}
		desc := visionDescription(output)
		if desc == "" {
			continue
		}
		imgs := extractDataURLs(input)
		if len(imgs) == 0 {
			continue
		}
		c := matchCandidate(cands, assigned, desc, ts)
		if c == nil {
			continue
		}
		assigned[c.id] = true
		refs := saveRecoveredImages(b, chatID, *c, id, imgs, st)
		rewriteAILogInput(b, id, refs, st)
	}
}

// rewriteAILogInput 把历史 ai_log 行里的图片 base64 换成存档路径占位符。
// 只在确实有存档文件（refs 非空）时替换；没有对上图片的帧保持原样。
func rewriteAILogInput(b *core.Bot, logID int64, refs []string, st *Stats) {
	if len(refs) == 0 {
		return
	}
	var input string
	if err := b.Store.Read.QueryRow(`SELECT input FROM ai_log WHERE id=?`, logID).
		Scan(&input); err != nil {
		return
	}
	out := string(RedactImageDataURLs([]byte(input), refs))
	if out == input {
		return
	}
	if _, err := b.Store.Write.Exec(`UPDATE ai_log SET input=? WHERE id=?`, out, logID); err != nil {
		slog.Warn("存档：回写识图流水占位符失败", "id", logID, "err", err)
		return
	}
	st.Rewritten++
}

// loadMsgCandidates 取本群在这个时间窗里的有正文消息。图片消息的留底
// 正文里带 <image>/<video> 等媒体标签 + 识图描述，描述就是匹配用的键。
func loadMsgCandidates(b *core.Bot, chatID, from, to int64) ([]msgCandidate, error) {
	rows, err := b.Store.Read.Query(`SELECT message_id,at,text FROM group_messages
		WHERE chat_id=? AND at BETWEEN ? AND ? AND text<>''
		AND (text LIKE '%［%' OR text LIKE '%<%') ORDER BY at`,
		chatID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []msgCandidate
	for rows.Next() {
		var c msgCandidate
		if err := rows.Scan(&c.id, &c.at, &c.text); err != nil {
			continue
		}
		c.norm = normalizeSpace(c.text)
		out = append(out, c)
	}
	return out, rows.Err()
}

// matchCandidate 按识图描述找消息：描述是原文里的一段，先按包含关系
// 过滤，再取时间最接近的一条。同一描述在一小时内出现多次时择近，
// 不会把同一张图重复分给两条消息。
func matchCandidate(cands []msgCandidate, assigned map[int64]bool,
	desc string, ts int64) *msgCandidate {
	var best *msgCandidate
	var bestDelta int64
	for i := range cands {
		c := &cands[i]
		if assigned[c.id] || !strings.Contains(c.norm, desc) {
			continue
		}
		d := c.at - ts
		if d < 0 {
			d = -d
		}
		if d > recoverMaxGap {
			continue
		}
		if best == nil || d < bestDelta {
			best, bestDelta = c, d
		}
	}
	return best
}

// visionDescription 从识图响应里取正文；正文为空时用思考内容，与
// antiad.describeVisual 的兜底口径一致。
func visionDescription(raw string) string {
	var resp struct {
		Choices []struct {
			Message struct {
				Content          string `json:"content"`
				ReasoningContent string `json:"reasoning_content"`
				Reasoning        string `json:"reasoning"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal([]byte(raw), &resp) != nil || len(resp.Choices) == 0 {
		return ""
	}
	m := resp.Choices[0].Message
	s := m.Content
	if strings.TrimSpace(s) == "" {
		s = m.ReasoningContent
	}
	if strings.TrimSpace(s) == "" {
		s = m.Reasoning
	}
	return normalizeSpace(s)
}

func normalizeSpace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

type recoveredImage struct {
	data    []byte
	mime    string
	partial bool
	index   int
}

// extractDataURLs 从（可能已被 64 KB 截断的）请求体里抠出所有图片。
// 截断标记只影响最后一处匹配：前面的帧仍然是完整的。
func extractDataURLs(input string) []recoveredImage {
	matches := dataURLRe.FindAllStringSubmatchIndex(input, -1)
	if len(matches) == 0 {
		return nil
	}
	truncated := strings.Contains(input, "已截断")
	var out []recoveredImage
	for i, m := range matches {
		// m: [全匹配起, 全匹配止, mime 起, mime 止, base64 起, base64 止]
		if len(m) < 6 {
			continue
		}
		mime := input[m[2]:m[3]]
		b64 := input[m[4]:m[5]]
		partial := truncated && i == len(matches)-1
		data, err := decodeBase64(b64)
		if err != nil {
			if !partial {
				continue
			}
			partial = true
		}
		if len(data) == 0 {
			continue
		}
		if _, format, err := image.DecodeConfig(bytes.NewReader(data)); err != nil {
			partial = true
		} else if !completeImage(data, format) {
			// 头部能解出来不等于文件完整：被 64 KB 截断的 JPEG 仍可能
			// 带完整的 SOF。再核对文件尾标记。
			partial = true
		}
		out = append(out, recoveredImage{data: data, mime: mime, partial: partial, index: i})
	}
	return out
}

// completeImage 按格式核对文件尾：JPEG 的 EOI、PNG 的 IEND、GIF 的 trailer。
// WebP 等格式没有简单可靠的尾部标记，交给解码器判断。
func completeImage(data []byte, format string) bool {
	switch format {
	case "jpeg":
		return bytes.HasSuffix(data, []byte{0xFF, 0xD9})
	case "png":
		return bytes.HasSuffix(data, []byte("IEND\xaeB`\x82"))
	case "gif":
		return len(data) > 0 && data[len(data)-1] == 0x3B
	default:
		return true
	}
}

func decodeBase64(s string) ([]byte, error) {
	if len(s)%4 == 0 {
		if data, err := base64.StdEncoding.DecodeString(s); err == nil {
			return data, nil
		}
	}
	// 被截断的 base64 尾部可能不足 4 个字符；截到完整分组再用无填充解码。
	s = s[:len(s)-len(s)%4]
	return base64.RawStdEncoding.DecodeString(s)
}

// saveRecoveredImages 把匹配到的图片写到该消息的图片目录。文件名带
// ai_log id，重复导出或同一条消息被多个识图调用命中时不会互相覆盖。
// 返回与 imgs 同序的存档路径（相对存档根目录）；保存失败的位为空串。
func saveRecoveredImages(b *core.Bot, chatID int64, c msgCandidate,
	logID int64, imgs []recoveredImage, st *Stats) []string {
	refs := make([]string, len(imgs))
	loc := b.Cache.Snap().Location()
	day := time.Unix(c.at, 0).In(loc).Format("2006-01-02")
	dir := filepath.Join(chatDir(b, chatID), "images", day)
	// 已经有完整图片（实时存档、MTProto 回捞或上次导出）：只补占位符
	// 指向，不再重复下载/写文件。
	if hasCompleteImage(dir, c.id) {
		for i := range imgs {
			if p := findImagePath(dir, c.id, int64(i)); p != "" {
				refs[i] = relToRoot(b, p)
			}
		}
		return refs
	}
	prefix := strconv.FormatInt(c.id, 10) + "_hist_" + strconv.FormatInt(logID, 10) + "_"
	if old, _ := filepath.Glob(filepath.Join(dir, prefix+"*")); len(old) > 0 {
		for i := range imgs {
			if p := findImagePath(dir, c.id, int64(i)); p != "" {
				refs[i] = relToRoot(b, p)
			}
		}
		return refs
	}
	for _, img := range imgs {
		base := prefix + strconv.Itoa(img.index)
		if img.partial {
			// 截断的图片解码器多半不认，也不再尝试压缩；原样保留，
			// 用 .partial 标出来，日后补全或人工辨认时一眼能看出状态。
			if err := os.MkdirAll(dir, 0o755); err != nil {
				continue
			}
			path := filepath.Join(dir, base+".partial"+extOfMIME(img.mime))
			if err := os.WriteFile(path, img.data, 0o644); err != nil {
				slog.Warn("存档：保存截断图片失败", "chat", chatID, "msg", c.id, "err", err)
				continue
			}
			refs[img.index] = relToRoot(b, path)
			st.Partial++
			continue
		}
		path, err := saveImage(dir, base, img.data, imageMaxSide(b), imageQuality(b), extOfMIME(img.mime))
		if err != nil {
			slog.Warn("存档：保存找回的图片失败", "chat", chatID, "msg", c.id, "err", err)
			continue
		}
		slog.Debug("存档：从识图流水找回图片", "chat", chatID, "msg", c.id, "path", path)
		refs[img.index] = relToRoot(b, path)
		st.Recovered++
	}
	return refs
}
