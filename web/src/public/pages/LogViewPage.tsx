// 原文查看页（_w/v/<id>/<sig>）：门槛凭据 → 判定记录详情。
//
// Phase 4：展示层换到新设计系统。`useGate` 的调用与 reveal 流程一字未动。
import type { ReactNode } from 'react'
import { Button, Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import type { LogRecordView, WebRoute } from '../api'
import { InvalidState } from '../InvalidState'
import { useGate } from '../useGate'

const CARD = 'mb-4 rounded-lg bg-card p-4 text-card-foreground'
const TITLE = 'mb-2 text-[15px] font-bold'
// 表格单元格：py: 0.75(6px) → py-1.5；pr: 1.5(12px) → pr-3；13.5px 字号。
const TD = 'border-b border-border py-1.5 pr-3 text-[13.5px]'

export function LogViewPage({ route }: { route: WebRoute }) {
  const { gate, view, error, loading, reveal } = useGate<LogRecordView>(route)

  if (error) return <InvalidState message={error} />
  if (view) return <LogContent view={view} />
  if (!gate)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={22} />
      </div>
    )
  return (
    <>
      <WarnCard text={gate.warn} />
      <div className={CARD}>
        <Button disabled={loading} onClick={() => void reveal()}>
          {loading ? '正在读取…' : '查看内容'}
        </Button>
        <p className="mt-2 text-[13px] text-muted-foreground">
          链接只对持有者有效；查看凭据 {Math.round((gate.ttl_seconds || 300) / 60)} 分钟内有效。
        </p>
      </div>
    </>
  )
}

function LogContent({ view }: { view: LogRecordView }) {
  const r = view.record
  return (
    <div data-testid="log-view">
      <WarnCard text="敏感内容，请勿转发。页面仅供管理员核对判定依据。" />
      <div className={CARD}>
        <p className="text-[13.5px] leading-[1.9]">
          记录：<Mono>#{r.id}</Mono> ｜ 时间：{r.created}
          <br />
          用户：<Mono>{r.user_id}</Mono>
          {r.user_name && `（${r.user_name}）`}
          <br />
          群组：<ChatRef name={r.chat} url={r.chat_url} fallback={r.chat_id} />
          <br />
          入群时间：{view.member.joined || '未知'} ｜ 群内发言：{view.member.msgs} ｜ 历史命中：
          {view.member.hits}
        </p>
      </div>

      <div className={CARD}>
        <p className={TITLE}>判定</p>
        <p className="text-[13.5px] leading-[1.9]">
          结论：{r.verdict} ｜ 类型：{r.kind || '—'} ｜ 置信度：
          {Math.round(r.confidence * 100)}%
          <br />
          来源：{r.decider}
          {r.reason && ` ｜ 理由：${r.reason}`}
          <br />
          处置：{r.action_label || r.action}
        </p>
        <p className={`${TITLE} mt-3`}>被拦原文</p>
        {/* 旧实现是 Box component="pre" + m:0 p:1.25(10px) → p-2.5，圆角 1(4px) → rounded */}
        <pre className="m-0 rounded bg-muted p-2.5 font-mono text-[13px] break-words whitespace-pre-wrap">
          {r.text}
        </pre>
      </div>

      {view.history.length > 0 && (
        <div className={CARD}>
          <p className={TITLE}>该群最近留底（{view.history.length} 条）</p>
          <table className="w-full border-collapse">
            <tbody>
              {view.history.map((h) => (
                <tr key={h.message_id} className={h.blocked ? 'bg-destructive/10' : undefined}>
                  <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{h.time}</td>
                  <td className={TD}>
                    {h.text}
                    {h.blocked && <b> ← 被拦</b>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.logs.length > 0 && (
        <div className={CARD}>
          <p className={TITLE}>该群最近判定记录（{view.logs.length} 条）</p>
          <table className="w-full border-collapse">
            <tbody>
              {view.logs.map((l) => (
                <tr key={l.id}>
                  <td className={TD}>
                    <Mono>#{l.id}</Mono>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-muted-foreground`}>{l.time}</td>
                  <td className={TD}>
                    {l.verdict} {Math.round(l.confidence * 100)}%
                  </td>
                  <td className={TD}>{l.action_label || l.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WarnCard({ text }: { text: string }) {
  return (
    <div className="mb-4 rounded-lg bg-warning p-3 text-[13px] leading-[1.7] text-warning-foreground">
      {text}
    </div>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>
}
