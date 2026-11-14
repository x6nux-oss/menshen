// 群组列表：状态快捷筛选、按 bot 过滤、行内多选、批量操作与添加群组。
import { useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui'
import { useChatMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { ApiError } from '../../api/client'
import { filterRows } from '../../lib/filters'
import { punishLabel, chatURL } from '../../lib/format'
import { toggleChatSelection } from '../../lib/selection'
import { chatStatus } from '../../lib/status'
import { ChatRef, SearchField } from '../../components/mobile'
import { useToast } from '../../components/feedback'
import { ConfirmButton, PageHeader, StatusBadge } from '../components'
import { DataTable } from '../data-table'
import type { Column } from '../components'
import { useRunFeedback } from '../feedback'
import { useAdminNav } from '../nav'
import type { Chat } from '../../api/types'
import { FilterChips, FilterField } from './list-tools'
import { useSearchHotkey } from './use-search-hotkey'
import { choiceParam, intParam, textParam, useUrlFilter } from './use-url-filters'

const sameChat = (a: Chat, b: Chat) => a.bot_id === b.bot_id && a.chat_id === b.chat_id
/** ALL_BOTS 是「全部机器人」在下拉里的哨兵值（Base UI Select 用 null 表示未选中，空串会被当成没选）。 */
const ALL_BOTS = '__all__'
const CHAT_STATES = ['all', 'active', 'dryrun', 'disabled', 'alert'] as const
type ChatState = (typeof CHAT_STATES)[number]
const CHAT_STATE_PARAM = choiceParam(CHAT_STATES)
const SEARCH_PARAM = textParam()
const BOT_FILTER_PARAM = intParam(0)

function matchesState(chat: Chat, state: ChatState): boolean {
  if (state === 'all') return true
  if (state === 'active') return chat.enabled && !chat.dryrun
  if (state === 'dryrun') return chat.dryrun
  if (state === 'disabled') return !chat.enabled
  return chat.group_alert
}

export function ChatsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const run = useRunFeedback()
  const toast = useToast()
  const chatMut = useChatMutation()

  const [q, setQ] = useUrlFilter('q', '', SEARCH_PARAM)
  const [chatState, setChatState] = useUrlFilter('state', 'all', CHAT_STATE_PARAM)
  const [botFilter, setBotFilter] = useUrlFilter('bot_filter', 0, BOT_FILTER_PARAM)
  const [batch, setBatch] = useState(false)
  const [selected, setSelected] = useState<Chat[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const searchRef = useSearchHotkey<HTMLDivElement>()

  if (!state.data) return null
  const { chats, bots, bot_settings, global_defaults } = state.data
  const botLabel = (botId: number) => bots.find((b) => b.bot_id === botId)?.label ?? `bot ${botId}`

  const scoped = chats.filter((c) => botFilter === 0 || c.bot_id === botFilter)
  const rows = filterRows(scoped, q, (c) => `${c.title} ${c.chat_id} ${botLabel(c.bot_id)}`).filter(
    (c) => matchesState(c, chatState),
  )
  const counts: Record<ChatState, number> = {
    all: scoped.length,
    active: scoped.filter((c) => c.enabled && !c.dryrun).length,
    dryrun: scoped.filter((c) => c.dryrun).length,
    disabled: scoped.filter((c) => !c.enabled).length,
    alert: scoped.filter((c) => c.group_alert).length,
  }
  const selectedBot = selected[0] ? botLabel(selected[0].bot_id) : ''

  function toggle(row: Chat) {
    const outcome = toggleChatSelection(selected, row, sameChat, (c) => c.bot_id)
    if (outcome.rejected === 'bot') {
      toast('一次只能批量操作同一个机器人的群组')
      return
    }
    if (outcome.rejected === 'limit') {
      toast('一次最多选择 100 个群组')
      return
    }
    setSelected(outcome.selected)
  }

  function bulk(fields: Record<string, unknown>, okText: string) {
    const first = selected[0]
    if (!first) return
    const pending = selected
    chatMut
      .mutateAsync({
        action: 'bulk_update',
        bot_id: first.bot_id,
        chat_ids: pending.map((c) => c.chat_id),
        fields,
      })
      .then((resp) => {
        toast(resp.note || okText)
        setSelected([])
        setBatch(false)
      })
      .catch((err: unknown) => {
        const detail = err instanceof ApiError ? err.message : '操作失败，请重试'
        toast(`批量操作失败：部分更新可能已生效，请核对后重试（${detail}）`)
        setSelected(pending)
        void state.refetch()
      })
  }

  function exitBatch() {
    setBatch(false)
    setSelected([])
  }

  const columns: Column<Chat>[] = []
  if (batch) {
    const allSelected =
      rows.length > 0 && rows.every((row) => selected.some((c) => sameChat(c, row)))
    columns.push({
      key: 'pick',
      header: (
        <Checkbox
          checked={allSelected}
          aria-label={allSelected ? '取消全选当前结果' : '全选当前结果'}
          onCheckedChange={(checked) =>
            setSelected(checked ? selectable(rows, selected) : [])
          }
        />
      ),
      width: 44,
      render: (row) => {
        const checked = selected.some((c) => sameChat(c, row))
        const locked = selected.length > 0 && selected[0].bot_id !== row.bot_id
        return (
          <Checkbox
            checked={checked}
            disabled={locked}
            onCheckedChange={() => toggle(row)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`选择 ${row.title || row.chat_id}`}
          />
        )
      },
    })
  }
  columns.push(
    {
      key: 'title',
      header: '群组',
      render: (row) => <ChatIdentity chat={row} />,
    },
    {
      key: 'bot',
      header: '机器人',
      width: 170,
      render: (row) => (
        <span className="text-[13px] text-muted-foreground">{botLabel(row.bot_id)}</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: 100,
      render: (row) => <StatusBadge info={chatStatus(row)} />,
    },
    {
      key: 'policy',
      header: '处置 / 告警',
      width: 200,
      render: (row) => (
        <div className="flex flex-col gap-0.5 text-[12.5px]">
          <span>{punishLabel(bot_settings, global_defaults, row.bot_id, row.punish)}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {row.group_alert ? '群内展示开' : '群内展示关'}
          </span>
        </div>
      ),
    },
    {
      key: 'chatId',
      header: 'chat id',
      width: 150,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {row.chat_id}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      render: (row) => (
        <ConfirmButton
          size="small"
          color="error"
          variant="text"
          title="移除群组"
          description={`确认移除「${row.title || row.chat_id}」？移除后该群不再判定。`}
          confirmLabel="移除"
          danger
          onConfirm={() =>
            run(
              chatMut.mutateAsync({
                action: 'remove',
                bot_id: row.bot_id,
                chat_id: row.chat_id,
              }),
              '已移除',
            )
          }
        >
          移除
        </ConfirmButton>
      ),
    },
  )

  return (
    <>
      <PageHeader
        title="群组"
        subtitle={`${chats.length} 个群 · 批量操作一次最多 100 个，且需属于同一机器人`}
        actions={
          <>
            <Button variant={batch ? 'default' : 'outline'} onClick={batch ? exitBatch : () => setBatch(true)}>
              {batch ? '退出批量' : '批量操作'}
            </Button>
            <Button onClick={() => setAddOpen(true)}>＋ 添加群组</Button>
          </>
        }
      />

      {batch && selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/25 bg-primary/[0.045] px-3 py-2.5">
          <div className="mr-1">
            <p className="text-[13px] font-medium">
              已选 {selected.length} 个
              <span className="ml-1 font-normal text-muted-foreground">· {selectedBot}</span>
            </p>
            <p className="text-[11.5px] text-muted-foreground">操作立即生效；不同机器人的行已锁定</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => bulk({ enabled: true }, '已启用')}>
              启用
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk({ enabled: false }, '已停用')}>
              停用
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk({ dryrun: true }, '已进入演练')}>
              开启演练
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk({ dryrun: false }, '已退出演练')}>
              关闭演练
            </Button>
            <span className="mx-1 h-6 w-px self-center bg-border" aria-hidden />
            <Button size="sm" variant="ghost" onClick={() => bulk({ punish: -1 }, '处罚改为跟随机器人')}>
              处罚跟随
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulk({ punish: 0 }, '处罚改为禁言')}>
              禁言
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulk({ punish: 1 }, '处罚改为封禁')}>
              封禁
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={exitBatch}>
            取消
          </Button>
        </div>
      )}

      <DataTable
        rows={rows}
        rowKey={(row) => `${row.bot_id}:${row.chat_id}`}
        onRowClick={batch ? undefined : (row) => nav.go({ k: 'chat', botId: row.bot_id, chatId: row.chat_id })}
        empty={
          <span className="text-[13px] text-muted-foreground">
            {chatState !== 'all' || q || botFilter !== 0 ? '没有匹配的群组，试试放宽筛选。' : '还没有添加群组。'}
          </span>
        }
        columns={columns}
        toolbar={
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div ref={searchRef} className="w-full max-w-[280px] pb-px">
              <SearchField value={q} onChange={setQ} placeholder="搜索群名 / chat id" />
            </div>
            <FilterField label="机器人">
              <Select
                value={botFilter === 0 ? ALL_BOTS : String(botFilter)}
                onValueChange={(v) => {
                  setBotFilter(v === ALL_BOTS ? 0 : Number(v))
                  setSelected([])
                }}
              >
                <SelectTrigger aria-label="机器人">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BOTS}>全部机器人</SelectItem>
                  {bots.map((b) => (
                    <SelectItem key={b.bot_id} value={String(b.bot_id)}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterChips
              className="pb-0.5"
              ariaLabel="按群组状态筛选"
              value={chatState}
              onChange={setChatState}
              options={[
                { value: 'all', label: '全部', count: counts.all },
                { value: 'active', label: '判定中', count: counts.active },
                { value: 'dryrun', label: '演练', count: counts.dryrun },
                { value: 'disabled', label: '停用', count: counts.disabled },
                { value: 'alert', label: '群内展示', count: counts.alert },
              ]}
            />
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>
              显示 {rows.length} / {scoped.length} 个
              {botFilter !== 0 && `（${botLabel(botFilter)}）`}
            </span>
            <span>
              {batch ? '勾选行以批量操作 · 不同机器人不可混选' : '点击行进入群组设置'}
            </span>
          </div>
        }
      />

      <AddChatDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        bots={bots.map((b) => ({ id: b.bot_id, label: b.label }))}
        onSubmit={(botId, chatId) =>
          run(chatMut.mutateAsync({ action: 'add', bot_id: botId, chat_id: chatId }), '已添加')
        }
      />
    </>
  )
}

