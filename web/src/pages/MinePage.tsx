// 我的：权限身份摘要 + 按职责分组的业务入口 + 测试台 + 页脚说明。
// 可见性：名单管理全员可用；上游渠道 / 模型定价 / 全局设置
// 只有主管理员能看（服务端仍是唯一裁决，这里只是入口不出现）。
import {
  Bot,
  ChevronRight,
  FlaskConical,
  Globe2,
  ListChecks,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { ErrorState, Skeletons } from '../components/feedback'
import { Badge } from '../components/ui'
import { SectionCard } from '../components/mobile'
import { meLabel } from '../lib/format'
import { APPEAL_DEMO_PATH, CAPTCHA_DEMO_PATH } from '../lib/settings'
import { useNav } from '../nav'

/** EntryRow 是带图标的管理入口；视觉与 ListRow 一致，但让分组更像业务菜单。 */
function EntryRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left outline-none transition-colors last:border-b-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs leading-[1.4] text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </button>
  )
}

export function MinePage() {
  const nav = useNav()
  const state = useMiniState(true)

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const { me, bots, chats } = state.data
  const role = me.main ? '主管理员' : '次级管理员'
  const ownBots = bots.filter((bot) => bot.owner_id === me.uid)
  const ownChats = chats.filter((chat) =>
    bots.some((bot) => bot.bot_id === chat.bot_id && bot.owner_id === me.uid),
  )

  return (
    <div data-testid="mine-page" className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl leading-[1.25] font-semibold">{role}</h2>
              <Badge tone={me.main ? 'ok' : 'neutral'}>{me.main ? '全量权限' : '业务权限'}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{meLabel(me)}</p>
          </div>
        </div>
        <p className="border-t border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {me.main
            ? '可以管理全部机器人、群组、名单与全局设置。'
            : '可以管理自己名下的机器人、群组，以及联合封禁名单。'}
        </p>
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          <div className="px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">名下机器人</p>
            <p className="text-lg font-semibold tabular-nums">{ownBots.length}</p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">可见群组</p>
            <p className="text-lg font-semibold tabular-nums">{ownChats.length}</p>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">身份</p>
            <p className="text-lg font-semibold tabular-nums">{me.main ? '主' : '次'}</p>
          </div>
        </div>
      </section>

      <SectionCard title="防护配置">
        <EntryRow
          icon={<ListChecks className="size-4" aria-hidden />}
          label="名单管理"
          hint={me.main ? '白名单、资料放行、联合封禁与次级管理员' : '联合封禁名单'}
          onClick={() => nav.push({ k: 'lists', section: me.main ? 'white' : 'gban' })}
        />
        {me.main && (
          <>
            <EntryRow
              icon={<UsersRound className="size-4" aria-hidden />}
              label="AI 必封规则"
              hint="AI 发现规则、覆盖率测试与强制处置"
              onClick={() => nav.push({ k: 'rules' })}
            />
            <EntryRow
              icon={<Settings2 className="size-4" aria-hidden />}
              label="全局设置"
              hint="参数、默认模型、时区与形态摘要"
              onClick={() => nav.push({ k: 'settings' })}
            />
          </>
        )}
      </SectionCard>

      {me.main && (
        <SectionCard title="模型与渠道">
          <EntryRow
            icon={<Server className="size-4" aria-hidden />}
            label="上游渠道"
            hint="API 渠道、密钥与能力开关"
            onClick={() => nav.push({ k: 'upstreams' })}
          />
          <EntryRow
            icon={<WalletCards className="size-4" aria-hidden />}
            label="模型定价"
            hint="登记模型、单价与启用状态"
            onClick={() => nav.push({ k: 'models' })}
          />
        </SectionCard>
      )}

      <SectionCard title="运行与诊断">
        <EntryRow
          icon={<Bot className="size-4" aria-hidden />}
          label="机器人状态"
          hint="查看名下机器人并进入详情"
          onClick={() => nav.switchTab('bots')}
        />
        <EntryRow
          icon={<Globe2 className="size-4" aria-hidden />}
          label="群组状态"
          hint="查看生效、演练与停用的群"
          onClick={() => nav.switchTab('chats')}
        />
        {me.main && (
          <>
            <EntryRow
              icon={<ScrollText className="size-4" aria-hidden />}
              label="运行日志"
              hint="最近的运行日志，按级别筛选与搜索"
              onClick={() => nav.push({ k: 'syslog' })}
            />
            <EntryRow
              icon={<ListChecks className="size-4" aria-hidden />}
              label="模型调用流水"
              hint="每次模型调用的输入输出、用量与耗时"
              onClick={() => nav.push({ k: 'ailog' })}
            />
          </>
        )}
      </SectionCard>

      {/* 测试台只在开启时出现（全局设置里的开关）；没开时入口本身就是 404。 */}
      {me.main && state.data.global?.captcha_demo === '1' && (
        <SectionCard title="测试与演示">
          <EntryRow
            icon={<FlaskConical className="size-4" aria-hidden />}
            label="人机验证测试台"
            hint="在浏览器里逐个完成 Turnstile / hCaptcha / Cap 验证"
            onClick={() => window.open(CAPTCHA_DEMO_PATH, '_blank', 'noopener')}
          />
          <EntryRow
            icon={<FlaskConical className="size-4" aria-hidden />}
            label="申诉验证测试台"
            hint="走申诉页同一条 Turnstile 校验路径，排查解封验证不通过"
            onClick={() => window.open(APPEAL_DEMO_PATH, '_blank', 'noopener')}
          />
        </SectionCard>
      )}

      <p className="px-1 pt-1 text-xs leading-[1.7] text-muted-foreground">
        本页仅管理员可见；接入新 bot 请在私聊面板操作。
      </p>
    </div>
  )
}
