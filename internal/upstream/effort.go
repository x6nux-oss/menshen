package upstream

// 本文件处理思考强度（reasoning_effort）的渠道差异与「模型不接受」的自愈。
//
// 载荷里统一写 OpenAI chat 的 reasoning_effort（low / medium / high），
// BuildBody 按渠道翻成各家的字段：OpenAI 原样、Responses 是
// reasoning.effort、Anthropic 是 output_config.effort。Gemini 与
// Cloudflare 原生渠道只拷已知字段，自然不带。
//
// 不是每个模型都认它：非推理模型、Claude Haiku 4.5 / Sonnet 4.5 会 400。
// 处置与 temperature 相同（见 temperature.go）：见过一次就记下（进程级，
// 重启清空），之后该模型不再带。思考强度只影响思考多少，去掉不会让
// 请求失败。

import (
	"strings"
	"sync"
)

// Efforts 是模型设置里能填的思考强度：三家取值的并集（OpenAI 有
// none / minimal，Anthropic 有 xhigh / max）。原样发给上游，填了模型不认的
// 档位会被 400 拒绝，再按下面的自愈去掉。
var Efforts = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}

// effortUnsupported 是已被上游明确拒绝过思考强度的模型 ID 集合（不带上游前缀）。
var effortUnsupported sync.Map

// EffortUnsupported 报告该模型 ID 是否已被上游拒绝过思考强度。
func EffortUnsupported(modelID string) bool {
	_, ok := effortUnsupported.Load(modelID)
	return modelID != "" && ok
}

// MarkEffortUnsupported 记下一个不接受思考强度的模型 ID。
func MarkEffortUnsupported(modelID string) {
	if modelID != "" {
		effortUnsupported.Store(modelID, struct{}{})
	}
}

// ClearEffortUnsupported 清掉标记（测试与网关恢复支持后重新探测用）。
func ClearEffortUnsupported(modelID string) {
	effortUnsupported.Delete(modelID)
}

// EffortRejected 判断一次上游错误是否为「模型不接受思考强度」：4xx 且
// 消息提到 effort（三家的字段名都含它）或 output_config（严格校验的网关
// 只报不认识的顶层字段名）。与 TemperatureRejected 一样宁可放宽：误判的
// 后果只是这个模型此后按它自己的默认强度思考。
func EffortRejected(status int, msg string) bool {
	if status >= 500 || msg == "" {
		return false
	}
	m := strings.ToLower(msg)
	return strings.Contains(m, "effort") || strings.Contains(m, "output_config")
}
