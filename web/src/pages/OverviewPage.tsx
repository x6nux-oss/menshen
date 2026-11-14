// 概览（值守台）：首要待办 + 近 24h 防护数据 + 业务入口 + 最近命中/机器人。
// 数据源是外壳已经拉到的 ['state'] 缓存；最近命中额外请求 logs{verdict:'ad'}。
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { errorStatus } from '../api/client'
import { useLogs, useMiniState } from '../api/hooks'
import { ErrorState, Skeletons } from '../components/feedback'
import { Badge, Button } from '../components/ui'
import { ListRow, SectionCard } from '../components/mobile'
import { actionLabel, displayTz, fmtTS, kindLabel, verdictLabel } from '../lib/format'
import { useNav } from '../nav'
import { BotStatusBadge } from './shared'

function EmptyLine({ children }: { children: string }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

/** Stat 是防护数据的一格：大数字 + 小标签，值一眼可扫。 */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <p className="text-xs leading-[1.4] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[24px] leading-[1.2] font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  )
}

/** Entry 是业务入口的单个实底按钮。 */
function Entry({
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
      className="flex min-h-20 flex-col items-start gap-2 rounded-md border border-border bg-card px-3 py-3 text-left outline-none transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-[1.4] text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

export function OverviewPage() {
  const nav = useNav()
  const state = useMiniState(true)
  const hits = useLogs({ filter: 'ad', page: 1 })

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const { todo, stats, bots, me } = state.data
  const tz = displayTz(state.data)
  const todos = [
    {
      key: 'appeals',
      label: '未结申诉',
      hint: '需要人工判断或解除限制',
      count: todo.open_appeals,
      icon: <ClipboardList className="size-4" aria-hidden />,
      go: () => nav.switchTab('records', 'appeals'),
    },
    {
      key: 'dryrun',
      label: '演练中的群',
      hint: '只记录判定，确认后关闭演练',
      count: todo.dryrun_chats,
      icon: <FlaskConical className="size-4" aria-hidden />,
      go: () => nav.switchTab('chats', 'dryrun'),
    },
    {
      key: 'disabled',
      label: '停用的机器人',
      hint: '检查配置或恢复启用',
      count: todo.disabled_bots,
      icon: <Bot className="size-4" aria-hidden />,
      go: () => nav.switchTab('bots'),
    },
  ].filter((item) => item.count > 0)
  const todoTotal = todos.reduce((sum, item) => sum + item.count, 0)
  const recent = hits.data?.logs.slice(0, 3) ?? []

  return (
    <div
      data-testid="overview-page"
      className="space-y-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-4 lg:space-y-0"
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card lg:col-span-5 lg:row-span-2">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary">
              {me.main ? '全局值守' : '我的值守'}
            </p>
            <h2 className="text-lg leading-[1.3] font-semibold">
              {todoTotal > 0 ? `${todoTotal} 项待办需要处理` : '当前没有待办'}
            </h2>
          </div>
          <Badge tone={todoTotal > 0 ? 'warn' : 'ok'}>
            {todoTotal > 0 ? '待处理' : '正常'}
          </Badge>
        </div>
        {todos.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <ShieldCheck className="size-5 text-success" aria-hidden />
            <p className="text-sm text-muted-foreground">暂无待办事项，防护任务运行正常。</p>
          </div>
        ) : (
          <div>
            {todos.map((item, index) => (
              <button
                key={item.key}
                type="button"
                onClick={item.go}
                className="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-warning/15 text-warning">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
                <span className="text-lg font-semibold tabular-nums">{item.count}</span>
                {index === 0 && <span className="text-xs font-medium text-primary">优先</span>}
                <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="lg:col-span-7">
        <div className="mb-1.5 flex items-baseline justify-between px-0.5">
          <h2 className="text-sm font-semibold">近 24 小时防护</h2>
          <span className="text-xs text-muted-foreground">判定与处置概况</span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border xl:grid-cols-4">
          <Stat label="送检" value={stats.checked} />
          <Stat label="命中" value={stats.hits} />
          <Stat label="折算开销" value={stats.cost_text} />
          <Stat label="生效群" value={stats.chats} />
        </div>
      </section>

      <section className="lg:col-span-7">
        <div className="mb-1.5 px-0.5">
          <h2 className="text-sm font-semibold">业务入口</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Entry
            icon={<Bot className="size-4" aria-hidden />}
            label="管理机器人"
            hint="状态、模型与参数覆盖"
            onClick={() => nav.switchTab('bots')}
          />
          <Entry
            icon={<Users className="size-4" aria-hidden />}
            label="群组管理"
            hint="演练、处罚与批量操作"
            onClick={() => nav.switchTab('chats')}
          />
          <Entry
            icon={<ListChecks className="size-4" aria-hidden />}
            label="待办记录"
            hint="申诉与判定流水"
            onClick={() => nav.switchTab('records')}
          />
          <Entry
            icon={
              me.main ? (
                <Settings className="size-4" aria-hidden />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )
            }
            label={me.main ? '值守设置' : '名单权限'}
            hint={me.main ? '全局参数、模型与验证' : '查看联合封禁名单'}
            onClick={() =>
              me.main
                ? nav.push({ k: 'settings' })
                : nav.push({ k: 'lists', section: 'gban' })
            }
          />
        </div>
      </section>

      <div className="grid gap-4 lg:col-span-12 lg:grid-cols-2 lg:items-start lg:*:mb-0">
        <SectionCard
          title="最近命中"
          meta="广告判定"
          footer={<ListRow primary="全部记录" chevron onClick={() => nav.switchTab('records')} />}
        >
          {hits.isPending ? (
            <Skeletons rows={2} />
          ) : hits.isError ? (
            <ErrorState status={errorStatus(hits.error)} onRetry={() => void hits.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyLine>最近没有命中</EmptyLine>
          ) : (
            recent.map((log) => (
              <ListRow
                key={log.id}
                primary={`#${log.id} ${verdictLabel(log.verdict)}`}
                secondary={[actionLabel(log.action), kindLabel(log.kind)].join(' · ')}
                value={fmtTS(log.created_at, tz)}
                chevron
                onClick={() => nav.push({ k: 'log', id: log.id })}
              />
            ))
          )}
        </SectionCard>

        <SectionCard
          title="机器人"
          meta={`${bots.length} 台`}
          footer={
            <div className="px-3 py-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => nav.switchTab('bots')}
              >
                <Bot aria-hidden />
                查看全部机器人
              </Button>
            </div>
          }
        >
          {bots.length === 0 ? (
            <EmptyLine>还没有可管理的机器人</EmptyLine>
          ) : (
            bots.map((bot) => (
              <ListRow
                key={bot.bot_id}
                primary={bot.label}
                secondary={`@${bot.username || '—'} · bot_id ${bot.bot_id}`}
                badge={<BotStatusBadge bot={bot} />}
                chevron
                onClick={() => nav.push({ k: 'bot', id: bot.bot_id })}
              />
            ))
          )}
        </SectionCard>
      </div>

      {todoTotal > 0 && (
        <p className="flex items-start gap-1.5 px-1 pb-1 text-[11px] leading-[1.6] text-muted-foreground lg:col-span-12">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          待办数据来自当前账号可见范围；处置后列表会自动刷新。
        </p>
      )}
    </div>
  )
}
