// 概览（工作台）：待办跳转 + 近 24h 指标 + 最近命中 + 机器人状态。
// 数据源是外壳已经拉到的 ['state'] 缓存；最近命中额外请求 logs{verdict:'ad'}。
import { errorStatus } from '../api/client'
import { useLogs, useMiniState } from '../api/hooks'
import { ErrorState, Skeletons } from '../components/feedback'
import { ListRow, SectionCard } from '../components/mobile'
import { actionLabel, displayTz, fmtTS, kindLabel, verdictLabel } from '../lib/format'
import { useNav } from '../nav'
import { BotStatusBadge, Metric } from './shared'

/** 段落内的「暂无」文案：与列表行同高的轻提示。 */
function EmptyLine({ children }: { children: string }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

export function OverviewPage() {
  const nav = useNav()
  const state = useMiniState(true)
  const hits = useLogs({ filter: 'ad', page: 1 })

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const { todo, stats, bots } = state.data
  const tz = displayTz(state.data)
  const todos = [
    {
      key: 'appeals',
      label: '未结申诉',
      count: todo.open_appeals,
      go: () => nav.switchTab('records', 'appeals'),
    },
    {
      key: 'dryrun',
      label: '演练中的群',
      count: todo.dryrun_chats,
      go: () => nav.switchTab('chats', 'dryrun'),
    },
    {
      key: 'disabled',
      label: '停用的机器人',
      count: todo.disabled_bots,
      go: () => nav.switchTab('bots'),
    },
  ].filter((item) => item.count > 0)

  const recent = hits.data?.logs.slice(0, 3) ?? []

  return (
    <div data-testid="overview-page">
      <SectionCard title="待办">
        {todos.length === 0 ? (
          <EmptyLine>暂无待办事项</EmptyLine>
        ) : (
          todos.map((item) => (
            <ListRow
              key={item.key}
              primary={item.label}
              value={item.count}
              chevron
              onClick={item.go}
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="近 24 小时">
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <Metric label="送检" value={stats.checked} />
          <Metric label="命中" value={stats.hits} />
          <Metric label="折算开销" value={stats.cost_text} />
          <Metric label="生效群" value={stats.chats} />
        </div>
      </SectionCard>

      <SectionCard
        title="最近命中"
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

      <SectionCard title="机器人">
        {bots.length === 0 ? (
          <EmptyLine>还没有可管理的机器人</EmptyLine>
        ) : (
          bots.map((bot) => (
            <ListRow
              key={bot.bot_id}
              primary={bot.label}
              badge={<BotStatusBadge bot={bot} />}
              chevron
              onClick={() => nav.push({ k: 'bot', id: bot.bot_id })}
            />
          ))
        )}
      </SectionCard>
    </div>
  )
}
