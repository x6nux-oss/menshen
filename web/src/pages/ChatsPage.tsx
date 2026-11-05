// 群组列表：本地搜索 + intent 过滤条 + 添加群抽屉 +
// `管理` 批量模式（一次只允许同一 bot，底部操作条走 chat.bulk_update）。
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { useChatMutation } from '../api/mutations'
import type { Bot, Chat } from '../api/types'
import { EmptyState, ErrorState, Skeletons, useToast } from '../components/feedback'
import {
  ChatRef,
  FormDrawer,
  ListRow,
  SearchField,
  SectionCard,
} from '../components/mobile'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui'
import { filterRows } from '../lib/filters'
import { chatURL, muteOptLabel } from '../lib/format'
import { BULK_CHAT_LIMIT, toggleChatSelection } from '../lib/selection'
import { useNav, usePageParam } from '../nav'
import { ChatStatusBadge } from './shared'

function chatKey(c: Pick<Chat, 'bot_id' | 'chat_id'>): string {
  return `${c.bot_id}:${c.chat_id}`
}

/** applyIntent 把 nav.intent 翻译成群组过滤：dryrun=演练中的群，bot:<id>=该 bot 的群。 */
function applyIntent(chats: Chat[], intent: string | null): Chat[] {
  if (intent === 'dryrun') return chats.filter((c) => c.dryrun)
  if (intent?.startsWith('bot:')) {
    const botID = Number(intent.slice(4))
    return chats.filter((c) => c.bot_id === botID)
  }
  return chats
}

/** botLabelOf 按 bot_id 找展示名，找不到回退 bot <id>。 */
function botLabelOf(bots: Bot[], botID: number): string {
  return bots.find((b) => b.bot_id === botID)?.label ?? `bot ${botID}`
}

/** 批量操作条未测到高度前的兜底预留（窄屏换行时约 135px，取 140 更稳）。 */
const BATCH_BAR_MIN_RESERVE = 140

/** 批量操作条的紧凑按钮：全局 Button 默认 h-9，这里压回 32 让五个按钮一屏放下。 */
const BULK_BUTTON = 'h-8 min-w-0 px-1.25 text-[13px]'

