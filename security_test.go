package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"menshen/internal/testutil"
)

// TestSecurityHeaders：所有响应带 nosniff / Referrer-Policy；HTTPS 部署带
// HSTS；Mini App 允许 Telegram Web 的 iframe，其余页面不允许被嵌套。
func TestSecurityHeaders(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	for _, tc := range []struct {
		path string
		xfo  string
	}{
		{"/admin", "DENY"},
		{"/_w/ap/1/x", "DENY"},
		{"/miniapp", ""}, // Telegram Web 用 iframe 承载 Mini App
	} {
		w := httptest.NewRecorder()
		securityHeaders(ok, true).ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q", tc.path, got)
		}
		if got := w.Header().Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: Referrer-Policy = %q", tc.path, got)
		}
		if got := w.Header().Get("Strict-Transport-Security"); got != "max-age=31536000" {
			t.Errorf("%s: HSTS = %q", tc.path, got)
		}
		if got := w.Header().Get("X-Frame-Options"); got != tc.xfo {
			t.Errorf("%s: X-Frame-Options = %q，期望 %q", tc.path, got, tc.xfo)
		}
	}

	w := httptest.NewRecorder()
	securityHeaders(ok, false).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin", nil))
	if got := w.Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("非 HTTPS 部署不该发 HSTS，得到 %q", got)
	}
}

// TestBrowserEndpointRateLimits：公开端点按 IP 限流，超限 429 + Retry-After；
// 换一个 IP 不受影响。
func TestBrowserEndpointRateLimits(t *testing.T) {
	reg, b := testutil.NewTestRegistry(t, nil)
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	router := webRouter{reg: reg, sh: b.Shared, web: ok, mini: ok, admin: ok, cap: ok}

	const ip = "203.0.113.7:4242"
	for i, tc := range []struct {
		path  string
		limit int
	}{
		{"/_w/ap/1/x", webIPPerMinute},
		{"/admin/login/1/2/3/x", adminLoginPerMinute},
		{"/admin/api/state", adminAPIPerMinute},
		// 点段归一化后仍是同一端点，限流必须按归一化路径选组。
		{"/admin/./api/state", adminAPIPerMinute},
		{"/admin/../admin/api/state", adminAPIPerMinute},
		{"/miniapp/api/state", miniAPIPerMinute},
		{"/miniapp/./api/state", miniAPIPerMinute},
		{"/cap/x/challenge", capIPPerMinute},
	} {
		// 每个用例独立 IP：同组共享窗口，复用 IP 会把上一个用例的额度耗光。
		caseIP := fmt.Sprintf("198.51.100.%d:4242", i+1)
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		req.RemoteAddr = caseIP
		for i := range tc.limit {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code == http.StatusTooManyRequests {
				t.Fatalf("%s 第 %d 次就 429，期望前 %d 次放行", tc.path, i+1, tc.limit)
			}
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusTooManyRequests {
			t.Errorf("%s 超过 %d 次应 429，得到 %d", tc.path, tc.limit, w.Code)
		}
		if got := w.Header().Get("Retry-After"); got != "60" {
			t.Errorf("%s 429 应带 Retry-After: 60，得到 %q", tc.path, got)
		}

		other := httptest.NewRequest(http.MethodGet, tc.path, nil)
		other.RemoteAddr = "203.0.113.8:4242"
		w = httptest.NewRecorder()
		router.ServeHTTP(w, other)
		if w.Code == http.StatusTooManyRequests {
			t.Errorf("%s 另一个 IP 不该被前一个 IP 的窗口拖累", tc.path)
		}
	}

	// /healthz 不限：监控探针不能被限流器判成实例不健康。
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.RemoteAddr = ip
	for i := range webIPPerMinute + 1 {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("/healthz 第 %d 次被限流", i+1)
		}
	}
}
