package upstream

// 本文件是 chat 请求的默认输出上限，以及「模型不接受这个上限」的降级。
//
// 调用方没写上限时，判定链路（BuildBody）与规则发现（两个传输层 RT）都补
// DefaultMaxTokens。思考也计入输出上限：给小了推理模型想不完就被截断、
// 正文为空，复判只剩一句「未返回 JSON」（线上 deepseek-flash 在 2048 时
// 就是这样）。
//
// 但很多模型的输出上限低于它（gpt-4o 16k、deepseek-chat 8k），会直接 400。
// 处置与 temperature 相同（见 temperature.go）：见过一次就记下（进程级，
// 重启清空），该模型退回加上限之前的行为 —— 不传上限；Anthropic 渠道
// max_tokens 必填，退回 fallbackMaxTokens。

import (
	"strings"
	"sync"
)

// DefaultMaxTokens 是 chat 请求没写上限时补的输出上限。
const DefaultMaxTokens = 32768

// fallbackMaxTokens 是被拒过 32k 的模型在 Anthropic 渠道（必填）上的上限：
// 加 32k 之前规则发现用的值，Claude 3.5 Haiku 这类老模型的上限。
const fallbackMaxTokens = 8192

// maxTokensRejected 是已被上游拒绝过默认上限的模型 ID 集合（不带上游前缀）。
var maxTokensRejected sync.Map

// MarkMaxTokensRejected 记下一个不接受默认上限的模型 ID。
func MarkMaxTokensRejected(modelID string) {
	if modelID != "" {
		maxTokensRejected.Store(modelID, struct{}{})
	}
}

// ClearMaxTokensRejected 清掉标记（测试与想重新探测时用）。
func ClearMaxTokensRejected(modelID string) {
	maxTokensRejected.Delete(modelID)
}

// DefaultMaxTokensFor 是调用方没写上限时该模型该用的值。required 表示
// 渠道必须带上限（Anthropic）。返回 0 表示不传。
func DefaultMaxTokensFor(modelID string, required bool) int {
	if _, rejected := maxTokensRejected.Load(modelID); !rejected {
		return DefaultMaxTokens
	}
	if required {
		return fallbackMaxTokens
	}
	return 0
}

// MaxTokensRejected 判断一次上游错误是否为「模型不接受这个输出上限」：
// 4xx 且消息提到各家的上限字段名。与 TemperatureRejected 一样宁可放宽：
// 误判的后果只是这个模型退回不带上限的老行为。
func MaxTokensRejected(status int, msg string) bool {
	if status >= 500 || msg == "" {
		return false
	}
	m := strings.ToLower(msg)
	for _, k := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens", "maxoutputtokens"} {
		if strings.Contains(m, k) {
			return true
		}
	}
	return false
}
