// 机器人列表：状态快捷筛选 + 搜索 + 可扫读的能力列。行点击进入详情。
import { useMemo } from 'react'
import { useMiniState } from '../../api/hooks'
import { filterRows } from '../../lib/filters'
import { botStatus } from '../../lib/status'
import { SearchField } from '../../components/mobile'
import { PageHeader, StatusBadge } from '../components'
import { DataTable } from '../data-table'
import { useAdminNav } from '../nav'
import type { Column } from '../components'
import type { Bot } from '../../api/types'
import { FilterChips } from './list-tools'
import { useSearchHotkey } from './use-search-hotkey'
import { choiceParam, textParam, useUrlFilter } from './use-url-filters'

const BOT_STATES = ['all', 'running', 'offline', 'disabled', 'main'] as const
type BotState = (typeof BOT_STATES)[number]
const BOT_STATE_PARAM = choiceParam(BOT_STATES)
const SEARCH_PARAM = textParam()

function stateOf(bot: Bot): Exclude<BotState, 'all'> {
  if (bot.is_main) return 'main'
  if (!bot.enabled) return 'disabled'
  return bot.live ? 'running' : 'offline'
}

export function BotsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const [q, setQ] = useUrlFilter('q', '', SEARCH_PARAM)
  const [status, setStatus] = useUrlFilter('status', 'all', BOT_STATE_PARAM)
  const searchRef = useSearchHotkey<HTMLDivElement>()

  const data = state.data
  const chatsByBot = useMemo(() => {
    const counts = new Map<number, number>()
    for (const chat of data?.chats ?? []) {
      counts.set(chat.bot_id, (counts.get(chat.bot_id) ?? 0) + 1)
    }
    return counts
  }, [data?.chats])

  if (!data) return null
  const bots = data.bots
  const matched = filterRows(
    bots,
    q,
    (b) => `${b.label} ${b.username} ${b.bot_id} ${ownerLabel(data.owner_opts, b.owner_id)}`,
  )
  const rows = matched.filter((b) => status === 'all' || stateOf(b) === status)
  const counts: Record<BotState, number> = {
    all: bots.length,
    running: bots.filter((b) => stateOf(b) === 'running').length,
    offline: bots.filter((b) => stateOf(b) === 'offline').length,
    disabled: bots.filter((b) => stateOf(b) === 'disabled').length,
    main: bots.filter((b) => stateOf(b) === 'main').length,
  }

  const columns: Column<Bot>[] = [
    {
      key: 'label',
      header: '机器人',
      render: (row) => <BotIdentity bot={row} />,
    },
    {
      key: 'status',
      header: '运行状态',
      width: 110,
      render: (row) => <StatusBadge info={botStatus(row)} />,
    },
    {
      key: 'owner',
      header: '归属',
      width: 170,
      render: (row) => (
        <span className="text-[13px] text-muted-foreground">
          {ownerLabel(data.owner_opts, row.owner_id)}
        </span>
      ),
    },
    {
      key: 'chats',
      header: '群组',
      width: 80,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">{chatsByBot.get(row.bot_id) ?? 0}</span>
      ),
    },
    {
      key: 'models',
      header: '判定路由',
      width: 190,
      render: (row) => <ModelRoute bot={row} />,
    },
    {
      key: 'id',
      header: 'bot id',
      width: 120,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {row.bot_id}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="机器人"
        subtitle={`${bots.length} 个机器人 · 列表按你的归属权限过滤`}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.bot_id}
        onRowClick={(row) => nav.go({ k: 'bot', id: row.bot_id })}
        empty={
          <span className="text-[13px] text-muted-foreground">
            {q || status !== 'all' ? '没有匹配的机器人，试试清空筛选。' : '还没有机器人。'}
          </span>
        }
        columns={columns}
        toolbar={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div ref={searchRef} className="w-full max-w-[320px]">
              <SearchField
                value={q}
                onChange={setQ}
                placeholder="搜索名称 / @用户名 / bot id"
              />
            </div>
            <FilterChips
              ariaLabel="按运行状态筛选"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部', count: counts.all },
                { value: 'running', label: '运行中', count: counts.running },
                { value: 'offline', label: '未运行', count: counts.offline },
                { value: 'disabled', label: '已停用', count: counts.disabled },
                { value: 'main', label: '主 bot', count: counts.main },
              ]}
            />
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>
              显示 {rows.length} / {bots.length} 个
            </span>
            <span>
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">/</kbd>{' '}
              聚焦搜索 · 回车打开
            </span>
          </div>
        }
      />
    </>
  )
}

function ownerLabel(opts: { user_id: number; label: string }[] | undefined, ownerId: number) {
  return opts?.find((o) => o.user_id === ownerId)?.label ?? `uid ${ownerId}`
}

function ModelRoute({ bot }: { bot: Bot }) {
  const configured = bot.so_models.length + bot.llm_models.length
  if (configured === 0) {
    return <span className="text-[12.5px] text-muted-foreground">跟随全局</span>
  }
  return (
    <span className="text-[12.5px] text-muted-foreground">
      初判 {bot.so_models.length || '全局'} · 复判 {bot.llm_models.length || '全局'}
    </span>
  )
}

/** BotName 机器人名 + 主 bot 标记。 */
export function BotName({ bot }: { bot: Bot }) {
  return (
    <span className="flex items-center gap-1.5 text-[13.5px]">
      <span className="font-medium">{bot.label}</span>
      {bot.is_main && <StatusBadge info={{ label: '主 bot', tone: 'neutral' }} />}
    </span>
  )
}

function BotIdentity({ bot }: { bot: Bot }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-[12px] font-semibold text-primary">
        {bot.label.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <BotName bot={bot} />
        <div className="truncate text-[11.5px] text-muted-foreground">
          {bot.username ? `@${bot.username}` : `bot ${bot.bot_id}`}
        </div>
      </div>
    </div>
  )
}
