package core

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"menshen/internal/metrics"
	"menshen/internal/store"
)

// Metrics 是本进程的指标集合。所有指标族在构造时一次声明，标签值只允许
// bot 内部 ID、路由、模型、状态这类低基数取值；聊天 ID、用户 ID、token
// 与正文一律不进标签。
type Metrics struct {
	reg *metrics.Registry

	HTTPRequests        *metrics.CounterVec
	HTTPDuration        *metrics.HistogramVec
	RateLimited         *metrics.CounterVec
	WebhookUpdates      *metrics.CounterVec
	Judgements          *metrics.CounterVec
	JudgementDuration   *metrics.HistogramVec
	AIRequests          *metrics.CounterVec
	AIDuration          *metrics.HistogramVec
	AITokens            *metrics.CounterVec
	AICost              *metrics.CounterVec
	AIRetries           *metrics.CounterVec
	Alerts              *metrics.CounterVec
	Panics              *metrics.CounterVec
	LocalVisionRequests *metrics.CounterVec
	LocalVisionDuration *metrics.HistogramVec

	archiveMu   sync.Mutex
	archiveSize int64
	archiveAt   time.Time
}

// 秒级延迟桶覆盖本地识图（几十毫秒）到上游超时（几十秒）。
var latencyBuckets = []float64{
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
}

const (
	metricPrefix = "menshen_"
	// capacityScanTTL 是归档目录体积的缓存时长：抓取可能很频繁，而目录
	// 遍历在图片多时并不便宜。容量告警不需要秒级精度。
	capacityScanTTL = 30 * time.Second
)

