// Package metrics 是 Prometheus 文本格式的最小实现：只依赖标准库。
//
// 计数与直方图用原子量更新，标签序列在首次使用时懒建；抓取时一次性
// 排序输出，保证同一份状态每次渲染结果稳定。指标名与标签由各包在
// 构造时声明，这里不内置任何业务名。
package metrics

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// Registry 收集一组指标族并渲染为 Prometheus 文本格式。
type Registry struct {
	mu       sync.Mutex
	families []family
}

func NewRegistry() *Registry { return &Registry{} }

func (r *Registry) add(f family) {
	r.mu.Lock()
	r.families = append(r.families, f)
	r.mu.Unlock()
}

// Counter 声明一个带标签的计数器族。
func (r *Registry) Counter(name, help string, labels ...string) *CounterVec {
	v := &CounterVec{name: name, help: help, labels: labels,
		series: map[string]*counterSeries{}}
	r.add(v)
	return v
}

// Histogram 声明一个带标签的直方图族。buckets 必须是升序上界（秒）。
func (r *Registry) Histogram(name, help string, buckets []float64, labels ...string) *HistogramVec {
	v := &HistogramVec{name: name, help: help, labels: labels,
		buckets: append([]float64(nil), buckets...), series: map[string]*histogramSeries{}}
	r.add(v)
	return v
}

// FuncGauge 声明一个抓取时求值的 gauge 族。fn 通过 yield 产出样本；
// 不产出即该族本次没有样本（用于「文件不存在时不撒谎」那类指标）。
func (r *Registry) FuncGauge(name, help string, labels []string,
	fn func(yield func(values []string, v int64))) {
	r.add(&funcFamily{name: name, help: help, labels: labels, fn: fn})
}

// WritePrometheus 输出全部指标族。
func (r *Registry) WritePrometheus(w io.Writer) {
	r.mu.Lock()
	families := append([]family(nil), r.families...)
	r.mu.Unlock()
	for _, f := range families {
		f.write(w)
	}
}

type family interface {
	write(w io.Writer)
}

// ---- 计数器 ----

type counterSeries struct {
	values []string
	v      atomic.Uint64
}

type CounterVec struct {
	name, help string
	labels     []string
	mu         sync.RWMutex
	series     map[string]*counterSeries
}

// Counter 是某个标签组合的原子计数。
type Counter struct{ v *atomic.Uint64 }

func (c *Counter) Inc()          { c.v.Add(1) }
func (c *Counter) Add(n uint64)  { c.v.Add(n) }
func (c *Counter) Value() uint64 { return c.v.Load() }

