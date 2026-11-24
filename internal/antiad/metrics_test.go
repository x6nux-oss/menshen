package antiad

import (
	"strings"
	"testing"

	"menshen/internal/testutil"
)

// TestPipelineEmitsMetrics：跑一条真实判定（假上游），确认计数与耗时指标
// 随流水一起变化。指标是排障入口，插桩位置错了这里会先发现。
func TestPipelineEmitsMetrics(t *testing.T) {
	b, _ := testutil.NewTestBot(t, 1)
	testutil.EnableAntiad(t, b, -100)
	fakeAI(t, b, nil) // systemone 93% 广告 → 删 + 禁言 + 复判

	HandleGroupMessage(b, testutil.GroupMsg(-100, 42, 7, "加微信 日入5000"))
	waitIdle(t, b)

	var sb strings.Builder
	b.Metrics.WritePrometheus(&sb)
	out := sb.String()
	for _, want := range []string{
		`# TYPE menshen_judgements_total counter`,
		`menshen_judgements_total{bot="42",verdict="ad",action=`,
		`menshen_ai_requests_total{endpoint="systemone",model="so-model",upstream="fake",status="ok"} 1`,
		`menshen_ai_request_duration_seconds_count{endpoint="systemone",model="so-model",upstream="fake"} 1`,
		`menshen_ai_tokens_total{endpoint="systemone",model="so-model",kind="prompt"}`,
		`menshen_judgement_duration_seconds_count{bot="42"} 1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("指标输出缺少 %q", want)
		}
	}
}
