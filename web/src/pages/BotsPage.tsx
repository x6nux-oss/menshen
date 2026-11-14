// 机器人列表：本地搜索（label/username/bot_id）+ 状态徽标 + 空态引导。
import { Bot } from 'lucide-react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { ListRow, SearchField, SectionCard } from '../components/mobile'
import { Badge, Button } from '../components/ui'
import { filterRows } from '../lib/filters'
import { useNav, usePageParam } from '../nav'
import { BotStatusBadge } from './shared'

export function BotsPage() {
  const nav = useNav()
  const state = useMiniState(true)
  const [q, setQ] = usePageParam('q')

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const bots = state.data.bots
  const visible = filterRows(bots, q, (b) => `${b.label} ${b.username} ${b.bot_id}`)
  const running = bots.filter((b) => b.enabled && b.live).length
  const disabled = bots.filter((b) => !b.enabled).length

  return (
    <div data-testid="bots-page" className="space-y-4">
      <section className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-3 py-3">
          <p className="text-[11px] text-muted-foreground">可管理</p>
          <p className="text-xl font-semibold tabular-nums">{bots.length}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[11px] text-muted-foreground">生效</p>
          <p className="text-xl font-semibold text-primary tabular-nums">{running}</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[11px] text-muted-foreground">不可用</p>
          <p className="text-xl font-semibold tabular-nums">{disabled}</p>
        </div>
      </section>
      {bots.length > 0 && (
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索名称 / 用户名 / bot ID"
          ariaLabel="搜索机器人"
        />
      )}
      {visible.length === 0 ? (
        bots.length === 0 ? (
          <EmptyState
            title="还没有可管理的机器人"
            description="接入新 bot 需要在 Telegram 里私聊主 bot，发送 /start 按引导操作；本页只展示你名下的机器人。"
          />
        ) : (
          <EmptyState title="没有匹配的机器人" description="换个关键词试试。" />
        )
      ) : (
        <SectionCard title="机器人" meta={`${visible.length} 台`}>
          {visible.map((bot) => (
            <ListRow
              key={bot.bot_id}
              primary={
                <>
                  {bot.label}
                  {bot.is_main && (
                    <>
                      {' '}
                      <Badge>主 bot</Badge>
                    </>
                  )}
                </>
              }
              secondary={`@${bot.username || '—'} · bot_id ${bot.bot_id}`}
              badge={<BotStatusBadge bot={bot} />}
              chevron
              onClick={() => nav.push({ k: 'bot', id: bot.bot_id })}
            />
          ))}
        </SectionCard>
      )}
      {bots.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs leading-[1.5] text-muted-foreground">
            接入新 bot 需要在 Telegram 私聊主 bot，按引导操作。
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => nav.switchTab('chats')}
          >
            <Bot aria-hidden />
            查看群组
          </Button>
        </div>
      )}
    </div>
  )
}