/** selectable 把当前页并入选择：保留原有顺序，受同 bot / 100 上限约束。 */
function selectable(rows: Chat[], selected: Chat[]): Chat[] {
  let next = selected
  for (const row of rows) {
    if (next.some((entry) => sameChat(entry, row))) continue
    const outcome = toggleChatSelection(next, row, sameChat, (c) => c.bot_id)
    if (outcome.rejected) break
    next = outcome.selected
  }
  return next
}

function ChatIdentity({ chat }: { chat: Chat }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13.5px] font-medium">
        <ChatRef name={chat.title || chat.chat_id} url={chatURL(chat.username)} />
      </div>
      <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
        <span className="font-mono tabular-nums">{chat.chat_id}</span>
        {chat.group_alert && <span>· 群内展示</span>}
      </div>
    </div>
  )
}

function AddChatDialog({
  open,
  onClose,
  bots,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  bots: { id: number; label: string }[]
  onSubmit: (botId: number, chatId: string) => void
}) {
  const [botId, setBotId] = useState<number>(bots[0]?.id ?? 0)
  const [chatId, setChatId] = useState('')
  const valid = /^-?\d+$/.test(chatId.trim()) && botId !== 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加群组</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="addchat-bot">机器人</Label>
            <Select value={String(botId)} onValueChange={(v) => setBotId(Number(v))}>
              <SelectTrigger id="addchat-bot" aria-label="机器人">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bots.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addchat-chatid">群组 chat id</Label>
            <Input
              id="addchat-chatid"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
            />
            <span className="text-[12px] text-muted-foreground">
              群/频道 id，形如 -100…；新加的群默认先进入演练
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onSubmit(botId, chatId.trim())
              setChatId('')
              onClose()
            }}
          >
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
