// 机器人列表：本地搜索（label/username/bot_id）+ 状态徽标 + 空态引导。
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { ListRow, SearchField, SectionCard } from '../components/mobile'
import { Badge } from '../components/ui'
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

  return (
    <div data-testid="bots-page">
      {bots.length > 0 && (
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索名称 / 用户名 / bot ID"
          ariaLabel="搜索机器人"
          className="mb-3"
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
        <SectionCard>
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
    </div>
  )
}
