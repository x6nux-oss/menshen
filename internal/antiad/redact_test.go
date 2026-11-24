package antiad

import (
	"strings"
	"testing"
)

// TestMaskSensitive 覆盖 issue 里给出的真实样例：返利深链里的用户 ID 与
// 邀请码都要打码，但仍能看出是哪种链接/码。
func TestMaskSensitive(t *testing.T) {
	cases := []struct{ in, want string }{
		{
			"https://t.me/sondevstorebot?start=ref_5038355277",
			"https://t.me/sondevstorebot?start=ref_50****277",
		},
		{"我的邀请码:WG9EWW", "我的邀请码:WG**WW"}, // 前2+后2：WG9EWW 的后两位是 WW
		{"ID 5038355277", "ID 50****277"},
		{"助力码：AB12CD34", "助力码：AB**34"},
		{"?start=ref_/inv_123456789", "?start=ref_/inv_12****789"},
		// 普通数字与结论性文字不受影响。
		{"置信度 92%，危害度 2.2，命中 3 次", "置信度 92%，危害度 2.2，命中 3 次"},
	}
	for _, c := range cases {
		if got := MaskSensitive(c.in); got != c.want {
			t.Errorf("MaskSensitive(%q) = %q，应为 %q", c.in, got, c.want)
		}
	}
}

// TestMaskSensitiveKeepsConclusion：结论、置信度、动作、群名这类判断文本
// 不能被误伤。
func TestMaskSensitiveKeepsConclusion(t *testing.T) {
	const text = "广告 · 诈骗引流 · 删除消息 + 永久禁言，置信度 95%，群 门神测试群"
	if got := MaskSensitive(text); got != text {
		t.Fatalf("判断文本被改动：%q", got)
	}
}

// TestSensitiveHTMLSpoiler：TG 输出必须包 spoiler，URL 用 <code> 且已打码。
func TestSensitiveHTMLSpoiler(t *testing.T) {
	out := SensitiveHTML("我的邀请码:WG9EWW https://t.me/sondevstorebot?start=ref_5038355277")
	if !strings.Contains(out, `<span class="tg-spoiler">`) {
		t.Errorf("应使用 TG spoiler：%s", out)
	}
	for _, leak := range []string{"WG9EWW", "5038355277"} {
		if strings.Contains(out, leak) {
			t.Errorf("不应出现完整敏感值 %q：%s", leak, out)
		}
	}
	if !strings.Contains(out, `<code>https://t.me/sondevstorebot?start=ref_50****277</code>`) {
		t.Errorf("URL 应打码并用 <code> 包住：%s", out)
	}
}

// TestSensitiveHTMLNoLeakInReason：理由里的 ID 不出现在成品的 HTML 中。
func TestSensitiveHTMLNoLeakInReason(t *testing.T) {
	out := SensitiveHTML("用户 5038355277 反复发返利链接")
	if strings.Contains(out, "5038355277") {
		t.Fatalf("理由仍带完整 ID：%s", out)
	}
	if !strings.Contains(out, "50****277") {
		t.Fatalf("理由应保留打码后的形态：%s", out)
	}
}
