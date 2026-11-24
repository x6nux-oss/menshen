package metrics

import (
	"strings"
	"testing"
)

func TestPrometheusExposition(t *testing.T) {
	r := NewRegistry()
	c := r.Counter("menshen_test_total", "help line\nsecond", "bot", "result")
	c.With("1", "ok").Inc()
	c.With("1", "ok").Add(2)
	c.With("1", `bad"value`).Inc() // 引号必须转义，否则输出不合法
	h := r.Histogram("menshen_test_seconds", "latency", []float64{0.1, 1}, "kind")
	h.With("x").Observe(0.05)
	h.With("x").Observe(0.5)
	h.With("x").Observe(2)
	r.FuncGauge("menshen_test_gauge", "gauge", nil,
		func(yield func([]string, int64)) { yield(nil, 7) })

	var b strings.Builder
	r.WritePrometheus(&b)
	out := b.String()

	for _, want := range []string{
		"# HELP menshen_test_total help line second",
		"# TYPE menshen_test_total counter",
		`menshen_test_total{bot="1",result="ok"} 3`,
		`menshen_test_total{bot="1",result="bad\"value"} 1`,
		"# TYPE menshen_test_seconds histogram",
		`menshen_test_seconds_bucket{kind="x",le="0.1"} 1`,
		`menshen_test_seconds_bucket{kind="x",le="1"} 2`,
		`menshen_test_seconds_bucket{kind="x",le="+Inf"} 3`,
		`menshen_test_seconds_sum{kind="x"} 2.55`,
		`menshen_test_seconds_count{kind="x"} 3`,
		"# TYPE menshen_test_gauge gauge",
		"menshen_test_gauge 7",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("输出缺少 %q:\n%s", want, out)
		}
	}
}

func TestFuncGaugeMayYieldNothing(t *testing.T) {
	r := NewRegistry()
	r.FuncGauge("menshen_absent", "absent until a file exists", nil,
		func(func([]string, int64)) {})
	var b strings.Builder
	r.WritePrometheus(&b)
	out := b.String()
	if !strings.Contains(out, "# TYPE menshen_absent gauge") {
		t.Errorf("HELP/TYPE 仍应输出: %s", out)
	}
	if strings.Contains(out, "menshen_absent{") || strings.Contains(out, "\nmenshen_absent ") {
		t.Errorf("没有样本时不应输出序列: %s", out)
	}
}
