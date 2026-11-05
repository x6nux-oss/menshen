package antiad

// ---- 链接预览：把消息里的 t.me 链接展开成预览页的标题与正文 ----
//
// 群里「发射即走」的引流消息经常只有一个链接：正文没有任何可判的文字，
// 载荷全在链接指向的那条频道帖子或频道简介里（典型是带 ref / aff 的邀请
// 链接）。Bot API 不会把别人消息的链接预览推给 bot，所以这里按 Telegram
// 自己生成的公开预览页取一份：t.me 页面的 og:title / og:description 与
// 客户端显示的链接预览同源，未登录也能取到。
//
// 只展开 t.me 的公开频道/帖子链接：
//   - 任意站点都取会把判定变成爬虫，并引入 SSRF 面；这里只碰 Telegram
//     自己的域名。
//   - t.me/+xxx 与 t.me/joinchat 是私密邀请，预览页没有内容（提示词已按
//     强信号处理）。
//
// 取到的内容只作证据进判定载荷，不进留底：留底是审计口径，记的是本人
// 实际发了什么。

import (
	"html"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"menshen/internal/core"
	"menshen/internal/store"
	"menshen/internal/tg"
)

const (
	// linkPreviewMax 是一条消息最多展开的链接数。正文里塞几十个 t.me 链接
	// 的号不值得逐个取。
	linkPreviewMax = 2
	// linkPreviewTextLimit 是单条预览正文的字符上限。预览页的 og:description
	// 是摘要，正常远小于它；截断防的是页面结构异常或对方塞一屏。
	linkPreviewTextLimit = 600
	// linkPreviewTTL 是预览结果的缓存时长。同一链接被反复转发（刷屏式引流）
	// 时只取一次；频道帖子改了内容，最多这么久后重新反映到判定里。
	linkPreviewTTL = 6 * time.Hour
)

// adLinkPreview 是一条链接的公开预览。URL 是链接本身（与正文里的写法可能
// 不同：统一成 https://t.me/...）。From 是发布者/频道名，Text 是预览页给出的
// 正文摘要。
type adLinkPreview struct {
	URL  string `json:"url"`
	From string `json:"from,omitempty"`
	Text string `json:"text"`
}

// tgLink 是一条 t.me 链接拆出来的目标。
type tgLink struct {
	URL    string
	Handle string
	ID     string
}

// tgLinkRe 匹配 t.me 的公开频道/帖子链接。t.me/s/<user>/<id> 是网页版预览
// 路径，与短链接指向同一条帖子，一并认。私密邀请（+xxx / joinchat）不带
// 公开用户名，不在此列。
var tgLinkRe = regexp.MustCompile(
	`(?i)(?:https?://)?(?:t\.me|telegram\.me|telegram\.dog)/(?:s/)?([A-Za-z][A-Za-z0-9_]{3,31})(?:/(\d{1,12}))?`)

// tgReservedHandles 是 t.me 上不是频道/帖子的固定路径。它们指向分享、
// 贴纸包、代理之类的功能页，预览页没有可判内容。
var tgReservedHandles = map[string]bool{
	"joinchat":    true,
	"addstickers": true,
	"share":       true,
	"proxy":       true,
	"socks":       true,
	"login":       true,
	"setlanguage": true,
	"boost":       true,
	"contact":     true,
}

// telegramLinks 取出文本里的 t.me 公开链接，去重保序，最多 linkPreviewMax 条。
func telegramLinks(text string) []tgLink {
	var out []tgLink
	seen := map[string]bool{}
	for _, m := range tgLinkRe.FindAllStringSubmatchIndex(text, -1) {
		// 嵌在别的 URL 中间的不算：example.com/t.me/xxx 是别人的链接，
		// 不是 Telegram 的。
		if m[0] > 0 {
			if r, _ := utf8.DecodeLastRuneInString(text[:m[0]]); linkContinuation(r) {
				continue
			}
		}
		handle := text[m[2]:m[3]]
		if tgReservedHandles[strings.ToLower(handle)] {
			continue
		}
		id := ""
		if m[4] >= 0 {
			id = text[m[4]:m[5]]
		}
		u := "https://t.me/" + handle
		if id != "" {
			u += "/" + id
		}
		if seen[u] {
			continue
		}
		seen[u] = true
		out = append(out, tgLink{URL: u, Handle: handle, ID: id})
		if len(out) == linkPreviewMax {
			break
		}
	}
	return out
}

// linkContinuation 报告 r 是否说明匹配点落在另一个 URL 中间。
func linkContinuation(r rune) bool {
	return r == '/' || r == '.' || r == '_' || r == '-' ||
		unicode.IsLetter(r) || unicode.IsDigit(r)
}

// linkSourceText 是链接提取的取值口径：本人正文、配文，以及正文里内联
// 链接的目标（text_link 的 URL，正文里只显示一段文字的那种）。
//
// 不看按钮与卡片 URL：那是消息附件的一部分，不是本人写下的链接，逐条展开
// 只会把判定拖慢；正文里的链接才是「只发一个链接」的载体。
func linkSourceText(m *tg.Message) string {
	var sb strings.Builder
	if m.Text != "" {
		sb.WriteString(m.Text)
	} else if m.Caption != "" {
		sb.WriteString(m.Caption)
	}
	for _, es := range [][]tg.MessageEntity{m.Entities, m.CaptionEntities} {
		for _, e := range es {
			if e.Type == "text_link" && e.URL != "" {
				sb.WriteString("\n")
				sb.WriteString(e.URL)
			}
		}
	}
	return sb.String()
}