export function ChatsPage({ bulkLimit = BULK_CHAT_LIMIT }: { bulkLimit?: number } = {}) {
  const nav = useNav()
  const toast = useToast()
  const state = useMiniState(true)
  const addMut = useChatMutation()
  const bulkMut = useChatMutation()

  const [q, setQ] = usePageParam('q')
  const [batch, setBatch] = useState(false)
  const [selected, setSelected] = useState<Chat[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addBotID, setAddBotID] = useState(0)
  const [addChatID, setAddChatID] = useState('')
  const [punishOpen, setPunishOpen] = useState(false)

  // 批量操作条实测高度：窄屏按钮换行时动态给列表留出底部空间，避免压住最后一行。
  // ResizeObserver 首次 observe 会立即回调一次；没有 RO 的环境用兜底预留值。
  const barRef = useRef<HTMLDivElement | null>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    if (!batch) return
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0
      if (h > 0) setBarHeight(h)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [batch])

  const intent = nav.intent
  const filterSignature = `${intent ?? ''}|${q.trim().toLowerCase()}`
  const data = state.data
  const [prunedFor, setPrunedFor] = useState<string | null>(null)

  // 过滤条件（搜索词/意图）变化时清理不可见的选中项，避免误改被藏起来的群。
  // 用渲染期调整状态的官方模式：不引入 effect 的额外一轮渲染。
  if (data && prunedFor !== filterSignature) {
    setPrunedFor(filterSignature)
    const keys = new Set(
      filterRows(applyIntent(data.chats, intent), q, (c) =>
        `${c.title} ${c.chat_id} ${botLabelOf(data.bots, c.bot_id)}`,
      ).map(chatKey),
    )
    setSelected((prev) => {
      const kept = prev.filter((c) => keys.has(chatKey(c)))
      return kept.length === prev.length ? prev : kept
    })
  }

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const { chats, bots } = state.data
  const botLabel = (botID: number) => botLabelOf(bots, botID)

  let intentLabel = ''
  if (intent === 'dryrun') intentLabel = '演练中的群'
  else if (intent?.startsWith('bot:')) intentLabel = `${botLabel(Number(intent.slice(4)))} 的群`
  const intentChats = applyIntent(chats, intent)
  const visible = filterRows(intentChats, q, (c) => `${c.title} ${c.chat_id} ${botLabel(c.bot_id)}`)
  const reserved = batch ? Math.max(barHeight, BATCH_BAR_MIN_RESERVE) : 0

  function openAdd() {
    setAddBotID(bots[0]?.bot_id ?? 0)
    setAddChatID('')
    setAddOpen(true)
  }

  function submitAdd() {
    addMut.mutate(
      { bot_id: addBotID, chat_id: addChatID.trim(), action: 'add' },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已添加（默认演练）')
          setAddOpen(false)
          setAddChatID('')
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggleSelect(chat: Chat) {
    const outcome = toggleChatSelection(
      selected,
      chat,
      (a, b) => chatKey(a) === chatKey(b),
      (c) => c.bot_id,
      bulkLimit,
    )
    if (outcome.rejected === 'bot') {
      toast('一次只能批量管理同一个机器人的群，请先取消已选中的群')
      return
    }
    if (outcome.rejected === 'limit') {
      toast(`一次最多批量管理 ${bulkLimit} 个群`)
      return
    }
    setSelected(outcome.selected)
  }

  function exitBatch() {
    setBatch(false)
    setSelected([])
  }

  function bulkUpdate(fields: Record<string, unknown>) {
    if (selected.length === 0) return
    bulkMut.mutate(
      {
        action: 'bulk_update',
        bot_id: selected[0].bot_id,
        chat_ids: selected.map((c) => c.chat_id),
        fields,
      },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已更新')
          exitBatch()
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  const punishOptions = [
    { value: '-1', label: '跟随 bot 设置' },
    {
      value: '0',
      label: `当前禁言档（${selected.length > 0 ? muteOptLabel(state.data.bot_settings, state.data.global_defaults, selected[0].bot_id) : '—'}）`,
    },
    { value: '1', label: '封禁出群（永久）' },
  ]

  return (
    <div
      data-testid="chats-page"
      data-reserved={reserved}
      // Shell 已为 TabBar 留了 72px；这里补批量操作条实测高度（未测到时用兜底值）。
      style={{
        paddingBottom: batch ? `calc(${reserved}px + env(safe-area-inset-bottom))` : undefined,
      }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索群名 / chat_id / 机器人"
          ariaLabel="搜索群组"
          className="flex-1"
        />
        <Button size="sm" variant="secondary" onClick={() => (batch ? exitBatch() : setBatch(true))}>
          {batch ? '取消' : '管理'}
        </Button>
        {!batch && (
          <Button size="icon" variant="ghost" aria-label="添加群" onClick={openAdd}>
            <Plus aria-hidden />
          </Button>
        )}
      </div>

      {intentLabel && (
        <div className="mb-2 flex items-center gap-1">
          <Badge tone="neutral">只看：{intentLabel}</Badge>
          <Button
            size="icon"
            variant="ghost"
            aria-label="清除筛选"
            className="size-8"
            onClick={() => nav.switchTab('chats')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        chats.length === 0 ? (
          <EmptyState
            title="还没有接入群组"
            description="点右上角「＋」添加：把这个 bot 拉进群后填群 ID，添加后默认演练。"
            action={
              <Button onClick={openAdd}>添加群</Button>
            }
          />
        ) : (
          <EmptyState title="没有匹配的群" description="换个关键词，或清除筛选后重试。" />
        )
      ) : (
        <SectionCard>
          {visible.map((chat) => {
            const picked = selected.some((c) => chatKey(c) === chatKey(chat))
            return (
              <ListRow
                key={chatKey(chat)}
                primary={
                  <ChatRef name={chat.title || String(chat.chat_id)} url={chatURL(chat.username)} />
                }
                secondary={
                  chat.username
                    ? `@${chat.username} · ${botLabel(chat.bot_id)}`
                    : `${chat.chat_id} · ${botLabel(chat.bot_id)}`
                }
                badge={<ChatStatusBadge chat={chat} />}
                chevron={!batch}
                onClick={() =>
                  batch
                    ? toggleSelect(chat)
                    : nav.push({ k: 'chat', botId: chat.bot_id, chatId: chat.chat_id })
                }
                trailing={
                  batch ? (
                    <Checkbox
                      checked={picked}
                      aria-label={`选择 ${chat.title || chat.chat_id}`}
                      onCheckedChange={() => toggleSelect(chat)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : undefined
                }
              />
            )
          })}
        </SectionCard>
      )}

      {batch && (
        <div
          ref={barRef}
          data-testid="batch-bar"
          className="fixed inset-x-0 z-20 border-t border-border bg-card px-2 py-2"
          // TabBar 是 z-30、高 56px（含安全区），这里贴在它上面。
          style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}
        >
          <p className="mb-1.5 text-center text-[12px] text-muted-foreground">
            已选 {selected.length} 个群
            {selected.length > 0 ? ` · ${botLabel(selected[0].bot_id)}` : ''}
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className={BULK_BUTTON}
              disabled={selected.length === 0 || bulkMut.isPending}
              onClick={() => bulkUpdate({ enabled: true })}
            >
              启用
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={BULK_BUTTON}
              disabled={selected.length === 0 || bulkMut.isPending}
              onClick={() => bulkUpdate({ enabled: false })}
            >
              停用
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={BULK_BUTTON}
              disabled={selected.length === 0 || bulkMut.isPending}
              onClick={() => bulkUpdate({ dryrun: true })}
            >
              开启演练
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={BULK_BUTTON}
              disabled={selected.length === 0 || bulkMut.isPending}
              onClick={() => bulkUpdate({ dryrun: false })}
            >
              关闭演练
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={BULK_BUTTON}
              disabled={selected.length === 0 || bulkMut.isPending}
              onClick={() => setPunishOpen(true)}
            >
              处罚方式
            </Button>
          </div>
        </div>
      )}

      <FormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加群"
        pending={addMut.isPending}
        submitText="添加"
        submitDisabled={addBotID === 0 || addChatID.trim() === ''}
        onSubmit={submitAdd}
      >
        <Label htmlFor="add-bot" className="mb-1 block">
          机器人
        </Label>
        <Select
          value={String(addBotID)}
          onValueChange={(value) => setAddBotID(Number(value))}
        >
          <SelectTrigger id="add-bot" aria-label="机器人">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bots.map((bot) => (
              <SelectItem key={bot.bot_id} value={String(bot.bot_id)}>
                {bot.label} · {bot.bot_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="add-chat-id" className="mt-3 mb-1 block">
          群 ID
        </Label>
        <Input
          id="add-chat-id"
          inputMode="numeric"
          placeholder="-1001234567890"
          value={addChatID}
          onChange={(event) => setAddChatID(event.target.value)}
        />
        <p className="mt-1 text-[12px] leading-[1.6] text-muted-foreground">
          以 -100 开头的群 ID；先把机器人拉进群再加。
        </p>
        <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
          添加后默认「演练」：只记录判定结果、不处罚，确认无误后再关闭演练。
        </p>
      </FormDrawer>

      <FormDrawer open={punishOpen} onClose={() => setPunishOpen(false)} title="批量设置处罚方式">
        <p className="mb-1 text-[13px] text-muted-foreground">
          将对已选的 {selected.length} 个群生效。
        </p>
        {punishOptions.map((option) => (
          <ListRow
            key={option.value}
            primary={option.label}
            chevron
            onClick={() => {
              setPunishOpen(false)
              bulkUpdate({ punish: Number(option.value) })
            }}
          />
        ))}
      </FormDrawer>
    </div>
  )
}
