// 群组列表：搜索、按 bot 过滤、批量启停/演练/处罚、添加群组。
import { useState } from 'react'
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui'
import { useChatMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { filterRows } from '../../lib/filters'
import { punishLabel, chatURL } from '../../lib/format'
import { toggleChatSelection } from '../../lib/selection'
import { chatStatus } from '../../lib/status'
import { ChatRef, SearchField } from '../../components/mobile'
import { useToast } from '../../components/feedback'
import { ConfirmButton, DataTable, PageHeader, StatusBadge, Toolbar } from '../components'
import type { Column } from '../components'
import { useRunFeedback } from '../feedback'
import { useAdminNav } from '../nav'
import type { Chat } from '../../api/types'

const sameChat = (a: Chat, b: Chat) => a.bot_id === b.bot_id && a.chat_id === b.chat_id
/** ALL_BOTS 是「全部机器人」在下拉里的哨兵值（Base UI Select 用 null 表示未选中，空串会被当成没选）。 */
const ALL_BOTS = '__all__'

export function ChatsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const run = useRunFeedback()
  const toast = useToast()
  const chatMut = useChatMutation()

  const [q, setQ] = useState('')
  const [botFilter, setBotFilter] = useState<number | 'all'>('all')
  const [batch, setBatch] = useState(false)
  const [selected, setSelected] = useState<Chat[]>([])
  const [addOpen, setAddOpen] = useState(false)

  if (!state.data) return null
  const { chats, bots, bot_settings, global_defaults } = state.data
  const botLabel = (botId: number) => bots.find((b) => b.bot_id === botId)?.label ?? `bot ${botId}`

  const rows = filterRows(chats, q, (c) => `${c.title} ${c.chat_id} ${botLabel(c.bot_id)}`).filter(
    (c) => botFilter === 'all' || c.bot_id === botFilter,
  )

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
    run(
      chatMut.mutateAsync({
        action: 'bulk_update',
        bot_id: first.bot_id,
        chat_ids: selected.map((c) => c.chat_id),
        fields,
      }),
      okText,
    )
    setSelected([])
    setBatch(false)
  }

  const columns: Column<Chat>[] = []
  if (batch) {
    columns.push({
      key: 'pick',
      header: '',
      width: 48,
      render: (row) => (
        <Checkbox
          checked={selected.some((c) => sameChat(c, row))}
          onCheckedChange={() => toggle(row)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`选择 ${row.title || row.chat_id}`}
        />
      ),
    })
  }
  columns.push(
    { key: 'title', header: '群组', render: (row) => <ChatRef name={row.title || row.chat_id} url={chatURL(row.username)} /> },
    { key: 'bot', header: '机器人', width: 180, render: (row) => botLabel(row.bot_id) },
    { key: 'status', header: '状态', width: 96, render: (row) => <StatusBadge info={chatStatus(row)} /> },
    {
      key: 'punish',
      header: '处罚',
      width: 160,
      render: (row) => punishLabel(bot_settings, global_defaults, row.bot_id, row.punish),
    },
    { key: 'chatId', header: 'chat id', width: 140, render: (row) => row.chat_id },
    {
      key: 'actions',
      header: '',
      width: 90,
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
            run(chatMut.mutateAsync({ action: 'remove', bot_id: row.bot_id, chat_id: row.chat_id }), '已移除')
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
        subtitle={`共 ${chats.length} 个；批量操作一次最多 100 个且需属于同一机器人`}
        actions={
          <>
            <Button
              variant={batch ? 'default' : 'outline'}
              onClick={() => {
                setBatch(!batch)
                setSelected([])
              }}
            >
              {batch ? '退出批量' : '批量操作'}
            </Button>
            <Button onClick={() => setAddOpen(true)}>＋ 添加群组</Button>
          </>
        }
      />
      <Toolbar>
        <SearchField value={q} onChange={setQ} placeholder="搜索群名 / chat id" className="max-w-[320px]" />
        <div className="flex min-w-[200px] flex-col gap-1">
          <Label htmlFor="chats-bot">机器人</Label>
          <Select
            value={botFilter === 'all' ? ALL_BOTS : String(botFilter)}
            onValueChange={(v) => setBotFilter(v === ALL_BOTS ? 'all' : Number(v))}
          >
            <SelectTrigger id="chats-bot" aria-label="机器人">
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
        </div>
      </Toolbar>

      {batch && selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px]">已选 {selected.length} 个：</span>
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
          <Button size="sm" variant="outline" onClick={() => bulk({ punish: -1 }, '处罚改为跟随机器人')}>
            处罚：跟随
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk({ punish: 0 }, '处罚改为禁言')}>
            处罚：禁言
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk({ punish: 1 }, '处罚改为封禁')}>
            处罚：封禁
          </Button>
        </div>
      )}

      <DataTable
        rows={rows}
        rowKey={(row) => `${row.bot_id}:${row.chat_id}`}
        onRowClick={batch ? undefined : (row) => nav.go({ k: 'chat', botId: row.bot_id, chatId: row.chat_id })}
        empty={<span className="text-[13px] text-muted-foreground">没有匹配的群组。</span>}
        columns={columns}
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
