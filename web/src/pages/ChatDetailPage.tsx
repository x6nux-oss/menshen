// 群组详情：
// - 三个开关（启用/演练/群内展示）乐观更新失败回滚；
// - 处罚方式 Select + `实际执行` 行 + 防错提示（称呼语时长用 muteOptLabel）；
// - 补全历史入群时间（成功 toast 用服务端 note）；危险区移除该群。
import { FolderOpen } from 'lucide-react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { useChatMutation, useOptimisticMiniMutation } from '../api/mutations'
import type { Chat, State } from '../api/types'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { ChatRef, ListRow, SectionCard, SwitchRow } from '../components/mobile'
import { Button, Label, Spinner } from '../components/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { muteOptLabel, punishLabel, chatURL } from '../lib/format'
import { useNav } from '../nav'
import { useToast } from '../components/feedback'
import { useConfirm } from '../components/mobile'
import { ChatStatusBadge } from './shared'

export function ChatDetailPage({ botId, chatId }: { botId: number; chatId: number }) {
  const nav = useNav()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)

  const switchMut = useOptimisticMiniMutation('chat')
  const punishMut = useChatMutation()
  const backfillMut = useChatMutation()
  const removeMut = useChatMutation()

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const chat = state.data.chats.find((c) => c.bot_id === botId && c.chat_id === chatId)
  if (!chat) {
    return <EmptyState title="群不存在或无权管理" description="它可能已被移除，或机器人归属已改派。" />
  }

  const bot = state.data.bots.find((b) => b.bot_id === botId)
  const effectivePunish = punishLabel(
    state.data.bot_settings,
    state.data.global_defaults,
    botId,
    chat.punish,
  )

  const applyChat = (patch: Partial<Chat>) => {
    return (s: State): State => ({
      ...s,
      chats: s.chats.map((c) =>
        c.bot_id === botId && c.chat_id === chatId ? { ...c, ...patch } : c,
      ),
    })
  }

  const toggleField = (patch: Partial<Chat>) => {
    switchMut.mutate(
      {
        body: { action: 'update', bot_id: botId, chat_id: chatId, ...patch },
        apply: applyChat(patch),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? '已保存'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const changePunish = (next: number) => {
    punishMut.mutate(
      { action: 'update', bot_id: botId, chat_id: chatId, punish: next },
      {
        onSuccess: (resp) => toast(resp.note ?? '已保存'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const backfill = () => {
    backfillMut.mutate(
      { action: 'backfill', bot_id: botId, chat_id: chatId },
      {
        onSuccess: (resp) =>
          toast(resp.note ?? '已开始补全，结果会私聊发给管理员（大群可能要几分钟）'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const removeChat = async () => {
    const ok = await confirm({
      title: '移除该群？',
      description: `将从「${chat.title || chat.chat_id}」停止判定与处置，配置一并删除。此操作不可恢复。`,
      confirmText: '移除',
      danger: true,
    })
    if (!ok) return
    removeMut.mutate(
      { action: 'remove', bot_id: botId, chat_id: chatId },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已移除')
          nav.pop()
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <div data-testid="chat-detail-page">
      <SectionCard>
        <ListRow
          primary={
            <ChatRef name={chat.title || String(chat.chat_id)} url={chatURL(chat.username)} />
          }
          secondary={
            chat.username
              ? `@${chat.username} · ${bot ? bot.label : `bot ${botId}`}`
              : `chat_id ${chat.chat_id} · ${bot ? bot.label : `bot ${botId}`}`
          }
          badge={<ChatStatusBadge chat={chat} />}
        />
        <SwitchRow
          primary="启用判定"
          secondary="关闭后本群完全不再处理消息"
          checked={chat.enabled}
          disabled={switchMut.isPending}
          onChange={(next) => toggleField({ enabled: next })}
        />
        <SwitchRow
          primary="演练（只记不罚）"
          secondary="判定照常记录，但不实际禁言/封禁"
          checked={chat.dryrun}
          disabled={switchMut.isPending}
          onChange={(next) => toggleField({ dryrun: next })}
        />
        <SwitchRow
          primary="群内展示判定结果"
          secondary="命中时在群里回一条提示"
          checked={chat.group_alert}
          disabled={switchMut.isPending}
          onChange={(next) => toggleField({ group_alert: next })}
        />
      </SectionCard>

      <SectionCard title="处罚">
        <div className="px-4 pt-3">
          <Label htmlFor="chat-punish" className="mb-1 block">
            处罚方式
          </Label>
          <Select
            value={String(chat.punish)}
            onValueChange={(value) => changePunish(Number(value))}
            disabled={punishMut.isPending}
          >
            <SelectTrigger id="chat-punish" aria-label="处罚方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="-1">跟随 bot 设置</SelectItem>
              <SelectItem value="0">
                {muteOptLabel(state.data.bot_settings, state.data.global_defaults, botId)}
              </SelectItem>
              <SelectItem value="1">封禁出群（永久）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ListRow
          primary="实际执行"
          value={<span data-testid="effective-punish">{effectivePunish}</span>}
        />
        {effectivePunish.startsWith('禁言') && (
          <p className="px-4 pb-3 text-[13px] leading-[1.6] text-muted-foreground">
            要改成永久禁言：把本 bot 的「禁言时长（分钟）」设为 0；要踢出群就选「封禁出群」。
          </p>
        )}
      </SectionCard>

      <SectionCard title="工具">
        <div className="px-4 py-3">
          <Button
            variant="outline"
            className="w-full"
            disabled={backfillMut.isPending}
            onClick={backfill}
          >
            {backfillMut.isPending ? <Spinner /> : <FolderOpen aria-hidden />}
            补全历史入群时间
          </Button>
          <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
            Bot API 没有入群时间字段，这里用该 bot 的 token 走 MTProto 把「入群时就在群里」的那批成员补上（只填未知的，不覆盖实时记录）。新入群一直是自动记的。
          </p>
        </div>
      </SectionCard>

      <SectionCard title="危险区">
        <ListRow
          primary="移除该群"
          secondary="判定与处置立即停止，配置一并删除"
          disabled={removeMut.isPending}
          onClick={() => void removeChat()}
          className="text-destructive"
        />
      </SectionCard>
    </div>
  )
}
