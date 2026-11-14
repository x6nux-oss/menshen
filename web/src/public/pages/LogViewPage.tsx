// 原文查看页（_w/v/<id>/<sig>）：门槛凭据 → 判定记录详情。
//
// 这是管理员核对判定依据的页面，信息密度高于申诉页：先给结论，
// 再给原文与留底，避免一进来就被大量流水淹没。
import { CheckCircle2, FileText, ListChecks, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Badge, Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import { verdictInfo } from '../../lib/status'
import type { LogRecordView, WebRoute } from '../api'
import { GatePrompt } from '../GatePrompt'
import { InvalidState } from '../InvalidState'
import { useGate } from '../useGate'
import { Callout, Meta, MetaGrid, Mono, PageHeader, SectionCard } from '../ui'

export function LogViewPage({ route }: { route: WebRoute }) {
  const { gate, view, error, revealError, expired, loading, reveal } =
    useGate<LogRecordView>(route)

  if (error) return <InvalidState message={error} />
  if (view) return <LogContent view={view} />
  if (!gate)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={22} />
      </div>
    )
  return (
    <GatePrompt
      warn={gate.warn}
      ttlSeconds={gate.ttl_seconds}
      loading={loading}
      error={revealError}
      expired={expired}
      onReveal={() => void reveal()}
    />
  )
}

function LogContent({ view }: { view: LogRecordView }) {
  const record = view.record
  const verdict = verdictInfo(record.verdict)
  return (
    <div data-testid="log-view">
      <PageHeader
        title="判定记录"
        description="仅供管理员核对判定依据。请勿转发或截图外传。"
        badge={
          <Badge tone={verdict.tone}>
            {verdict.label} · {Math.round(record.confidence * 100)}%
          </Badge>
        }
      />

      <div className="space-y-4">
        <Callout tone="warning" icon={<TriangleAlert />} title="敏感内容">
          本页包含被判定消息的原文与账号资料，请勿转发。
        </Callout>

        <SectionCard
          icon={<ShieldAlert />}
          title="判定结论"
          aside={<Mono className="text-[12px] text-muted-foreground">#{record.id}</Mono>}
        >
          <MetaGrid>
            <Meta label="结论">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={verdict.tone}>{verdict.label}</Badge>
                <span className="text-[14px] text-muted-foreground">
                  置信度 {Math.round(record.confidence * 100)}%
                </span>
              </span>
            </Meta>
            <Meta label="处置">{record.action_label || record.action}</Meta>
            <Meta label="类型">{record.kind || '—'}</Meta>
            <Meta label="来源">{record.decider}</Meta>
            <Meta label="时间" wide>
              <Mono>{record.created}</Mono>
            </Meta>
            {record.reason && (
              <Meta label="判定理由" wide>
                <span className="whitespace-pre-wrap">{record.reason}</span>
              </Meta>
            )}
          </MetaGrid>
        </SectionCard>

        <SectionCard icon={<FileText />} title="被拦原文">
          <pre className="m-0 rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[13.5px] leading-6 break-words whitespace-pre-wrap">
            {record.text}
          </pre>
        </SectionCard>

        <SectionCard icon={<CheckCircle2 />} title="账号与群">
          <MetaGrid>
            <Meta label="用户">
              <Mono>{record.user_id}</Mono>
              {record.user_name && (
                <span className="text-muted-foreground">（{record.user_name}）</span>
              )}
            </Meta>
            <Meta label="群组">
              <ChatRef name={record.chat} url={record.chat_url} fallback={record.chat_id} />
            </Meta>
            <Meta label="入群时间">{view.member.joined || '未知'}</Meta>
            <Meta label="群内发言">{view.member.msgs} 条</Meta>
            <Meta label="历史命中">{view.member.hits} 次</Meta>
            <Meta label="消息 ID">
              <Mono>#{record.message_id}</Mono>
            </Meta>
          </MetaGrid>
        </SectionCard>

        {view.history.length > 0 && (
          <SectionCard icon={<FileText />} title={`该群最近留底（${view.history.length} 条）`}>
            <table className="w-full border-collapse">
              <tbody>
                {view.history.map((item) => (
                  <tr
                    key={item.message_id}
                    className={item.blocked ? 'bg-destructive/8' : undefined}
                  >
                    <td className="border-b border-border py-2 pr-3 align-top whitespace-nowrap text-[12.5px] text-muted-foreground">
                      {item.time}
                    </td>
                    <td className="border-b border-border py-2 text-[14px] leading-6 break-words">
                      {item.text}
                      {item.blocked && (
                        <Badge tone="no" className="ml-2 align-[1px]">
                          被拦
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}

        {view.logs.length > 0 && (
          <SectionCard icon={<ListChecks />} title={`该群最近判定记录（${view.logs.length} 条）`}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-[12px] text-muted-foreground">
                    <th className="border-b border-border py-2 pr-3 font-medium">记录</th>
                    <th className="border-b border-border py-2 pr-3 font-medium">时间</th>
                    <th className="border-b border-border py-2 pr-3 font-medium">结论</th>
                    <th className="border-b border-border py-2 font-medium">处置</th>
                  </tr>
                </thead>
                <tbody>
                  {view.logs.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b border-border py-2 pr-3 text-[13px] whitespace-nowrap">
                        <Mono>#{row.id}</Mono>
                      </td>
                      <td className="border-b border-border py-2 pr-3 text-[12.5px] whitespace-nowrap text-muted-foreground">
                        {row.time}
                      </td>
                      <td className="border-b border-border py-2 pr-3 text-[13.5px] whitespace-nowrap">
                        {verdictInfo(row.verdict).label} {Math.round(row.confidence * 100)}%
                      </td>
                      <td className="border-b border-border py-2 text-[13.5px]">
                        {row.action_label || row.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  )
}
