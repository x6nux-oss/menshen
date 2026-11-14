// 模型调用详情页：一行 ai_log 的完整内容 —— 元信息 + 请求体/响应体全文。
//
// input 里的固定系统提示词在落库时已换成占位符（见 antiad/ailog.go），正文、
// 资料与上下文是原文。两段都是 JSON（截断的除外），尽量格式化展示，解析
// 失败就按原文渲染。
import { errorStatus } from '../api/client'
import { useAILogItem, useMiniState } from '../api/hooks'
import { ErrorState, Skeletons } from '../components/feedback'
import { Badge } from '../components/ui'
import { displayTz, fmtTSFull } from '../lib/format'

export function AILogItemPage({ id }: { id: number }) {
  const state = useMiniState(true)
  const item = useAILogItem(id)

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (item.isPending) return <Skeletons rows={3} />
  if (item.isError) {
    return <ErrorState status={errorStatus(item.error)} onRetry={() => void item.refetch()} />
  }
  const tz = displayTz(state.data)
  const ok = item.data.status === 'ok'

  return (
    <div data-testid="ailogitem-page" className="px-1">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={ok ? 'ok' : 'no'}>{ok ? '成功' : '失败'}</Badge>
        <span className="text-[13px] font-semibold break-all">{item.data.model || '（未记录）'}</span>
      </div>
      <p
        data-testid="ailogitem-meta"
        className="text-[12.5px] leading-[1.9] text-muted-foreground"
      >
        {fmtTSFull(item.data.ts, tz)} · 端点 {item.data.endpoint} · 上游{' '}
        {item.data.upstream || '—'}
        <br />
        时延 {item.data.latency_ms}ms · token {item.data.prompt_tokens}+
        {item.data.completion_tokens}
        {item.data.cached_tokens > 0 ? `（缓存命中 ${item.data.cached_tokens}）` : ''} · 开销{' '}
        {item.data.cost_text}
        {!ok && (
          <>
            <br />
            失败阶段：{item.data.status || 'error'}
            {item.data.error ? ` · ${item.data.error}` : ''}
          </>
        )}
      </p>

      <PayloadBlock
        title="请求体（固定提示词已省略）"
        text={pretty(item.data.input)}
        testId="ailogitem-input"
      />
      <PayloadBlock title="响应体" text={pretty(item.data.output)} testId="ailogitem-output" />
    </div>
  )
}

/** pretty 尽量把 JSON 格式化成缩进文本；截断过的或非 JSON 就原样返回。 */
function pretty(s: string): string {
  if (!s) return '（空）'
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

/** PayloadBlock 是一段等宽的只读载荷：标题行 + 滚动区。 */
function PayloadBlock({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[12.5px] font-semibold">{title}</p>
      <div
        data-testid={testId}
        className="max-h-90 overflow-auto rounded-md bg-muted p-2 font-mono text-[12px] leading-[1.6] break-all whitespace-pre-wrap"
      >
        {text}
      </div>
    </div>
  )
}
