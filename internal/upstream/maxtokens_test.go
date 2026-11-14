package upstream

// 默认输出上限（DefaultMaxTokens）这条路的两端：各渠道请求体里补上默认值
// （BuildBody），以及「模型不接受这个上限」的识别与降级。

import "testing"

// TestBuildBodyDefaultMaxTokens：chat 请求没写上限时各渠道都补 32k（字段名
// 按渠道）；调用方写了的原样保留；被拒过的模型退回老行为 —— 不传上限，
// Anthropic 必填则给 8192；载荷本身不被改动。
func TestBuildBodyDefaultMaxTokens(t *testing.T) {
	payload := map[string]any{"messages": []map[string]string{{"role": "user", "content": "x"}}}
	capOf := func(kind Kind, b map[string]any) any {
		switch kind {
		case KindOpenAIResp:
			return b["max_output_tokens"]
		case KindGemini:
			gen, _ := b["generationConfig"].(map[string]any)
			return gen["maxOutputTokens"]
		}
		return b["max_tokens"]
	}
	kinds := []Kind{KindOpenAI, KindOpenAIResp, KindAnthropic, KindGemini, KindCloudflare}
	for _, k := range kinds {
		u := &Upstream{Name: "u", Kind: k}
		if got := capOf(k, u.BuildBody(EPChat, "u/m", payload)); got != DefaultMaxTokens {
			t.Errorf("%s：没写上限时应补 %d，得到 %v", k, DefaultMaxTokens, got)
		}
		own := map[string]any{"messages": payload["messages"], "max_tokens": 8}
		if got := capOf(k, u.BuildBody(EPChat, "u/m", own)); got != 8 {
			t.Errorf("%s：调用方写了上限应原样保留，得到 %v", k, got)
		}
	}
	if b := (&Upstream{Name: "o"}).BuildBody(EPSystemOne, "o/jev", map[string]any{"state": "x"}); b["max_tokens"] != nil {
		t.Errorf("systemone 不是对话协议，不该补上限: %v", b)
	}

	const rejected = "no-32k-model"
	MarkMaxTokensRejected(rejected)
	defer ClearMaxTokensRejected(rejected)
	for _, k := range kinds {
		want := any(nil)
		if k == KindAnthropic {
			want = fallbackMaxTokens
		}
		u := &Upstream{Name: "u", Kind: k}
		if got := capOf(k, u.BuildBody(EPChat, "u/"+rejected, payload)); got != want {
			t.Errorf("%s：被拒过的模型应退回 %v，得到 %v", k, want, got)
		}
	}
	if _, ok := payload["max_tokens"]; ok {
		t.Error("BuildBody 不该改动调用方的载荷")
	}
}

// TestMaxTokensRejected：4xx 且消息指向输出上限字段才算。
func TestMaxTokensRejected(t *testing.T) {
	cases := []struct {
		name   string
		status int
		msg    string
		want   bool
	}{
		{"OpenAI 超上限", 400, "max_tokens is too large: 32768. This model supports at most 16384 completion tokens", true},
		{"OpenAI 推理模型", 400, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", true},
		{"DeepSeek", 400, "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]", true},
		{"Anthropic", 400, "max_tokens: 32768 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku", true},
		{"Responses", 400, "max_output_tokens must be at most 16384", true},
		{"Gemini", 400, "maxOutputTokens is out of range", true},
		{"上游故障", 503, "max_tokens backend overloaded", false},
		{"与参数无关", 400, "`temperature` is deprecated for this model", false},
		{"没有正文", 400, "", false},
	}
	for _, c := range cases {
		if got := MaxTokensRejected(c.status, c.msg); got != c.want {
			t.Errorf("%s：want %v got %v", c.name, c.want, got)
		}
	}
}
