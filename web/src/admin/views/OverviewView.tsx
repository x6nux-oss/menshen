import { Activity, ArrowRight, Bot, ChevronRight, Clock3, Coins, FlaskConical, MessageSquareText, Power, RefreshCw, ShieldCheck, ShieldX, Users } from 'lucide-react'
import { errorStatus } from '../../api/client'
import { useLogs, useMiniState } from '../../api/hooks'
import type { Bot as BotData, LogRow } from '../../api/types'
import { EmptyState, ErrorState } from '../../components/feedback'
import { Badge, Button } from '../../components/ui'
import { actionLabel, displayTz, fmtTS, kindLabel } from '../../lib/format'
import { botStatus } from '../../lib/status'
import { cn } from '../../lib/utils'
import { CardBlock, DataTable, PageHeader, StatCard, StatusBadge } from '../components'
import { useAdminNav } from '../nav'
import { adminPath } from '../route'

export function OverviewView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const hits = useLogs({ filter: 'ad', page: 1 })

  if (!state.data) return null
  const { todo, stats, bots, chats } = state.data
  const liveBots = bots.filter((bot) => bot.live && bot.enabled).length
  const refreshing = state.isFetching || hits.isFetching
  const appealsURL = new URL(adminPath({ k: 'records' }), location.origin)
  appealsURL.searchParams.set('tab', 'appeals')

  return (
    <div>
      <PageHeader
        title="防护工作台"
        subtitle="掌握群组防护，处理值得你关注的事。"
        actions={
          <>
            <Button variant="outline" disabled={refreshing} onClick={() => { void state.refetch(); void hits.refetch() }}>
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
              {refreshing ? '刷新中' : '刷新数据'}
            </Button>
            <Button onClick={() => nav.go({ k: 'records' })}>查看判定记录<ArrowRight className="size-4" aria-hidden /></Button>
          </>
        }
      />

      <section aria-label="运行概况" className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-primary/20 bg-primary/5 px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><ShieldCheck className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">当前防护范围</p>
          <p className="mt-1 text-xs text-muted-foreground">已接入 {chats.length} 个群组 · {liveBots} / {bots.length} 台机器人在线并启用</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" aria-hidden />近 24 小时</span>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="已判定消息" value={stats.checked.toLocaleString()} hint="每条消息，逐一检测" icon={<Activity />} />
        <StatCard label="命中广告" value={stats.hits.toLocaleString()} hint={stats.checked > 0 ? `占已判定消息的 ${(stats.hits / stats.checked * 100).toFixed(1)}%` : '暂无判定数据'} icon={<ShieldX />} />
        <StatCard label="模型开销" value={stats.cost_text} hint="按模型定价折算" icon={<Coins />} />
        <StatCard label="生效群组" value={stats.chats.toLocaleString()} hint="已启用防护的群组" icon={<Users />} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <CardBlock title="最近命中" actions={<Button variant="ghost" size="sm" onClick={() => nav.go({ k: 'records' })}>全部记录<ArrowRight className="size-3.5" aria-hidden /></Button>}>
          <p className="mb-4 text-xs text-muted-foreground">最新 6 条广告判定，点击查看原文与处置依据。</p>
          {hits.isError ? (
            <ErrorState status={errorStatus(hits.error)} onRetry={() => void hits.refetch()} />
          ) : (
            <RecentHits rows={hits.data?.logs ?? []} loading={hits.isPending} tz={displayTz(state.data)} onOpen={(id) => nav.go({ k: 'log', id })} />
          )}
        </CardBlock>

        <div>
          <CardBlock title="需要关注">
            <div className="divide-y divide-border">
              <a href={appealsURL.pathname + appealsURL.search} className="group flex items-center gap-3 rounded-md py-4 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/8 text-warning"><MessageSquareText className="size-4" aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">未结申诉</p><p className="mt-0.5 text-xs text-muted-foreground">{todo.open_appeals ? '核对依据，及时回应' : '暂无待处理的申诉'}</p></div>
                <span className="text-lg font-semibold tabular-nums">{todo.open_appeals}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </a>
              <button type="button" onClick={() => nav.go({ k: 'chats' })} className="flex w-full items-center gap-3 rounded-md py-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><FlaskConical className="size-4" aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">演练中的群</p><p className="mt-0.5 text-xs text-muted-foreground">只记录判定，暂不执行处置</p></div>
                <span className="text-lg font-semibold tabular-nums">{todo.dryrun_chats}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </button>
              <button type="button" onClick={() => nav.go({ k: 'bots' })} className="flex w-full items-center gap-3 rounded-md py-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Power className="size-4" aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">停用的机器人</p><p className="mt-0.5 text-xs text-muted-foreground">检查是否需要恢复工作</p></div>
                <span className="text-lg font-semibold tabular-nums">{todo.disabled_bots}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </div>
          </CardBlock>
          <CardBlock title="机器人状态" actions={<Button variant="ghost" size="sm" onClick={() => nav.go({ k: 'bots' })}>管理<ArrowRight className="size-3.5" aria-hidden /></Button>}>
            <BotStatusList bots={bots} onOpen={(id) => nav.go({ k: 'bot', id })} onAdd={() => nav.go({ k: 'bots' })} />
          </CardBlock>
        </div>
      </div>
    </div>
  )
}

function RecentHits({ rows, loading, tz, onOpen }: { rows: LogRow[]; loading: boolean; tz?: string; onOpen: (id: number) => void }) {
  return (
    <DataTable
      loading={loading}
      rows={rows.slice(0, 6)}
      rowKey={(row) => row.id}
      onRowClick={(row) => onOpen(row.id)}
      empty={<EmptyState icon={<ShieldCheck />} title="暂无命中记录" description="广告命中后，会在这里展示消息、原因和处置结果。" />}
      columns={[
        {
          key: 'content', header: '消息与判定',
          render: (row) => <div className="min-w-40 max-w-sm"><p className="line-clamp-1 text-[13px] font-medium">{row.text || row.reason || `记录 #${row.id}`}</p><p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{row.chat || `群 ${row.chat_id}`} · uid {row.user_id}</p></div>,
        },
        { key: 'kind', header: '类型', render: (row) => <Badge tone="no">{kindLabel(row.kind)}</Badge> },
        { key: 'action', header: '处置', render: (row) => <span className="whitespace-nowrap text-xs">{actionLabel(row.action)}</span> },
        { key: 'time', header: '时间', render: (row) => <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmtTS(row.created_at, tz)}</span> },
      ]}
    />
  )
}

function BotStatusList({ bots, onOpen, onAdd }: { bots: BotData[]; onOpen: (id: number) => void; onAdd: () => void }) {
  if (bots.length === 0) return <EmptyState icon={<Bot />} title="接入第一台机器人" description="接入工作机器人后，即可为群组配置防护。" action={<Button size="sm" onClick={onAdd}>接入机器人</Button>} />
  return (
    <div className="divide-y divide-border">
      {bots.slice(0, 5).map((bot) => (
        <button type="button" key={bot.bot_id} onClick={() => onOpen(bot.bot_id)} className="flex w-full items-center gap-2.5 rounded-md py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground"><Bot className="size-[18px]" aria-hidden /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{bot.label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{bot.is_main ? '管理机器人' : '工作机器人'}</span></span>
          <StatusBadge info={botStatus(bot)} />
        </button>
      ))}
      {bots.length > 5 && <p className="pt-3 text-xs text-muted-foreground">还有 {bots.length - 5} 台，可前往机器人页面查看。</p>}
    </div>
  )
}
