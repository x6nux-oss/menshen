package antiad

// 思考强度按模型设置（models.reasoning_effort）：填了才带 reasoning_effort，
// 不填不发；模型不接受时与 temperature 同款自愈 —— 记下、去掉、立即重发。

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"menshen/internal/core"
	"menshen/internal/testutil"
	"menshen/internal/upstream"
)

// effortServer 登记 OpenAI 形状的上游 up 与它名下的模型 up/id（思考强度
// 为 effort），返回 bot、最近一次请求体与被拒次数。reject 为真时，带
// reasoning_effort 的请求一律 400。
func effortServer(t *testing.T, up, id, effort string, reject bool) (*core.Bot, func() string, *atomic.Int32) {
	t.Helper()
	b, _ := testutil.NewTestBot(t, 1)
	var last atomic.Value
	last.Store("")
	var rejected atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		last.Store(string(raw))
		w.Header().Set("Content-Type", "application/json")
		if reject && strings.Contains(string(raw), `"reasoning_effort"`) {
			rejected.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":{"message":"Unsupported parameter: 'reasoning_effort' is not supported with this model."}}`))
			return
		}
		w.Write([]byte(llmReply(true, 0.9, "scam", "message")))
	}))
	t.Cleanup(srv.Close)
	if _, err := b.Store.Write.Exec(`INSERT INTO upstreams
		(name,base_url,api_key,weight,status,supports_chat,supports_systemone)
		VALUES (?,?,'k',1,1,1,0)`, up, srv.URL); err != nil {
		t.Fatalf("登记上游失败: %v", err)
	}
	if _, err := b.Store.Write.Exec(`INSERT INTO models
		(name,prompt_price,completion_price,reasoning_effort) VALUES (?,0,0,?)`,
		up+"/"+id, effort); err != nil {
		t.Fatalf("登记模型失败: %v", err)
	}
	if err := b.Cache.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	return b, func() string { return last.Load().(string) }, &rejected
}

func effortCall(t *testing.T, b *core.Bot, model string) {
	t.Helper()
	payload := map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "ping"}},
	}
	if _, err := aiCall(b.Shared, upstream.EPChat, []string{model}, payload, nil); err != nil {
		t.Fatalf("aiCall %s: %v", model, err)
	}
}

// TestChatReasoningEffortPerModel：模型填了思考强度就带上，没填不发。
func TestChatReasoningEffortPerModel(t *testing.T) {
	b, last, _ := effortServer(t, "eff", "m", "low", false)
	effortCall(t, b, "eff/m")
	if !strings.Contains(last(), `"reasoning_effort":"low"`) {
		t.Errorf("填了 low 的模型应带 reasoning_effort=low: %s", last())
	}

	b2, last2, _ := effortServer(t, "plain", "m", "", false)
	effortCall(t, b2, "plain/m")
	if strings.Contains(last2(), "reasoning_effort") {
		t.Errorf("没填思考强度的模型不该带该参数: %s", last2())
	}
}

// TestChatDropsRejectedEffort：第一次被 400 拒绝，去掉重发成功；之后同一
// 模型直接不带（已记住），不再浪费一次 400。
func TestChatDropsRejectedEffort(t *testing.T) {
	upstream.ClearEffortUnsupported("no-effort-model")
	b, last, rejected := effortServer(t, "noeff", "no-effort-model", "high", true)
	for i := range 2 {
		effortCall(t, b, "noeff/no-effort-model")
		if strings.Contains(last(), "reasoning_effort") {
			t.Errorf("第 %d 次：成功的那次不该带思考强度: %s", i+1, last())
		}
	}
	if rejected.Load() != 1 {
		t.Errorf("只该被拒 1 次（之后已记住），得到 %d", rejected.Load())
	}
}
