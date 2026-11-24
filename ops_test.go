package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"menshen/internal/core"
	"menshen/internal/testutil"
)

func opsRequest(reg *core.Registry, path, remote, auth string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.RemoteAddr = remote
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	reg.ServeHTTP(w, req)
	return w
}

// TestMetricsAccessControl 确认默认匿名抓不到，回环与带对令牌的请求能抓。
func TestMetricsAccessControl(t *testing.T) {
	reg, b := testutil.NewTestRegistry(t, dispatch)
	b.Cfg.MetricsToken = "s3cret-metrics"

	if w := opsRequest(reg, "/metrics", "203.0.113.9:5000", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("外网匿名 = %d，期望 401", w.Code)
	}
	if w := opsRequest(reg, "/metrics", "203.0.113.9:5000", "Bearer wrong"); w.Code != http.StatusUnauthorized {
		t.Errorf("错误令牌 = %d，期望 401", w.Code)
	}
	if w := opsRequest(reg, "/metrics", "203.0.113.9:5000",
		"Bearer s3cret-metrics"); w.Code != http.StatusOK {
		t.Errorf("正确令牌 = %d，期望 200", w.Code)
	}
	if w := opsRequest(reg, "/metrics", "127.0.0.1:5000", ""); w.Code != http.StatusOK {
		t.Errorf("回环匿名 = %d，期望 200", w.Code)
	}
	// 经过反代的请求，对端是回环也不能算本机。
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.RemoteAddr = "127.0.0.1:5000"
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	w := httptest.NewRecorder()
	reg.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("带转发头的回环请求 = %d，期望 401", w.Code)
	}
}

// TestMetricsOutput 确认文本格式含 HELP/TYPE、关键业务指标，且不泄露 token。
func TestMetricsOutput(t *testing.T) {
	reg, _ := testutil.NewTestRegistry(t, dispatch)
	w := opsRequest(reg, "/metrics", "127.0.0.1:5000", "")
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Errorf("Content-Type = %q", ct)
	}
	body := w.Body.String()
	for _, want := range []string{
		"# HELP menshen_build_info",
		"# TYPE menshen_build_info gauge",
		"# TYPE menshen_ai_requests_total counter",
		"# TYPE menshen_judgements_total counter",
		"# TYPE menshen_judgement_duration_seconds histogram",
		"# TYPE menshen_webhook_updates_total counter",
		"menshen_queue_depth{bot=\"42\",queue=\"updates\"}",
		"menshen_ad_busy{bot=\"42\"}",
		"menshen_bots_running 1",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("指标输出缺少 %q", want)
		}
	}
	if strings.Contains(body, testutil.TestToken) {
		t.Error("指标输出不得包含 bot token")
	}
}

// TestHealthzReadiness 确认就绪检查会因 DB 不可读或没有运行实例而 503。
func TestHealthzReadiness(t *testing.T) {
	t.Run("正常运行", func(t *testing.T) {
		reg, _ := testutil.NewTestRegistry(t, dispatch)
		w := opsRequest(reg, "/healthz", "127.0.0.1:5000", "")
		if w.Code != http.StatusOK || w.Body.String() != "ok" {
			t.Errorf("healthz = %d %q", w.Code, w.Body.String())
		}
	})

	t.Run("数据库不可读", func(t *testing.T) {
		reg, b := testutil.NewTestRegistry(t, dispatch)
		b.Store.Read.Close()
		w := opsRequest(reg, "/healthz", "127.0.0.1:5000", "")
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("状态码 = %d，期望 503", w.Code)
		}
		if !strings.Contains(w.Body.String(), "database unreadable") {
			t.Errorf("退化为 %q，期望说明 DB 不可读", w.Body.String())
		}
	})

	t.Run("没有运行实例", func(t *testing.T) {
		_, _, sh := testutil.NewTestBotDispatch(t, 777, 777, dispatch)
		sh.Cfg.PublicURL = "https://test.invalid"
		reg := core.NewRegistry(sh, make(chan struct{}), dispatch)
		w := opsRequest(reg, "/healthz", "127.0.0.1:5000", "")
		if w.Code != http.StatusServiceUnavailable ||
			!strings.Contains(w.Body.String(), "no running bots") {
			t.Errorf("healthz = %d %q", w.Code, w.Body.String())
		}
	})
}