func newMetrics(sh *Shared) *Metrics {
	m := &Metrics{reg: metrics.NewRegistry()}

	m.HTTPRequests = m.reg.Counter(metricPrefix+"http_requests_total",
		"HTTP requests by route, method and status.", "route", "method", "status")
	m.HTTPDuration = m.reg.Histogram(metricPrefix+"http_request_duration_seconds",
		"HTTP request latency by route and method.", latencyBuckets, "route", "method")
	m.RateLimited = m.reg.Counter(metricPrefix+"rate_limited_total",
		"HTTP 429 responses by route.", "route")
	m.WebhookUpdates = m.reg.Counter(metricPrefix+"webhook_updates_total",
		"Webhook updates by bot and result.", "bot", "result")
	m.Judgements = m.reg.Counter(metricPrefix+"judgements_total",
		"Judgements by bot, verdict and action.", "bot", "verdict", "action")
	m.JudgementDuration = m.reg.Histogram(metricPrefix+"judgement_duration_seconds",
		"Full judgement chain latency by bot.", latencyBuckets, "bot")
	m.AIRequests = m.reg.Counter(metricPrefix+"ai_requests_total",
		"Upstream AI attempts by endpoint, model, upstream and status.",
		"endpoint", "model", "upstream", "status")
	m.AIDuration = m.reg.Histogram(metricPrefix+"ai_request_duration_seconds",
		"Upstream AI attempt latency by endpoint, model and upstream.",
		latencyBuckets, "endpoint", "model", "upstream")
	m.AITokens = m.reg.Counter(metricPrefix+"ai_tokens_total",
		"AI tokens by endpoint, model and kind.", "endpoint", "model", "kind")
	m.AICost = m.reg.Counter(metricPrefix+"ai_cost_quota_total",
		"AI cost in quota units by endpoint and model.", "endpoint", "model")
	m.AIRetries = m.reg.Counter(metricPrefix+"ai_retries_total",
		"AI retries by endpoint and model.", "endpoint", "model")
	m.Alerts = m.reg.Counter(metricPrefix+"alerts_total",
		"Alerts sent by kind.", "kind")
	m.Panics = m.reg.Counter(metricPrefix+"panics_total",
		"Recovered panics by component.", "component")
	m.LocalVisionRequests = m.reg.Counter(metricPrefix+"localvision_requests_total",
		"Local vision inference requests by group and result.", "group", "result")
	m.LocalVisionDuration = m.reg.Histogram(metricPrefix+"localvision_duration_seconds",
		"Local vision inference latency by group.", latencyBuckets, "group")

	m.reg.FuncGauge(metricPrefix+"build_info",
		"Build version, always 1.", []string{"version"},
		func(yield func([]string, int64)) { yield([]string{sh.Version}, 1) })
	m.reg.FuncGauge(metricPrefix+"start_time_seconds",
		"Process start time as unix seconds.", nil,
		func(yield func([]string, int64)) { yield(nil, sh.StartedAt.Unix()) })
	m.reg.FuncGauge(metricPrefix+"goroutines",
		"Number of goroutines.", nil,
		func(yield func([]string, int64)) { yield(nil, int64(runtime.NumGoroutine())) })
	m.reg.FuncGauge(metricPrefix+"memory_bytes",
		"Process memory by kind.", []string{"kind"},
		func(yield func([]string, int64)) {
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			yield([]string{"alloc"}, int64(ms.Alloc))
			yield([]string{"sys"}, int64(ms.Sys))
			yield([]string{"heap_alloc"}, int64(ms.HeapAlloc))
			yield([]string{"heap_sys"}, int64(ms.HeapSys))
			yield([]string{"heap_inuse"}, int64(ms.HeapInuse))
			yield([]string{"stack_inuse"}, int64(ms.StackInuse))
		})
	m.reg.FuncGauge(metricPrefix+"bots_running",
		"Running bot instances.", nil,
		func(yield func([]string, int64)) {
			if sh.Reg != nil {
				yield(nil, int64(sh.Reg.Size()))
			}
		})
	m.reg.FuncGauge(metricPrefix+"queue_depth",
		"Queued jobs by bot and queue.", []string{"bot", "queue"},
		func(yield func([]string, int64)) {
			if sh.Reg == nil {
				return
			}
			sh.Reg.Each(func(b *Bot) {
				id := botLabel(b)
				yield([]string{id, "updates"}, int64(len(b.updates)))
				yield([]string{id, "ad"}, int64(len(b.adJobs)))
				yield([]string{id, "review"}, int64(len(b.adReviews)))
			})
		})
	m.reg.FuncGauge(metricPrefix+"ad_busy",
		"Queued and running judgement jobs by bot.", []string{"bot"},
		func(yield func([]string, int64)) {
			if sh.Reg == nil {
				return
			}
			sh.Reg.Each(func(b *Bot) { yield([]string{botLabel(b)}, b.adBusy.Load()) })
		})
	m.reg.FuncGauge(metricPrefix+"ai_fail_streak",
		"Consecutive upstream AI failures.", nil,
		func(yield func([]string, int64)) { yield(nil, sh.AIFailStreak.Load()) })
	m.reg.FuncGauge(metricPrefix+"hedge_active",
		"Active hedge entries by endpoint and model list.", []string{"endpoint", "models"},
		func(yield func([]string, int64)) {
			now := time.Now()
			sh.AIHedge.Range(func(key, value any) bool {
				until, ok := value.(time.Time)
				if !ok || !until.After(now) {
					return true
				}
				endpoint, models, _ := strings.Cut(key.(string), ":")
				yield([]string{endpoint, models}, 1)
				return true
			})
		})
	m.reg.FuncGauge(metricPrefix+"review_gate_used",
		"Review (LLM) concurrency gate slots in use.", nil,
		func(yield func([]string, int64)) { yield(nil, int64(len(sh.reviewSem))) })
	m.reg.FuncGauge(metricPrefix+"localvision_queue_depth",
		"Local vision slots in use.", nil,
		func(yield func([]string, int64)) {
			if sh.LocalModels != nil {
				yield(nil, int64(sh.LocalModels.Busy()))
			}
		})
	m.reg.FuncGauge(metricPrefix+"last_update_timestamp_seconds",
		"Unix time of the last accepted webhook update.", nil,
		func(yield func([]string, int64)) {
			if v := sh.LastUpdateAt.Load(); v > 0 {
				yield(nil, v)
			}
		})
	m.reg.FuncGauge(metricPrefix+"last_poll_timestamp_seconds",
		"Unix time of the last successful getUpdates call.", nil,
		func(yield func([]string, int64)) {
			if v := sh.LastPollAt.Load(); v > 0 {
				yield(nil, v)
			}
		})

	m.reg.FuncGauge(metricPrefix+"db_size_bytes",
		"SQLite database file size.", nil,
		func(yield func([]string, int64)) {
			if st, err := os.Stat(sh.Cfg.DBPath); err == nil {
				yield(nil, st.Size())
			}
		})
	m.reg.FuncGauge(metricPrefix+"db_wal_size_bytes",
		"SQLite WAL file size.", nil,
		func(yield func([]string, int64)) {
			if st, err := os.Stat(sh.Cfg.DBPath + "-wal"); err == nil {
				yield(nil, st.Size())
			}
		})
	m.reg.FuncGauge(metricPrefix+"db_free_bytes",
		"Free pages retained inside the SQLite file.", nil,
		func(yield func([]string, int64)) {
			if n, ok := sh.freeBytes(); ok {
				yield(nil, n)
			}
		})
	m.reg.FuncGauge(metricPrefix+"archive_size_bytes",
		"Message archive directory size.", nil,
		func(yield func([]string, int64)) { yield(nil, m.archiveBytes(sh)) })
	m.reg.FuncGauge(metricPrefix+"backup_last_success_timestamp_seconds",
		"Unix time of the newest backup file; absent when no backup exists.",
		nil,
		func(yield func([]string, int64)) {
			if ts := sh.backupTimestamp(); ts > 0 {
				yield(nil, ts)
			}
		})
	m.reg.FuncGauge(metricPrefix+"appeals_open",
		"Open appeals.", nil,
		func(yield func([]string, int64)) {
			if n, ok := sh.countRows(`SELECT COUNT(*) FROM appeals WHERE status IN (` +
				store.AppealOpenStatusesSQL + `)`); ok {
				yield(nil, n)
			}
		})
	m.reg.FuncGauge(metricPrefix+"join_verify_pending",
		"Pending join verifications.", nil,
		func(yield func([]string, int64)) {
			if n, ok := sh.countRows(`SELECT COUNT(*) FROM join_verify WHERE status='pending'`); ok {
				yield(nil, n)
			}
		})
	return m
}

