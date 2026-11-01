package upstream

// 多模态载荷经 BuildBody 到 anthropic / responses 渠道的翻译。识图的
// user content 是 [文本, 图片] 数组：anthropic 要拆成 image/base64 块，
// responses 要翻成 input_image——把数组压成字符串会把 base64 当正文
// 发出去，模型看不到图（2026-11-01 识图误封事故的根因）。

import (
	"encoding/json"
	"strings"
	"testing"
)

// visionPayload 构造与 antiad.ocrVisual / visionVisual 同形状的载荷：
// user content 为 [文本指令, image_url data URL] 数组。
func visionPayload() map[string]any {
	return map[string]any{
		"temperature": 0,
		"stream":      true,
		"messages": []any{
			map[string]any{"role": "system", "content": "You are an OCR engine."},
			map[string]any{"role": "user", "content": []any{
				map[string]any{"type": "text", "text": "Describe this image."},
				map[string]any{"type": "image_url", "image_url": map[string]any{
					"url": "data:image/webp;base64,UklGRg=="}}},
			},
		},
	}
}

// TestBuildBodyAnthropicKeepsImage：anthropic 渠道把图片数组翻成 image
// 块，data URL 拆出 media_type 与 base64；文本与 system 原样保留。
func TestBuildBodyAnthropicKeepsImage(t *testing.T) {
	u := &Upstream{Name: "a", Kind: KindAnthropic}
	body := u.BuildBody(EPChat, "a/claude-haiku-5-5", visionPayload())

	msgs, ok := body["messages"].([]map[string]any)
	if !ok || len(msgs) != 1 {
		t.Fatalf("应只有一条 user 消息: %v", body["messages"])
	}
	blocks, ok := msgs[0]["content"].([]map[string]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("user content 应翻成 [文本, 图片] 两个块: %v", msgs[0]["content"])
	}
	if blocks[0]["type"] != "text" || blocks[0]["text"] != "Describe this image." {
		t.Errorf("文本块丢了: %v", blocks[0])
	}
	img, ok := blocks[1]["source"].(map[string]any)
	if !ok || blocks[1]["type"] != "image" {
		t.Fatalf("图片块应翻成 image/source: %v", blocks[1])
	}
	if img["type"] != "base64" || img["media_type"] != "image/webp" || img["data"] != "UklGRg==" {
		t.Errorf("base64 source 拆解不对: %v", img)
	}

	sys, ok := body["system"].([]map[string]any)
	if !ok || len(sys) != 1 || sys[0]["text"] != "You are an OCR engine." {
		t.Errorf("system 应为单条文本块: %v", body["system"])
	}
}

// TestBuildBodyResponsesKeepsImage：responses 渠道把图片数组翻成
// input_image，data URL 原样放进 image_url；文本走 input_text。
func TestBuildBodyResponsesKeepsImage(t *testing.T) {
	u := &Upstream{Name: "r", Kind: KindOpenAIResp}
	body := u.BuildBody(EPChat, "r/gpt-x", visionPayload())

	input, ok := body["input"].([]map[string]any)
	if !ok || len(input) != 1 {
		t.Fatalf("应只有一条 user 输入: %v", body["input"])
	}
	blocks, ok := input[0]["content"].([]map[string]any)
	if !ok || len(blocks) != 2 {
		t.Fatalf("content 应翻成 [input_text, input_image]: %v", input[0]["content"])
	}
	if blocks[0]["type"] != "input_text" || blocks[0]["text"] != "Describe this image." {
		t.Errorf("文本块不对: %v", blocks[0])
	}
	if blocks[1]["type"] != "input_image" || blocks[1]["image_url"] != "data:image/webp;base64,UklGRg==" {
		t.Errorf("图片块不对: %v", blocks[1])
	}
	if body["instructions"] != "You are an OCR engine." {
		t.Errorf("instructions 丢了: %v", body["instructions"])
	}
}

// TestBuildBodyAnthropicRemoteImageURL：远程图片 URL 走 url source，
// 不该被拆成 base64。
func TestBuildBodyAnthropicRemoteImageURL(t *testing.T) {
	u := &Upstream{Name: "a", Kind: KindAnthropic}
	payload := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": "image_url", "image_url": map[string]any{
				"url": "https://example.com/x.jpg"}}}}},
	}
	body := u.BuildBody(EPChat, "a/m", payload)
	msgs := body["messages"].([]map[string]any)
	blocks := msgs[0]["content"].([]map[string]any)
	img := blocks[0]["source"].(map[string]any)
	if img["type"] != "url" || img["url"] != "https://example.com/x.jpg" {
		t.Errorf("远程 URL 应走 url source: %v", img)
	}
}

// TestBuildBodyPlainTextUnchanged：纯文本载荷（判定链路的主形态）经
// anthropic / responses 组装后与字符串时代逐字节一致，别让这次改动
// 碰坏既有请求。
func TestBuildBodyPlainTextUnchanged(t *testing.T) {
	payload := map[string]any{
		"temperature": 0,
		"messages": []any{
			map[string]any{"role": "system", "content": "sys"},
			map[string]any{"role": "user", "content": "hello"},
		},
	}
	for name, u := range map[string]*Upstream{
		"anthropic": {Name: "a", Kind: KindAnthropic},
		"responses": {Name: "r", Kind: KindOpenAIResp},
	} {
		body := u.BuildBody(EPChat, "x/m", payload)
		key := "messages"
		if name == "responses" {
			key = "input"
		}
		b, err := json.Marshal(body[key])
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), `"content":"hello"`) {
			t.Errorf("%s：纯文本 content 应保持字符串形状: %s", name, b)
		}
	}
}
