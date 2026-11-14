package upstream

// 思考强度（reasoning_effort）这条路的两端：各渠道请求体里的字段形状
// （BuildBody），以及「模型不接受该参数」的识别（EffortRejected）。

import (
	"reflect"
	"testing"
)

// TestBuildBodyReasoningEffort：载荷里的 reasoning_effort 按渠道翻成各家
// 的字段；被拒过的模型各渠道都不再带；载荷本身不被改动。
func TestBuildBodyReasoningEffort(t *testing.T) {
	payload := map[string]any{
		"reasoning_effort": "low",
		"messages":         []map[string]string{{"role": "user", "content": "x"}},
	}
	low := map[string]any{"effort": "low"}

	o := &Upstream{Name: "o"}
	if b := o.BuildBody(EPChat, "o/m", payload); b["reasoning_effort"] != "low" {
		t.Errorf("OpenAI 渠道应原样带 reasoning_effort: %v", b)
	}
	r := &Upstream{Name: "r", Kind: KindOpenAIResp}
	if b := r.BuildBody(EPChat, "r/m", payload); !reflect.DeepEqual(b["reasoning"], low) {
		t.Errorf("Responses 渠道应翻成 reasoning.effort: %v", b)
	}
	a := &Upstream{Name: "a", Kind: KindAnthropic}
	if b := a.BuildBody(EPChat, "a/m", payload); !reflect.DeepEqual(b["output_config"], low) {
		t.Errorf("Anthropic 渠道应翻成 output_config.effort: %v", b)
	}
	// 载荷没写就不带：不替模型做主。
	if b := a.BuildBody(EPChat, "a/m", map[string]any{"messages": payload["messages"]}); b["output_config"] != nil {
		t.Errorf("没传思考强度时 Anthropic 不该带 output_config: %v", b)
	}

	const rejected = "no-effort-buildbody"
	MarkEffortUnsupported(rejected)
	defer ClearEffortUnsupported(rejected)
	for name, u := range map[string]*Upstream{"openai": o, "responses": r, "anthropic": a} {
		b := u.BuildBody(EPChat, "x/"+rejected, payload)
		if b["reasoning_effort"] != nil || b["reasoning"] != nil || b["output_config"] != nil {
			t.Errorf("%s：被拒思考强度的模型不该带该参数: %v", name, b)
		}
	}
	if payload["reasoning_effort"] != "low" {
		t.Error("BuildBody 不该改动调用方的载荷")
	}
}

// TestEffortRejected：4xx 且消息指向思考强度字段才算。
func TestEffortRejected(t *testing.T) {
	cases := []struct {
		name   string
		status int
		msg    string
		want   bool
	}{
		{"OpenAI 文案", 400, "Unsupported parameter: 'reasoning_effort' is not supported with this model.", true},
		{"Responses 文案", 400, "Unsupported parameter: 'reasoning.effort' is not supported with this model.", true},
		{"Claude 文案", 400, "This model does not support the effort parameter.", true},
		{"严格校验的网关", 422, "output_config: Extra inputs are not permitted", true},
		{"上游故障", 503, "effort backend overloaded", false},
		{"与参数无关", 400, "`temperature` is deprecated for this model", false},
		{"没有正文", 400, "", false},
	}
	for _, c := range cases {
		if got := EffortRejected(c.status, c.msg); got != c.want {
			t.Errorf("%s：want %v got %v", c.name, c.want, got)
		}
	}
}