// WritePrometheus 渲染全部指标，供 /metrics 与测试使用。
func (m *Metrics) WritePrometheus(w io.Writer) { m.reg.WritePrometheus(w) }

// botLabel 是 bot 的内部 ID。SelfID 在注册时回填，这里绝不触发 getMe：
// 抓取与判定路径都不该为渲染一个标签发出网请求。
func botLabel(b *Bot) string {
	if b == nil {
		return "0"
	}
	return strconv.FormatInt(b.SelfID.Load(), 10)
}

// MetricsLabel 是 bot 的指标标签值（内部 ID），不触发 getMe。
func (b *Bot) MetricsLabel() string { return botLabel(b) }

func (sh *Shared) countRows(query string) (int64, bool) {
	if sh.Store == nil || sh.Store.Read == nil {
		return 0, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var n int64
	if err := sh.Store.Read.QueryRowContext(ctx, query).Scan(&n); err != nil {
		return 0, false
	}
	return n, true
}

func (sh *Shared) freeBytes() (int64, bool) {
	pages, ok := sh.pragmaInt("freelist_count")
	if !ok {
		return 0, false
	}
	pageSize, ok := sh.pragmaInt("page_size")
	if !ok {
		return 0, false
	}
	return pages * pageSize, true
}

func (sh *Shared) pragmaInt(name string) (int64, bool) {
	if sh.Store == nil || sh.Store.Read == nil {
		return 0, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var n int64
	if err := sh.Store.Read.QueryRowContext(ctx, "PRAGMA "+name).Scan(&n); err != nil {
		return 0, false
	}
	return n, true
}

// archiveBytes 统计存档目录体积，结果缓存 capacityScanTTL。
func (m *Metrics) archiveBytes(sh *Shared) int64 {
	m.archiveMu.Lock()
	defer m.archiveMu.Unlock()
	if time.Since(m.archiveAt) < capacityScanTTL {
		return m.archiveSize
	}
	root := strings.TrimSpace(sh.Cfg.ArchiveDir)
	if root == "" {
		dir := filepath.Dir(sh.Cfg.DBPath)
		if dir == "" {
			dir = "."
		}
		root = filepath.Join(dir, "archive")
	}
	var total int64
	_ = filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil && info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	m.archiveSize, m.archiveAt = total, time.Now()
	return total
}

// backupTimestamp 取备份目录里最新文件的修改时间。
//
// 备份由 M1（CODE-40）落在数据库同目录的 backups/ 下；在那之前目录不存在，
// 这个 gauge 就不产出样本 —— 采集侧用 absent() 告警，而不是把「从未备份」
// 伪装成 epoch 0。
func (sh *Shared) backupTimestamp() int64 {
	dir := filepath.Join(filepath.Dir(sh.Cfg.DBPath), "backups")
	var newest int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil && info.Mode().IsRegular() {
			if ts := info.ModTime().Unix(); ts > newest {
				newest = ts
			}
		}
		return nil
	})
	return newest
}

// HTTPMiddleware 记录按路由聚合的请求数与耗时。标签里只有分类后的路由名，
// 不含原始路径（原始路径可能带 token 或申诉签名）。
func (m *Metrics) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		route := routeOf(r.URL.Path)
		m.HTTPRequests.With(route, r.Method, strconv.Itoa(sw.status)).Inc()
		m.HTTPDuration.With(route, r.Method).Observe(time.Since(start).Seconds())
		if sw.status == http.StatusTooManyRequests {
			m.RateLimited.With(route).Inc()
		}
	})
}

type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusWriter) WriteHeader(code int) {
	if w.wroteHeader {
		return
	}
	w.status = code
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	w.wroteHeader = true
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// routeOf 把请求路径压成低基数路由名。webhook 路径里的 token 与网页路径
// 里的签名都不能进标签。
func routeOf(p string) string {
	switch {
	case p == "/healthz":
		return "healthz"
	case p == "/metrics":
		return "metrics"
	case strings.HasPrefix(p, "/debug/pprof/"):
		return "pprof"
	case strings.HasPrefix(p, "/admin"):
		return "admin"
	case strings.HasPrefix(p, "/miniapp"):
		return "miniapp"
	case strings.HasPrefix(p, "/cap/"):
		return "cap"
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "_w" {
			return "web"
		}
	}
	if TokenFromPath(p) != "" {
		return "webhook"
	}
	return "other"
}

// recoverPanic 隔离后台 goroutine 的 panic：一个畸形更新或空响应不该让
// 整个进程退出。计数按组件区分，便于告警定位。
func (sh *Shared) recoverPanic(component string) {
	v := recover()
	if v == nil {
		return
	}
	if sh != nil && sh.Metrics != nil {
		sh.Metrics.Panics.With(component).Inc()
	}
	slog.Error("后台任务 panic，已隔离", "component", component,
		"panic", v, "stack", string(debug.Stack()))
}