// TestPprofGatedByConfig 确认 pprof 默认关闭，开启后仍受回环/Bearer 约束。
func TestPprofGatedByConfig(t *testing.T) {
	t.Run("默认关闭", func(t *testing.T) {
		reg, _ := testutil.NewTestRegistry(t, dispatch)
		if w := opsRequest(reg, "/debug/pprof/", "127.0.0.1:5000", ""); w.Code != http.StatusNotFound {
			t.Errorf("默认配置下 pprof = %d，期望 404", w.Code)
		}
	})

	t.Run("开启后仍鉴权", func(t *testing.T) {
		_, _, sh := testutil.NewTestBotDispatch(t, 777, 777, dispatch)
		sh.Cfg.PublicURL = "https://test.invalid"
		sh.Cfg.PprofEnabled = true
		stop := make(chan struct{})
		t.Cleanup(func() { close(stop) })
		reg := core.NewRegistry(sh, stop, dispatch)
		reg.LoadAll()

		if w := opsRequest(reg, "/debug/pprof/", "203.0.113.9:5000", ""); w.Code != http.StatusUnauthorized {
			t.Errorf("外网匿名 pprof = %d，期望 401", w.Code)
		}
		w := opsRequest(reg, "/debug/pprof/", "127.0.0.1:5000", "")
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "profiles") {
			t.Errorf("回环 pprof = %d %q", w.Code, w.Body.String())
		}
	})
}

// TestWebhookServerRateLimitMetrics 走 startWebhook 组出来的真实 handler：
// 浏览器端点上的 429 必须计入 rate_limited_total，文档承诺的指标不能只在
// 运维端口生效。
func TestWebhookServerRateLimitMetrics(t *testing.T) {
	reg, b := testutil.NewTestRegistry(t, dispatch)
	sh := b.Shared
	sh.Cfg.ListenAddr = "127.0.0.1:0"
	srv := startWebhook(sh.Cfg, reg, sh)
	defer srv.Close()

	req := httptest.NewRequest(http.MethodPost, "/admin/api/state", nil)
	req.RemoteAddr = "198.51.100.20:4242"
	for i := range adminAPIPerMinute {
		w := httptest.NewRecorder()
		srv.Handler.ServeHTTP(w, req)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("第 %d 次就 429，期望前 %d 次放行", i+1, adminAPIPerMinute)
		}
	}
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("第 %d 次应 429，得到 %d", adminAPIPerMinute+1, w.Code)
	}

	body := opsRequest(reg, "/metrics", "127.0.0.1:5000", "").Body.String()
	for _, want := range []string{
		`menshen_http_requests_total{route="admin",method="POST",status="429"} 1`,
		`menshen_rate_limited_total{route="admin"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("指标输出缺少 %q", want)
		}
	}
}

// TestHTTPMiddlewareMetrics 走真实网络，确认路由/状态/耗时由中间件记录，
// 429 同时计入 rate_limited_total。
func TestHTTPMiddlewareMetrics(t *testing.T) {
	_, _, sh := testutil.NewTestBotDispatch(t, 777, 777, dispatch)
	sh.Cfg.PublicURL = "https://test.invalid"

	h := sh.Metrics.HTTPMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/limited" {
			http.Error(w, "too many", http.StatusTooManyRequests)
			return
		}
		w.Write([]byte("ok"))
	}))
	srv := httptest.NewServer(h)
	defer srv.Close()

	for _, p := range []string{"/", "/limited"} {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatalf("GET %s: %v", p, err)
		}
		resp.Body.Close()
	}

	reg := core.NewRegistry(sh, make(chan struct{}), dispatch)
	w := opsRequest(reg, "/metrics", "127.0.0.1:5000", "")
	body := w.Body.String()
	for _, want := range []string{
		`menshen_http_requests_total{route="other",method="GET",status="200"} 1`,
		`menshen_http_requests_total{route="other",method="GET",status="429"} 1`,
		`menshen_rate_limited_total{route="other"} 1`,
		`menshen_http_request_duration_seconds_count{route="other",method="GET"} 2`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("指标输出缺少 %q", want)
		}
	}
}
