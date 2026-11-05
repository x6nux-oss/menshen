// 记录详情：信息卡 + 原文卡 + 底部固定操作栏。
// 数据必须单独请求 log{id}（列表正文里后端会回查全量留底，列表数据不完整）。
// 操作走 logact；成功后由 mutation 统一失效 ['log']/['logs']/['user']/['state']，
// 详情与列表都会刷新；服务端 note 优先 toast。
import type { ReactNode } from 'react'
import { errorStatus } from '../api/client'
import { useLog, useMiniState } from '../api/hooks'
import { useLogactMutation, useRulesMutation } from '../api/mutations'
import { ErrorState, Skeletons, useToast } from '../components/feedback'
import { ChatRef, SectionCard, useConfirm } from '../components/mobile'
import { Button } from '../components/ui'
import { actionLabel, deciderLabel, displayTz, fmtTS, kindLabel, verdictLabel } from '../lib/format'
import { useNav } from '../nav'
import { openLink } from '../telegram'
import { COMPACT_BTN, InfoRow, UserLink } from './shared'
import { useBarReserve } from './useBarReserve'

// 主操作；危险项带确认文案。
// 内容区底部预留由 useBarReserve 实测（主管理员 6 按钮 + 说明约 210px，兜底值）。
interface ActionSpec {
  action: string
  label: string
  danger?: boolean
  /** 确认面板文案；缺省直接执行。 */
  confirmTitle?: string
  confirmDescription?: string
}

const PRIMARY_ACTIONS: ActionSpec[] = [
  { action: 'review', label: 'AI 复查' },
  { action: 'unmute', label: '解封（判定维持）' },
  { action: 'white', label: '加白名单 24h' },
  {
    action: 'ban',
    label: '人工标记广告',
    danger: true,
    confirmTitle: '人工标记广告？',
    confirmDescription: '不经 AI 直接按最高档处置？',
  },
]

const GBAN_ACTIONS: ActionSpec[] = [
  {
    action: 'gban',
    label: '联合封禁',
    danger: true,
    confirmTitle: '联合封禁？',
    confirmDescription: '加入联合封禁名单并全平台执行？',
  },
  {
    action: 'ungban',
    label: '解除联合封禁',
    danger: true,
    confirmTitle: '解除联合封禁？',
    confirmDescription: '把该用户从你能解除的联合封禁名单里移除。',
  },
]

/** 底部操作栏兜底高度：普通管理员 4 按钮约 170px；主管理员 6 按钮 ≥210px。
 * 有 ResizeObserver 时以实测为准（useBarReserve），这里只是 jsdom 等环境的保底。 */
const BAR_FALLBACK = 170
const BAR_FALLBACK_MAIN = 210

export function LogDetailPage({ id }: { id: number }) {
  const nav = useNav()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)
  const log = useLog(id)
  const act = useLogactMutation()
  const ruleMut = useRulesMutation()
  const isMain = state.data?.me.main ?? false
  const { barRef, reserved } = useBarReserve(isMain ? BAR_FALLBACK_MAIN : BAR_FALLBACK)

  if (log.isPending) return <Skeletons rows={4} />
  if (log.isError) {
    return <ErrorState status={errorStatus(log.error)} onRetry={() => void log.refetch()} />
  }

  const l = log.data
  const tz = state.data ? displayTz(state.data) : undefined
  const chat = state.data?.chats.find((c) => c.chat_id === l.chat_id)

  const run = (spec: ActionSpec) => {
    return async () => {
      if (spec.confirmTitle) {
        const ok = await confirm({
          title: spec.confirmTitle,
          description: spec.confirmDescription,
          confirmText: '确定',
          danger: spec.danger,
        })
        if (!ok) return
      }
      act.mutate(
        { id, action: spec.action },
        {
          onSuccess: (resp) => toast(resp.note ?? '已执行'),
          onError: (err) => toast(err.message),
        },
      )
    }
  }

  // 针对这条记录跑一轮 AI 规则发现：Agent 围绕本条原文写正则，并用 find /
  // list_uncovered 等工具搜索同类形态；进度在 `我的 → AI 必封规则` 页查看。
  const startRuleAgent = () => {
    ruleMut.mutate(
      { action: 'agent_start', record_id: id },
      {
        onSuccess: () =>
          toast('已开始针对本条记录发现规则，可在「我的 → AI 必封规则」查看进度'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const details: { label: string; value: ReactNode }[] = [
    { label: '时间', value: <Mono>{fmtTS(l.created_at, tz)}</Mono> },
    {
      label: '群 / 用户',
      value: (
        <>
          <ChatRef name={l.chat || chat?.title} url={l.chat_url} fallback={l.chat_id} />
          {' / '}
          <UserLink userId={l.user_id} onClick={() => nav.push({ k: 'user', id: l.user_id })} />
        </>
      ),
    },
    {
      label: '判定',
      value: [
        verdictLabel(l.verdict),
        `${Math.round(l.confidence * 100)}%`,
        l.decider ? deciderLabel(l.decider) : '',
        l.kind ? kindLabel(l.kind) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    },
    { label: '处置', value: actionLabel(l.action) },
    { label: '开销', value: <Mono>{l.cost_text}</Mono> },
    ...(l.reason ? [{ label: '理由', value: l.reason }] : []),
  ]

  return (
    <div
      data-testid="log-detail-page"
      data-reserved={reserved}
      style={{ paddingBottom: `calc(${reserved}px + env(safe-area-inset-bottom))` }}
    >
      <SectionCard>
        {details.map((row) => (
          <InfoRow key={row.label} label={row.label}>
            {row.value}
          </InfoRow>
        ))}
      </SectionCard>

      <SectionCard title="原文">
        <div className="px-4 py-3">
          {l.text !== '' ? (
            <pre className="m-0 font-mono text-[13px] leading-[1.7] break-words whitespace-pre-wrap">
              {l.text}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">（正文为空）</p>
          )}
          {l.view_url !== '' && (
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => openLink(l.view_url)}
            >
              打开原文查看页
            </Button>
          )}
        </div>
      </SectionCard>

      {/* 纯色底 + 上边框，不用玻璃：这是压在长内容上的固定操作条，
          玻璃会让下面的正文透上来，按钮与文字互相干扰。 */}
      <div
        ref={barRef}
        data-testid="log-action-bar"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card px-2.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-wrap gap-1.5">
          {PRIMARY_ACTIONS.map((spec) => (
            <Button
              key={spec.action}
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => void run(spec)()}
              className={spec.danger ? `${COMPACT_BTN} text-destructive` : COMPACT_BTN}
            >
              {spec.label}
            </Button>
          ))}
          {isMain && (
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending || ruleMut.isPending}
              onClick={startRuleAgent}
              className={COMPACT_BTN}
            >
              AI 写规则
            </Button>
          )}
          {isMain &&
            GBAN_ACTIONS.map((spec) => (
              <Button
                key={spec.action}
                variant="outline"
                size="sm"
                disabled={act.isPending}
                onClick={() => void run(spec)()}
                className={`${COMPACT_BTN} text-destructive`}
              >
                {spec.label}
              </Button>
            ))}
        </div>
        <p className="mt-1 text-[11px] leading-[1.5] text-muted-foreground">
          复查结果发到群里（受群内静默开关约束）；人工标记与群内 /ban 命令同效；
          AI 写规则围绕本条原文生成候选。
        </p>
      </div>
    </div>
  )
}

/** Mono 给标识类值（时间/群号/开销）一个等宽字体。 */
function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>
}