func (v *CounterVec) With(values ...string) *Counter {
	if len(values) != len(v.labels) {
		panic(fmt.Sprintf("%s: 期望 %d 个标签，得到 %d", v.name, len(v.labels), len(values)))
	}
	key := seriesKey(values)
	v.mu.RLock()
	s := v.series[key]
	v.mu.RUnlock()
	if s != nil {
		return &Counter{v: &s.v}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if s = v.series[key]; s == nil {
		s = &counterSeries{values: append([]string(nil), values...)}
		v.series[key] = s
	}
	return &Counter{v: &s.v}
}

func (v *CounterVec) write(w io.Writer) {
	header(w, v.name, v.help, "counter")
	v.mu.RLock()
	list := make([]*counterSeries, 0, len(v.series))
	for _, s := range v.series {
		list = append(list, s)
	}
	v.mu.RUnlock()
	sort.Slice(list, func(i, j int) bool { return seriesKey(list[i].values) < seriesKey(list[j].values) })
	for _, s := range list {
		fmt.Fprintf(w, "%s%s %d\n", v.name, labelsText(v.labels, s.values), s.v.Load())
	}
}

// ---- 直方图 ----

type histogramSeries struct {
	values  []string
	buckets []float64
	mu      sync.Mutex
	counts  []uint64 // 每个桶的非累积计数，渲染时累加
	count   uint64
	sum     float64
}

type HistogramVec struct {
	name, help string
	labels     []string
	buckets    []float64
	mu         sync.RWMutex
	series     map[string]*histogramSeries
}

type Histogram struct{ v *histogramSeries }

func (h *Histogram) Observe(seconds float64) {
	if seconds < 0 {
		seconds = 0
	}
	h.v.mu.Lock()
	h.v.count++
	h.v.sum += seconds
	for i, bound := range h.v.buckets {
		if seconds <= bound {
			h.v.counts[i]++
			break
		}
	}
	h.v.mu.Unlock()
}

func (v *HistogramVec) With(values ...string) *Histogram {
	if len(values) != len(v.labels) {
		panic(fmt.Sprintf("%s: 期望 %d 个标签，得到 %d", v.name, len(v.labels), len(values)))
	}
	key := seriesKey(values)
	v.mu.RLock()
	s := v.series[key]
	v.mu.RUnlock()
	if s != nil {
		return &Histogram{v: s}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if s = v.series[key]; s == nil {
		s = &histogramSeries{values: append([]string(nil), values...),
			buckets: v.buckets, counts: make([]uint64, len(v.buckets))}
		v.series[key] = s
	}
	return &Histogram{v: s}
}

// Count 返回观测次数，供测试与自检。
func (v *HistogramVec) Count(values ...string) uint64 {
	v.mu.RLock()
	s := v.series[seriesKey(values)]
	v.mu.RUnlock()
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.count
}

func (v *HistogramVec) write(w io.Writer) {
	header(w, v.name, v.help, "histogram")
	v.mu.RLock()
	list := make([]*histogramSeries, 0, len(v.series))
	for _, s := range v.series {
		list = append(list, s)
	}
	v.mu.RUnlock()
	sort.Slice(list, func(i, j int) bool { return seriesKey(list[i].values) < seriesKey(list[j].values) })
	for _, s := range list {
		s.mu.Lock()
		var cumulative uint64
		names := append(append([]string(nil), v.labels...), "le")
		for i, bound := range v.buckets {
			cumulative += s.counts[i]
			values := append(append([]string(nil), s.values...), formatFloat(bound))
			fmt.Fprintf(w, "%s_bucket%s %d\n", v.name, labelsText(names, values), cumulative)
		}
		cumulative += s.count - cumulative
		fmt.Fprintf(w, "%s_bucket%s %d\n", v.name,
			labelsText(names, append(append([]string(nil), s.values...), "+Inf")), cumulative)
		fmt.Fprintf(w, "%s_sum%s %s\n", v.name, labelsText(v.labels, s.values), formatFloat(s.sum))
		fmt.Fprintf(w, "%s_count%s %d\n", v.name, labelsText(v.labels, s.values), s.count)
		s.mu.Unlock()
	}
}

// ---- 抓取时求值的 gauge ----

type funcFamily struct {
	name, help string
	labels     []string
	fn         func(yield func(values []string, v int64))
}

func (f *funcFamily) write(w io.Writer) {
	header(w, f.name, f.help, "gauge")
	var lines []string
	f.fn(func(values []string, v int64) {
		if len(values) != len(f.labels) {
			panic(fmt.Sprintf("%s: 期望 %d 个标签，得到 %d", f.name, len(f.labels), len(values)))
		}
		lines = append(lines, fmt.Sprintf("%s%s %d", f.name, labelsText(f.labels, values), v))
	})
	sort.Strings(lines)
	for _, line := range lines {
		fmt.Fprintln(w, line)
	}
}

// ---- 公共格式 ----

func header(w io.Writer, name, help, kind string) {
	fmt.Fprintf(w, "# HELP %s %s\n", name, strings.ReplaceAll(help, "\n", " "))
	fmt.Fprintf(w, "# TYPE %s %s\n", name, kind)
}

func seriesKey(values []string) string { return strings.Join(values, "\x00") }

func labelsText(names, values []string) string {
	if len(names) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteByte('{')
	for i, name := range names {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(name)
		b.WriteString(`="`)
		b.WriteString(escapeLabel(values[i]))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String()
}

func escapeLabel(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return strings.ReplaceAll(s, `"`, `\"`)
}

func formatFloat(f float64) string { return strconv.FormatFloat(f, 'g', -1, 64) }
