// 申诉详情页（_w/apv/<id>/<sig>）：资料、留底与申诉处理详情。
//
// 布局：手机一列；≥900px 主栏 + 资料/活动两列；≥1400px 三栏。
// 列数由纯 CSS 断点决定，不用 JS 读视口。每栏各包一层 div，避免栏内
// 多张卡片各自成为网格项被拆散。
//
// 内容按「结论 → 证据 → 资料」排序：管理员最先需要知道这单走到了哪一步。
import type { ReactNode } from 'react'
import {
  Activity,
  BadgeCheck,
  Bot,
  ClipboardList,
  FileText,
  Fingerprint,
  KeyRound,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Badge, Spinner } from '../../components/ui'
import type { AppealDossierView, WebRoute } from '../api'
import { GatePrompt } from '../GatePrompt'
import { InvalidState } from '../InvalidState'
import { useGate } from '../useGate'
import { ChatRef } from '../../components/mobile'
import { Callout, Meta, MetaGrid, Mono, PageHeader, SectionCard } from '../ui'

export function AppealViewPage({ route }: { route: WebRoute }) {
  const { gate, view, error, revealError, expired, loading, reveal } =
    useGate<AppealDossierView>(route)

  if (error) return <InvalidState message={error} />
  if (view) return <AppealContent view={view} />
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

function AppealContent({ view }: { view: AppealDossierView }) {
  return (
    <div data-testid="appeal-view">
      <PageHeader
        title="申诉详情"
        description="账号资料、留底与申诉处理记录。仅供管理员核对，请勿转发。"
        badge={<Badge tone="neutral">{view.status}</Badge>}
      />
      <Callout tone="warning" icon={<ShieldAlert />} title="敏感内容">
        以下为账号资料、留底与申诉处理详情，请勿转发或截图外传。
      </Callout>
      <div
        data-testid="appeal-grid"
        className="mt-4 grid grid-cols-1 items-start gap-4 min-[900px]:grid-cols-2 min-[1400px]:grid-cols-3"
      >
        <div
          data-testid="appeal-main"
          className="min-w-0 space-y-4 min-[900px]:row-span-2 min-[1400px]:row-span-1"
        >
          <MainColumn view={view} />
        </div>
        <div data-testid="appeal-profile" className="min-w-0 space-y-4">
          <SideProfile view={view} />
        </div>
        <div data-testid="appeal-activity" className="min-w-0 space-y-4">
          <SideActivity view={view} />
        </div>
      </div>
    </div>
  )
}

function MainColumn({ view }: { view: AppealDossierView }) {
  return (
    <>
      <SectionCard
        icon={<ClipboardList />}
        title="申诉概要"
        aside={<Mono className="text-[12px] text-muted-foreground">#{view.id}</Mono>}
      >
        <MetaGrid>
          <Meta label="申诉人">
            <Mono>{view.uid}</Mono>
            {view.u_name && <span className="text-muted-foreground">（{view.u_name}）</span>}
          </Meta>
          <Meta label="提交时间">
            <Mono>{view.created}</Mono>
          </Meta>
          <Meta label="当前状态">
            <Badge tone="neutral">{view.status}</Badge>
          </Meta>
          <Meta label="申诉理由" wide>
            <span className="whitespace-pre-wrap">{view.statement || '（未填写）'}</span>
          </Meta>
        </MetaGrid>
      </SectionCard>

      <SectionCard icon={<Sparkles />} title="AI 复核">
        <p className="text-[15px] leading-7">
          <span className="font-medium">{view.ai_result || '（无结论）'}</span>
          {view.ai_conf > 0 && (
            <span className="text-muted-foreground">
              {' '}
              · 置信度 {Math.round(view.ai_conf)}%
            </span>
          )}
        </p>
        {view.ai_model && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            模型 <Mono>{view.ai_model}</Mono>
          </p>
        )}
        {view.ai_reason && (
          <p className="mt-2 text-[14px] leading-6 break-words text-muted-foreground">
            理由：{view.ai_reason}
          </p>
        )}
      </SectionCard>

      <SectionCard icon={<KeyRound />} title="网页验证与解禁码">
        <MetaGrid>
          <Meta label="验证尝试">{view.web_attempts} 次</Meta>
          <Meta label="解禁码">
            {view.code ? (
              <span className="font-mono text-[15px] font-semibold tracking-wider break-all">
                {view.code}
              </span>
            ) : (
              <span className="text-muted-foreground">尚未签发</span>
            )}
          </Meta>
          {view.code_expires && (
            <Meta label="解禁码有效期" wide>
              <Mono>{view.code_expires}</Mono>
            </Meta>
          )}
        </MetaGrid>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          验证与发言记录见「活动记录」栏。
        </p>
      </SectionCard>
    </>
  )
}

/** SideProfile 是资料栏：账号信息 + 当前生效限制 + 历史处罚。 */
function SideProfile({ view }: { view: AppealDossierView }) {
  const limits = view.limits ?? []
  const penalties = view.penalties ?? []
  return (
    <>
      <SectionCard icon={<UserRound />} title="账号信息">
        <MetaGrid className="sm:grid-cols-1">
          <Meta label="用户 ID">
            <Mono>{view.uid}</Mono>
          </Meta>
          {view.u_name && <Meta label="判定时昵称">{view.u_name}</Meta>}
          <Meta label="所属 bot">{view.bot}</Meta>
          {view.first_seen && (
            <Meta label="首次见到">
              <Mono>{view.first_seen}</Mono>
            </Meta>
          )}
          {view.joined && (
            <Meta label="最早入群">
              <Mono>{view.joined}</Mono>
            </Meta>
          )}
          {view.last_msg && (
            <Meta label="最近发言">
              <Mono>{view.last_msg}</Mono>
            </Meta>
          )}
          <Meta label="群内发言">{view.msgs} 条</Meta>
          <Meta label="历史命中">{view.hits} 次</Meta>
          <Meta label="涉及群组">{view.chats} 个</Meta>
          {view.gban && <Meta label="联合封禁">{view.gban}</Meta>}
          <Meta label="生效中限制">
            <span className={limits.length > 0 ? 'font-semibold text-destructive' : undefined}>
              {limits.length} 条
            </span>
          </Meta>
        </MetaGrid>
      </SectionCard>

      <PenaltyList title="当前生效限制" items={limits} active />
      <PenaltyList title={`历史处罚（${penalties.length} 条）`} items={penalties} />
    </>
  )
}

/** SideActivity 是活动栏：留底发言 + 判定流水 + 网页验证 + 关联账号。 */
function SideActivity({ view }: { view: AppealDossierView }) {
  const history = view.history ?? []
  const historyMore = view.history_more ?? []
  const logs = view.logs ?? []
  const checks = view.checks ?? []
  const strong = view.strong ?? []
  const weak = view.weak ?? []
  return (
    <>
      <SectionCard icon={<Activity />} title="活动记录">
        <p className="text-[13px] leading-6 text-muted-foreground">
          下列记录按时间倒序排列，用于核对处罚与验证过程。
        </p>
      </SectionCard>

      {history.length > 0 && (
        <SectionCard icon={<FileText />} title={`群内留底发言（最近 ${view.history_count} 条）`}>
          <HistoryList items={history} />
          {historyMore.length > 0 && (
            <details className="mt-3">
              <summary className="text-[13px] font-medium">展开其余 {historyMore.length} 条</summary>
              <div className="mt-2">
                <HistoryList items={historyMore} />
              </div>
            </details>
          )}
        </SectionCard>
      )}

      {logs.length > 0 && (
        <SectionCard icon={<Bot />} title={`判定流水（${logs.length} 条）`}>
          <List>
            {logs.map((log) => (
              <li key={log.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Mono className="text-[12px] text-muted-foreground">{log.time}</Mono>
                  <ChatRef name={log.chat} url={log.chat_url} />
                  <span className="text-muted-foreground">· {log.verdict}</span>
                  <span className="text-muted-foreground">
                    {Math.round(log.confidence * 100)}%
                  </span>
                  <span>→ {log.action_label || log.action}</span>
                </div>
                {log.reason && <Sub>理由：{log.reason}</Sub>}
              </li>
            ))}
          </List>
        </SectionCard>
      )}

      {checks.length > 0 && (
        <SectionCard icon={<Fingerprint />} title={`网页验证记录（${checks.length} 条）`}>
          <List>
            {checks.map((check, index) => (
              <li key={index}>
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="text-[12px] text-muted-foreground">{check.time}</Mono>
                  <span>{check.result}</span>
                </div>
                {(check.ip || check.fp) && (
                  <Sub>
                    IP：<Mono>{check.ip || '—'}</Mono>
                    {check.fp && (
                      <>
                        {' · 指纹：'}
                        <Mono>{check.fp}</Mono>
                      </>
                    )}
                  </Sub>
                )}
                {check.flags && <Sub>信号：{check.flags}</Sub>}
                {check.ua && <Sub>UA：{check.ua}</Sub>}
              </li>
            ))}
          </List>
        </SectionCard>
      )}

      {(strong.length > 0 || weak.length > 0) && (
        <SectionCard icon={<BadgeCheck />} title="关联账号">
          {strong.length > 0 && (
            <>
              <p className="text-[13px] font-medium text-muted-foreground">强关联（同指纹）</p>
              <Related items={strong} />
            </>
          )}
          {weak.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-medium text-muted-foreground">
                弱关联（30 天内同 IP，仅供参考）
              </p>
              <Related items={weak} />
            </>
          )}
        </SectionCard>
      )}
    </>
  )
}

function PenaltyList({
  title,
  items,
  active,
}: {
  title: string
  items: NonNullable<AppealDossierView['limits']>
  active?: boolean
}) {
  if (items.length === 0) return null
  return (
    <SectionCard icon={<ShieldAlert />} title={title}>
      <List>
        {items.map((penalty, index) => (
          <li key={index}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={active ? 'no' : 'neutral'}>{active ? '生效中' : '历史'}</Badge>
              <span>{penalty.label || penalty.type}</span>
              {penalty.chat && (
                <span className="text-muted-foreground">
                  · <ChatRef name={penalty.chat} url={penalty.chat_url} />
                </span>
              )}
              {penalty.time && (
                <Mono className="text-[12px] text-muted-foreground">{penalty.time}</Mono>
              )}
            </div>
            {penalty.reason && <Sub>理由：{penalty.reason}</Sub>}
            {penalty.text && <Sub>原消息：{penalty.text}</Sub>}
          </li>
        ))}
      </List>
    </SectionCard>
  )
}

function HistoryList({ items }: { items: NonNullable<AppealDossierView['history']> }) {
  return (
    <List>
      {items.map((item, index) => (
        <li
          key={index}
          className={item.blocked ? '-mx-2 rounded-sm bg-destructive/6 px-2' : undefined}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <Mono>{item.time}</Mono>
            {item.chat && <ChatRef name={item.chat} url={item.chat_url} />}
          </div>
          <div className="mt-0.5 break-words">
            {item.text}
            {item.mark && (
              <Badge tone={item.blocked ? 'no' : 'neutral'} className="ml-2 align-[1px]">
                {item.mark}
              </Badge>
            )}
          </div>
        </li>
      ))}
    </List>
  )
}

function Related({ items }: { items: NonNullable<AppealDossierView['strong']> }) {
  return (
    <List>
      {items.map((related) => (
        <li key={related.uid} className="flex flex-wrap items-center gap-2">
          <Mono>{related.uid}</Mono>
          <span className="text-muted-foreground">{related.mark}</span>
        </li>
      ))}
    </List>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 space-y-3 pl-0 text-[14px] leading-6 [&>li]:list-none">{children}</ul>
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[12.5px] leading-5 break-words text-muted-foreground">{children}</p>
}
