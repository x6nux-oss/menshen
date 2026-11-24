package core

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/http/pprof"
	"strings"
	"time"
)

// 就绪阈值。
//
// webhook 模式下没有轮询可看，只能看「最近一条被接收的更新」；门槛放得
// 很宽，避免安静的群在夜间把实例判成不健康。轮询模式每 25 秒必有一次
// getUpdates 返回（空的也算），所以门槛可以收紧到两分钟。
const (
	readinessDBTimeout = 2 * time.Second
	readinessPollAge   = 2 * time.Minute
	readinessUpdateAge = 24 * time.Hour
)

// newOpsMux 组装 /healthz、/metrics 与可选的 /debug/pprof。
//
// 与 webhook 在同一监听端口上，但鉴权各自独立：webhook 认路径里的 bot
// token，ops 端点只认回环或 Bearer；pprof 默认不注册。
func (r *Registry) newOpsMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", r.handleHealthz)
	mux.HandleFunc("/metrics", r.handleMetrics)
	if r.sh.Cfg.PprofEnabled {
		mux.HandleFunc("/debug/pprof/", r.opsAuth(pprof.Index))
		mux.HandleFunc("/debug/pprof/cmdline", r.opsAuth(pprof.Cmdline))
		mux.HandleFunc("/debug/pprof/profile", r.opsAuth(pprof.Profile))
		mux.HandleFunc("/debug/pprof/symbol", r.opsAuth(pprof.Symbol))
		mux.HandleFunc("/debug/pprof/trace", r.opsAuth(pprof.Trace))
	}
	return mux
}

// OpsHandler 是只含运维端点的处理器。长轮询模式没有 webhook 监听，
// 用它单独起一个回环 HTTP 服务提供 /metrics 与就绪检查。
func (r *Registry) OpsHandler() http.Handler { return r.ops }

// isOpsPath 报告路径是否归运维处理器。
func isOpsPath(p string) bool {
	return p == "/healthz" || p == "/metrics" ||
		p == "/debug/pprof" || strings.HasPrefix(p, "/debug/pprof/")
}

func (r *Registry) handleHealthz(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if reason := r.notReady(); reason != "" {
		http.Error(w, "not ready: "+reason, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte("ok"))
}

// notReady 返回不可就绪的第一个原因，空串表示就绪。
func (r *Registry) notReady() string {
	sh := r.sh
	if sh == nil || sh.Store == nil || sh.Store.Read == nil {
		return "database not configured"
	}
	ctx, cancel := context.WithTimeout(context.Background(), readinessDBTimeout)
	defer cancel()
	var n int
	if err := sh.Store.Read.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master`).Scan(&n); err != nil {
		return "database unreadable"
	}
	if r.Size() == 0 {
		return "no running bots"
	}
	maxAge := readinessUpdateAge
	last := sh.LastUpdateAt.Load()
	if !sh.Cfg.UseWebhook() {
		maxAge = readinessPollAge
		last = sh.LastPollAt.Load()
	}
	if last == 0 {
		if time.Since(sh.StartedAt) > maxAge {
			return "no input received"
		}
		return ""
	}
	if time.Since(time.Unix(last, 0)) > maxAge {
		return fmt.Sprintf("input silent for %s", time.Since(time.Unix(last, 0)).Round(time.Second))
	}
	return ""
}

func (r *Registry) handleMetrics(w http.ResponseWriter, req *http.Request) {
	r.opsAuth(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet && req.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.sh == nil || r.sh.Metrics == nil {
			http.Error(w, "metrics unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		r.sh.Metrics.WritePrometheus(w)
	})(w, req)
}

// opsAuth 只放行回环请求或持有 metrics_token 的 Bearer。
//
// 只绑回环还不够：部署在反代后面时，外部请求经反代进来，对端地址也是
// 回环。凡是带转发头的请求一律按外部处理，必须出示 token。
func (r *Registry) opsAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if r.opsAuthorized(req) {
			next(w, req)
			return
		}
		w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}
}

func (r *Registry) opsAuthorized(req *http.Request) bool {
	if loopbackRequest(req) {
		return true
	}
	token := ""
	if r.sh != nil && r.sh.Cfg != nil {
		token = r.sh.Cfg.MetricsToken
	}
	if token == "" {
		return false
	}
	auth := req.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	got := strings.TrimSpace(strings.TrimPrefix(auth, prefix))
	return subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1
}

// loopbackRequest 判断请求是否真的来自本机。带任何常见转发头的请求不算：
// 它至少经过了一层反代，对端地址落在回环不代表调用方在回环。
func loopbackRequest(req *http.Request) bool {
	for _, h := range []string{"X-Forwarded-For", "X-Real-IP", "CF-Connecting-IP", "Forwarded"} {
		if req.Header.Get(h) != "" {
			return false
		}
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		host = req.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}
