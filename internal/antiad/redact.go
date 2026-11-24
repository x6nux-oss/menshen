package antiad

import (
	"html"
	"regexp"
	"strings"
)

// ---- 敏感标识打码 ----
//
// 判定流水里的原文与理由常带广告号自己的返利 ID、邀请码与深链。这些字段
// 会被发到群里（/check、告警卡）、私聊与网页：原样显示等于替对方再发一次，
// 也会把管理员自己的账号信息带出去。
//
// 打码只发生在渲染层：DB 与判定逻辑仍保留原文（证据要可复查）。

var (
	// urlRe 抓出整条 URL，供打码后改用 <code> 展示（TG 不再自动挂链接，
	// 打码后的参数也就不会被点到）。
	urlRe = regexp.MustCompile(`(?i)\b(?:https?://|t\.me/|telegram\.me/)[^\s<>"'()\[\]{}，。；：！？、）】》]+`)
	// queryRe 抓 start=/ref=/inv= 这类承载用户 ID 的查询参数。
	queryRe    = regexp.MustCompile(`(?i)([?&](?:start|ref|inv|referrer)=)([^&#\s]*)`)
	paramNumRe = regexp.MustCompile(`\d+`)
	// inviteRe 抓带标签的邀请码/助力码：我的邀请码:WG9EWW。
	inviteRe = regexp.MustCompile(`(邀请码|助力码)([ \t]*[:：=]?[ \t]*)([A-Za-z0-9]{4,})`)
	// idRe 抓带标签的数字 ID：ID:5038355277、用户 5038355277。
	idRe = regexp.MustCompile(`(?i)(\b(?:id|uid)\b|用户ID|用户|账号|帐号|telegram|tg|qq|微信|vx)([ \t]*[:：=]?[ \t]*)(\d{4,})`)
	// longNumRe 抓裸的 7 位以上数字串（TG/QQ 用户 ID 量级）。
	longNumRe = regexp.MustCompile(`\d{7,}`)
	// upperCodeRe 抓裸的大写邀请码（WG9EWW）。纯字母词（TELEGRAM）不碰。
	upperCodeRe = regexp.MustCompile(`\b[A-Z0-9]{6,12}\b`)
)

// MaskSensitive 打码一段原文里的 ID、邀请码与返利深链参数，返回纯文本。
// 网页/JSON 输出用它：不转义、不加标签，由前端按既有方式渲染。
func MaskSensitive(raw string) string {
	return replaceURLs(raw, maskURL)
}

// SensitiveHTML 把原文/理由渲染成 TG HTML：打码 + 转义，整段包进 spoiler。
//
// TG 只在 Bot API 7.0+ 支持 tg-spoiler；项目要求的最低版本已在其上。
// spoiler 内的 <code> 仍正常渲染，因此 URL 单独用 <code> 包住。
func SensitiveHTML(raw string) string {
	return `<span class="tg-spoiler">` + maskedHTML(raw) + `</span>`
}

// sensitiveCode 是 SensitiveHTML 的等宽版本（原文块用）。
func sensitiveCode(raw string) string {
	return `<span class="tg-spoiler"><code>` +
		html.EscapeString(MaskSensitive(raw)) + `</code></span>`
}

// maskedHTML 转义并打码，URL 改成不可点的 <code>。
func maskedHTML(raw string) string {
	var sb strings.Builder
	last := 0
	for _, loc := range urlRe.FindAllStringIndex(raw, -1) {
		sb.WriteString(escapedMask(raw[last:loc[0]]))
		sb.WriteString("<code>" + html.EscapeString(maskURL(raw[loc[0]:loc[1]])) + "</code>")
		last = loc[1]
	}
	sb.WriteString(escapedMask(raw[last:]))
	return sb.String()
}

func escapedMask(s string) string { return html.EscapeString(maskTokens(s)) }

func replaceURLs(raw string, f func(string) string) string {
	var sb strings.Builder
	last := 0
	for _, loc := range urlRe.FindAllStringIndex(raw, -1) {
		sb.WriteString(maskTokens(raw[last:loc[0]]))
		sb.WriteString(f(raw[loc[0]:loc[1]]))
		last = loc[1]
	}
	sb.WriteString(maskTokens(raw[last:]))
	return sb.String()
}

// maskURL 只打码 URL 里的 ID 参数，保留域名与路径：仍能看出是哪个 bot 的
// 返利深链，但参数已经不可用。
func maskURL(u string) string {
	u = queryRe.ReplaceAllStringFunc(u, func(m string) string {
		sub := queryRe.FindStringSubmatch(m)
		return sub[1] + paramNumRe.ReplaceAllStringFunc(sub[2], maskDigits)
	})
	return maskTokens(u)
}

func maskTokens(s string) string {
	s = inviteRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := inviteRe.FindStringSubmatch(m)
		return sub[1] + sub[2] + maskCode(sub[3])
	})
	s = idRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := idRe.FindStringSubmatch(m)
		return sub[1] + sub[2] + maskDigits(sub[3])
	})
	s = longNumRe.ReplaceAllStringFunc(s, maskDigits)
	return upperCodeRe.ReplaceAllStringFunc(s, func(tok string) string {
		if !strings.ContainsAny(tok, "0123456789") {
			return tok // 纯字母是普通单词，不是邀请码
		}
		return maskCode(tok)
	})
}

// maskDigits 保留前 2 位与后 3 位；不足 5 位时只留首尾。
func maskDigits(s string) string {
	r := []rune(s)
	if len(r) >= 5 {
		return string(r[:2]) + "****" + string(r[len(r)-3:])
	}
	if len(r) >= 3 {
		return string(r[0]) + "****" + string(r[len(r)-1])
	}
	return strings.Repeat("*", len(r))
}

// maskCode 保留前 2 位与后 2 位；不足 6 位时只留首尾。
func maskCode(s string) string {
	r := []rune(s)
	if len(r) >= 6 {
		return string(r[:2]) + "**" + string(r[len(r)-2:])
	}
	if len(r) >= 3 {
		return string(r[0]) + "**" + string(r[len(r)-1])
	}
	return strings.Repeat("*", len(r))
}
