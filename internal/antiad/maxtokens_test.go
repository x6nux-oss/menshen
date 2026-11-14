package antiad

// 默认输出上限 32k（upstream.DefaultMaxTokens）在判定链路与规则发现两边
// 都生效；模型不接受时与 temperature 同款自愈 —— 记下、退回老行为、立即重发。

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	openai "github.com/meguminnnnnnnnn/go-openai"

	"menshen/internal/testutil"
	"menshen/internal/upstream"
)

// TestChatDefaultMaxTokensSelfHeal：判定链路默认带 32k；上游以 400 拒绝时
// 记下模型、去掉上限立即重发成功，之后同一模型直接不带。
func TestChatDefaultMaxTokensSelfHeal(t *testing.T) {
	const id = "small-cap-model"
	upstream.ClearMaxTokensRejected(id)
	b, _ := testutil.NewTestBot(t, 1)
	var withCap, without atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(string(raw), `"max_tokens":32768`) {
			withCap.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":{"message":"max_tokens is too large: 32768. This model supports at most 16384 completion tokens"}}`))
			return
		}
		without.Add(1)
		w.Write([]byte(llmReply(true, 0.9, "scam", "message")))
	}))
	defer srv.Close()
	if _, err := b.Store.Write.Exec(`INSERT INTO upstreams
		(name,base_url,api_key,weight,status,supports_chat,supports_systemone)
		VALUES ('cap',?,'k',1,1,1,0)`, srv.URL); err != nil {
		t.Fatal(err)
	}
	if err := b.Cache.Reload(); err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"messages": []map[string]string{{"role": "user", "content": "ping"}}}
	for i := range 2 {
		if _, err := aiCall(b.Shared, upstream.EPChat, []string{"cap/" + id}, payload, nil); err != nil {
			t.Fatalf("第 %d 次：被拒 32k 后应去掉上限重发成功: %v", i+1, err)
		}
	}
	if withCap.Load() != 1 || without.Load() != 2 {
		t.Errorf("应 1 次带 32k（被拒）+ 2 次不带，得到 %d / %d", withCap.Load(), without.Load())
	}
}

// TestEinoStreamDefaultMaxTokens：规则发现的 OpenAI 渠道（流式转换 RT）
// 没写上限时补 32k；被拒过的模型不补。
func TestEinoStreamDefaultMaxTokens(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		json.NewDecoder(r.Body).Decode(&got)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer srv.Close()
	send := func(model string) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL,
			strings.NewReader(`{"model":"`+model+`","messages":[]}`))
		resp, err := einoStreamHTTPClient(srv.Client()).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}
	send("m")
	if got["max_tokens"] != float64(upstream.DefaultMaxTokens) {
		t.Errorf("没写上限时应补 %d，得到 %v", upstream.DefaultMaxTokens, got["max_tokens"])
	}
	upstream.MarkMaxTokensRejected("rejected-m")
	defer upstream.ClearMaxTokensRejected("rejected-m")
	send("rejected-m")
	if _, ok := got["max_tokens"]; ok {
		t.Errorf("被拒过的模型不该再补上限: %v", got)
	}
}

// TestEinoKindRTDefaultMaxTokens：翻译渠道（Responses）没写上限时补 32k。
func TestEinoKindRTDefaultMaxTokens(t *testing.T) {
	cap := &captureRT{resp: cannedResponse(200, "application/json",
		`{"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1}}`)}
	rt := buildKindRT(t, upstream.KindOpenAIResp, "https://gw.example/v1/responses", cap)
	roundTrip(t, rt, cap)
	var sent map[string]any
	if err := json.Unmarshal(cap.body, &sent); err != nil {
		t.Fatal(err)
	}
	if sent["max_output_tokens"] != float64(upstream.DefaultMaxTokens) {
		t.Errorf("Responses 出站请求应带 max_output_tokens=%d，得到 %v",
			upstream.DefaultMaxTokens, sent["max_output_tokens"])
	}
}

// TestRetryChatModelNotesRejectedMaxTokens：规则发现被 400 拒绝上限时记下
// 模型并立即重发一次（不退避），重发由传输层退回老行为。
func TestRetryChatModelNotesRejectedMaxTokens(t *testing.T) {
	sleeps := setupRetryTest(t)
	const modelID = "rt-small-cap"
	upstream.ClearMaxTokensRejected(modelID)
	defer upstream.ClearMaxTokensRejected(modelID)
	inner := &fakeRetryModel{errs: []error{
		&openai.APIError{HTTPStatusCode: http.StatusBadRequest,
			Message: "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]"},
	}}
	if _, err := withModelRetry(inner, modelID).Generate(context.Background(), nil); err != nil {
		t.Fatalf("被拒上限后应重发成功：%v", err)
	}
	if inner.callCount() != 2 || len(*sleeps) != 0 {
		t.Errorf("应 2 次请求 / 0 次等待，得到 %d / %d", inner.callCount(), len(*sleeps))
	}
	if upstream.DefaultMaxTokensFor(modelID, false) != 0 {
		t.Error("被拒的模型应被记下，后续请求不再带 32k")
	}
}

// TestGeminiRequestMaxTokens：Gemini 翻译要把上限放进 generationConfig，
// 否则 RT 补的默认上限会在翻译时被静默丢掉。
func TestGeminiRequestMaxTokens(t *testing.T) {
	in := sampleWireReq("gemini-2.5")
	in.MaxTokens = 123
	gen, _ := geminiRequest(in)["generationConfig"].(map[string]any)
	if gen["maxOutputTokens"] != 123 || gen["temperature"] != float32(0) {
		t.Errorf("generationConfig 应同时带 maxOutputTokens 与 temperature：%v", gen)
	}
}