// linkPreviewBase / linkPreviewClient 可被测试替换。Transport 为 nil：读
// HTTP_PROXY / HTTPS_PROXY 环境变量，与取 bot 简介同一个思路。
var (
	linkPreviewBase   = "https://t.me/"
	linkPreviewClient = &http.Client{Timeout: 6 * time.Second}
)

var (
	ogTitleRe = regexp.MustCompile(`<meta property="og:title" content="([^"]*)"`)
	ogDescRe  = regexp.MustCompile(`<meta property="og:description" content="([^"]*)"`)
)

// previewPageURL 是取预览用的地址。统一走 t.me 主域：链接里带的
// telegram.me / t.me/s/ 等写法都能落到同一页。
func previewPageURL(l tgLink) string {
	u := linkPreviewBase + l.Handle
	if l.ID != "" {
		u += "/" + l.ID
	}
	return u
}

// fetchLinkPreview 取一页公开预览的标题与正文。取不到（网络不可用、页面
// 已删、结构变化）返回只带 URL 的空预览，与「没有可判内容」同向。
func fetchLinkPreview(u string) adLinkPreview {
	p := adLinkPreview{URL: u}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return p
	}
	// 不带浏览器 UA 时预览页会返回无 og meta 的精简版。
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; menshen-antiad/1.0)")
	resp, err := linkPreviewClient.Do(req)
	if err != nil {
		slog.Debug("反广告：读取链接预览失败", "url", u, "err", err)
		return p
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return p
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 128<<10))
	if err != nil {
		return p
	}
	p.From = core.TruncateRunes(ogContent(ogTitleRe, raw), 100)
	p.Text = core.TruncateRunes(ogContent(ogDescRe, raw), linkPreviewTextLimit)
	return p
}

// ogContent 取一个 og meta 的取值并反转义。
func ogContent(re *regexp.Regexp, raw []byte) string {
	m := re.FindSubmatch(raw)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(html.UnescapeString(string(m[1])))
}

// enrichLinkPreviews 把消息里 t.me 链接的公开预览补进送检载荷。在判定
// worker 上跑：取预览是网络往返，不能占住串行的更新处理。
func enrichLinkPreviews(b *core.Bot, snap *store.Snapshot, conf store.BotChat,
	m *tg.Message, st *adState) {
	st.Message.LinkPreviews = linkPreviews(b, snap, conf, m)
}

// linkPreviews 取这次判定要带的链接预览。
func linkPreviews(b *core.Bot, snap *store.Snapshot, conf store.BotChat,
	m *tg.Message) []adLinkPreview {

	if snap.BotSettingInt(b.BotID(), "antiad_link_preview", 1) != 1 {
		return nil
	}
	links := telegramLinks(linkSourceText(m))
	if len(links) == 0 {
		return nil
	}
	caches := cachesOf(b.Shared)
	now := time.Now().Unix()
	var out []adLinkPreview
	for _, l := range links {
		key := strings.ToLower(l.URL)
		// 跳过判断先于缓存：预览缓存按链接全局共享，若先取缓存，一个群
		// 取过的内容会绕过另一个群的白名单/关联频道限制。跳过取决于配置，
		// 不缓存跳过结果，配置变了立刻生效。
		if skipLinkPreview(b, snap, conf, m, l, now) {
			continue
		}
		if p, ok := caches.linkPreview.Get(key); ok {
			if p.Text != "" {
				out = append(out, p)
			}
			continue
		}
		p := fetchLinkPreview(previewPageURL(l))
		caches.linkPreview.Set(key, p, linkPreviewTTL)
		if p.Text != "" {
			out = append(out, p)
		}
	}
	return out
}

// skipLinkPreview 报告这个链接是否不该展开。
//
// 三类别：
//   - 本群自己（链接指向群内消息/群主页）
//   - 本群的关联频道（linked_chat_id）：它的帖子本来就会自动转发进群，
//     展开只是重复；讨论区里贴回来也不该当成外部载荷
//   - 目标频道已在本群白名单里（/white 或 ad_whitelist）
//
// 解析不出目标的链接照常展开：公开预览页本身不要求 bot 有访问权。
func skipLinkPreview(b *core.Bot, snap *store.Snapshot, conf store.BotChat,
	m *tg.Message, l tgLink, now int64) bool {

	if conf.Username != "" && strings.EqualFold(l.Handle, conf.Username) {
		return true
	}
	if m.Chat != nil && m.Chat.Username != "" && strings.EqualFold(l.Handle, m.Chat.Username) {
		return true
	}
	info := resolveLink(b, l.Handle)
	if info.ID == 0 {
		return false
	}
	if info.ID == conf.ChatID {
		return true
	}
	// 普通用户主页的预览页只有一句「You can contact @xxx right away.」，
	// 没有可判内容，不值得多取一次。bot 的预览页给的是它的简介
	// （setdescription），那正是返利/引流 bot 的广告位，照常展开。
	if info.Kind == "user" {
		return true
	}
	if info.ID < 0 && IsChatAdmin(b, conf.ChatID, info.ID) {
		return true // 本群的关联频道
	}
	if snap.Whitelisted(b.BotID(), conf.ChatID, info.ID, now) {
		return true
	}
	return isGroupWhitelisted(b, conf.ChatID, info.ID)
}
