// 申诉详情：数据一律 POST appeal {id}——列表接口把 statement/ai_reason
// 截到 300 字且不含解禁码/兑换/网页验证记录，详情必须单独请求、完整展示。
// 底部操作栏按状态渲染：未结状态显示人工解除/驳回；
// web/noweb 追加签发解禁码，web/noweb/ai 追加重跑 AI 复核。操作走 appealact。
import { errorStatus } from '../api/client'
import { useAppeal, useMiniState } from '../api/hooks'
import { useAppealactMutation } from '../api/mutations'
import { ErrorState, Skeletons, useToast } from '../components/feedback'
import { ChatRef, SectionCard, useConfirm } from '../components/mobile'
import { Badge, Button } from '../components/ui'
import { apAI, displayTz, fmtTS } from '../lib/format'
import { appealStatusInfo } from '../lib/status'
import { useNav } from '../nav'
import { openLink } from '../telegram'
import { COMPACT_BTN, InfoRow, UserLink } from './shared'
import { useBarReserve } from './useBarReserve'

/** 未结状态集合。 */
const OPEN_STATUSES = ['statement', 'ai', 'web', 'noweb', 'code']

/** 底部操作栏兜底高度（4 按钮 + 说明）；有 ResizeObserver 时以实测为准。 */
const BAR_FALLBACK = 170

export function AppealDetailPage({ id }: { id: number }) {
  const nav = useNav()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)
  const appeal = useAppeal(id)
  const act = useAppealactMutation()
  // hooks 必须无条件调用：条形高度在数据到达前先用兜底估算。
  const { barRef, reserved } = useBarReserve(
    appeal.data !== undefined && OPEN_STATUSES.includes(appeal.data.status) ? BAR_FALLBACK : 0,
  )

  if (appeal.isPending) return <Skeletons rows={4} />
  if (appeal.isError) {
    return <ErrorState status={errorStatus(appeal.error)} onRetry={() => void appeal.refetch()} />
  }

  const a = appeal.data
  const status = appealStatusInfo(a.status)
  const tz = state.data ? displayTz(state.data) : undefined
  const bot = state.data?.bots.find((b) => b.bot_id === a.bot_id)
  const open = OPEN_STATUSES.includes(a.status)
  const canIssueCode = a.status === 'web' || a.status === 'noweb'
  const canRerun = canIssueCode || a.status === 'ai'

  const run = (action: string) => {
    act.mutate(
      { id, action },
      {
        onSuccess: (resp) => toast(resp.note ?? '已执行'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const approve = async () => {
    const ok = await confirm({
      title: '人工解除？',
      description: '确认通过并解除该用户全部限制？',
      confirmText: '解除',
    })
    if (ok) run('approve')
  }

  const reject = async () => {
    const ok = await confirm({
      title: '驳回申诉？',
      description: '确认驳回？限制保持原样。',
      confirmText: '确认驳回',
      danger: true,
    })
    if (ok) run('reject')
  }

  return (
    <div
      data-testid="appeal-detail-page"
      data-reserved={reserved}
      style={{ paddingBottom: open ? `calc(${reserved}px + env(safe-area-inset-bottom))` : 0 }}
    >
      <SectionCard>
        <InfoRow label="状态">
          <Badge tone={status.tone}>{status.label}</Badge>
        </InfoRow>
        <InfoRow label="申诉人 / bot">
          <UserLink userId={a.user_id} onClick={() => nav.push({ k: 'user', id: a.user_id })} />
          {` / ${bot ? bot.label : a.bot_id}`}
        </InfoRow>
        <InfoRow label="提交 / 更新">
          <span className="font-mono">
            {fmtTS(a.created_at, tz)} / {fmtTS(a.updated_at, tz)}
          </span>
        </InfoRow>
      </SectionCard>

      <SectionCard title="申诉理由">
        <div className="px-4 py-3">
          {a.statement !== '' ? (
            <p
              data-testid="appeal-statement"
              className="text-sm leading-[1.7] break-words whitespace-pre-wrap"
            >
              {a.statement}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">（未填写）</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="AI 复核">
        <InfoRow label="结论">
          {apAI(a.ai_result)}
          {a.ai_conf > 0 ? ` · ${Math.round(a.ai_conf * 100)}%` : ''}
          {a.ai_model !== '' ? ` · ${a.ai_model}` : ''}
          {a.ai_cost !== '' ? ` · 开销 ${a.ai_cost}` : ''}
        </InfoRow>
        {a.ai_reason !== '' && (
          <InfoRow label="理由">
            <span className="whitespace-pre-wrap">{a.ai_reason}</span>
          </InfoRow>
        )}
        <InfoRow label="网页验证">
          {a.web_attempts} 次尝试 · 验证记录 {a.web_checks} 条
          {a.web_checks > 0 ? `（通过 ${a.web_passes}）` : ''}
        </InfoRow>
      </SectionCard>

      <SectionCard title="解禁码">
        <InfoRow label="解禁码">
          {a.code !== '' ? (
            <span className="font-mono">{a.code}</span>
          ) : a.has_code ? (
            '已签发'
          ) : (
            '未签发'
          )}
        </InfoRow>
        <InfoRow label="到期">
          {a.has_code || a.code !== ''
            ? a.code_expires > 0
              ? fmtTS(a.code_expires, tz)
              : '无到期时间'
            : '—'}
        </InfoRow>
      </SectionCard>

      <SectionCard title="兑换记录">
        {a.redeems.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">暂无兑换</p>
        ) : (
          a.redeems.map((redeem, index) => (
            <InfoRow key={`${redeem.chat_id}-${redeem.at}-${index}`} label={`兑换 ${index + 1}`}>
              <span className="font-mono">
                群 <ChatRef name={redeem.chat} url={redeem.chat_url} fallback={redeem.chat_id} /> ·
                uid {redeem.by_uid} · {fmtTS(redeem.at, tz)}
              </span>
            </InfoRow>
          ))
        )}
      </SectionCard>

      {a.detail_url !== '' && (
        <div className="mb-3 px-4">
          <Button variant="outline" className="w-full" onClick={() => openLink(a.detail_url)}>
            打开申诉详情页
          </Button>
        </div>
      )}

      {open ? (
        // 纯色底 + 上边框，不用玻璃：这是压在长内容上的固定操作条，
        // 玻璃会让下面的正文透上来，按钮与文字互相干扰。
        <div
          ref={barRef}
          data-testid="appeal-action-bar"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card px-2.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]"
        >
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => void approve()}
              className={COMPACT_BTN}
            >
              人工解除
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => void reject()}
              className={`${COMPACT_BTN} text-destructive`}
            >
              驳回
            </Button>
            {canIssueCode && (
              <Button
                variant="outline"
                size="sm"
                disabled={act.isPending}
                onClick={() => run('issue_code')}
                className={COMPACT_BTN}
              >
                直接签发解禁码
              </Button>
            )}
            {canRerun && (
              <Button
                variant="outline"
                size="sm"
                disabled={act.isPending}
                onClick={() => run('rerun')}
                className={COMPACT_BTN}
              >
                重跑 AI 复核
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-[1.5] text-muted-foreground">
            人工解除与 AI 撤销同效：解除禁言与冷判定限制；联合封禁只有主管理员能在此一并解除。
          </p>
        </div>
      ) : (
        <div className="px-4">
          <p className="text-[13px] leading-[1.6] text-muted-foreground">
            该申诉已结（{status.label}），无需再处理。
          </p>
        </div>
      )}
    </div>
  )
}
