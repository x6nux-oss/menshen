// 名单管理：白名单 / 资料放行 / 联合封禁（全局 + 专属）/ 次级管理员。
import { useState } from 'react'
import { Button, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui'
import { useAdminMutation, useGbanMutation, useGbanOwnMutation, useWhitelistMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { filterRows, gbanKey, profileOKKey, whiteKey } from '../../lib/filters'
import { fmtTSFull, whiteSourceLabel } from '../../lib/format'
import { ChatRef, SearchField } from '../../components/mobile'
import { CardBlock, DataTable, PageHeader, Toolbar } from '../components'
import type { Column } from '../components'
import { useRunFeedback } from '../feedback'
import type { AdminRow, GbanRow, ProfileOKRow, WhiteRow } from '../../api/types'

type Seg = 'white' | 'profile' | 'gban' | 'admins'

export function ListsView({ section, main }: { section?: string; main: boolean }) {
  const state = useMiniState(true)
  const [seg, setSeg] = useState<Seg>(() => normalizeSeg(section, main))

  if (!state.data) return null
  const effective = main ? seg : 'gban'

  return (
    <>
      <PageHeader title="名单管理" subtitle="白名单、资料放行、联合封禁与次级管理员的集中入口" />
      {main ? (
        <Tabs value={effective} onValueChange={(v) => setSeg(v as Seg)}>
          <TabsList className="mb-4">
            <TabsTrigger value="white">白名单</TabsTrigger>
            <TabsTrigger value="profile">资料放行</TabsTrigger>
            <TabsTrigger value="gban">联合封禁</TabsTrigger>
            <TabsTrigger value="admins">次级管理员</TabsTrigger>
          </TabsList>
          <TabsContent value="white">
            <WhitelistSection />
          </TabsContent>
          <TabsContent value="profile">
            <ProfileSection />
          </TabsContent>
          <TabsContent value="gban">
            <GbanSection />
          </TabsContent>
          <TabsContent value="admins">
            <AdminsSection />
          </TabsContent>
        </Tabs>
      ) : (
        <GbanSection />
      )}
    </>
  )
}

function normalizeSeg(section: string | undefined, main: boolean): Seg {
  if (!main) return 'gban'
  if (section === 'white' || section === 'profile' || section === 'gban' || section === 'admins') return section
  return 'white'
}

function WhitelistSection() {
  const state = useMiniState(true)
  const run = useRunFeedback()
  const mut = useWhitelistMutation()
  const [q, setQ] = useState('')
  const [botId, setBotId] = useState(0)
  const [chatId, setChatId] = useState('0')
  const [userId, setUserId] = useState('')
  const [hours, setHours] = useState(24)

  if (!state.data) return null
  const { whitelist, bots, tz_name } = state.data
  const rows = filterRows(whitelist, q, whiteKey)
  const botLabel = (id: number) => (id === 0 ? '全平台' : (bots.find((b) => b.bot_id === id)?.label ?? `bot ${id}`))
  const scope = (row: WhiteRow) =>
    row.bot_id === 0 ? (
      <>全平台</>
    ) : row.chat_id === 0 ? (
      <>{`${botLabel(row.bot_id)} 下所有群`}</>
    ) : (
      <>
        {`${botLabel(row.bot_id)} · `}
        <ChatRef name={row.chat} url={row.chat_url} fallback={row.chat_id} />
      </>
    )

  const columns: Column<WhiteRow>[] = [
    { key: 'user', header: '用户', width: 120, render: (row) => `uid ${row.user_id}` },
    { key: 'scope', header: '范围', render: (row) => scope(row) },
    { key: 'source', header: '来源', width: 120, render: (row) => whiteSourceLabel(row.source) },
    { key: 'by', header: '操作人', width: 110, render: (row) => (row.by_uid ? `uid ${row.by_uid}` : '—') },
    {
      key: 'expires',
      header: '到期',
      width: 170,
      render: (row) => (row.expires_at > 0 ? fmtTSFull(row.expires_at, tz_name) : '永久'),
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={mut.isPending}
          onClick={() =>
            run(
              mut.mutateAsync({ action: 'remove', bot_id: row.bot_id, chat_id: row.chat_id, user_id: row.user_id }),
              '已移除',
            )
          }
        >
          移除
        </Button>
      ),
    },
  ]

  const valid = /^\d+$/.test(userId.trim()) && /^-?\d+$/.test(chatId.trim())

  return (
    <>
      <CardBlock title="加入白名单">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[180px] flex-col gap-1">
            <Label htmlFor="white-bot">机器人</Label>
            <Select value={String(botId)} onValueChange={(v) => setBotId(Number(v))}>
              <SelectTrigger id="white-bot" aria-label="机器人">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">全平台</SelectItem>
                {bots.map((b) => (
                  <SelectItem key={b.bot_id} value={String(b.bot_id)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-[220px] flex-col gap-1">
            <Label htmlFor="white-chat">chat id（0=该 bot 所有群）</Label>
            <Input id="white-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} />
          </div>
          <div className="flex w-[160px] flex-col gap-1">
            <Label htmlFor="white-user">用户 uid</Label>
            <Input id="white-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <div className="flex min-w-[130px] flex-col gap-1">
            <Label htmlFor="white-hours">时长</Label>
            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
              <SelectTrigger id="white-hours" aria-label="时长">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 小时</SelectItem>
                <SelectItem value="168">7 天</SelectItem>
                <SelectItem value="0">永久</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!valid || mut.isPending}
            onClick={() => {
              run(
                mut.mutateAsync({
                  action: 'add',
                  bot_id: botId,
                  chat_id: Number(chatId),
                  user_id: userId.trim(),
                  hours,
                }),
                '已加入白名单',
              )
              setUserId('')
            }}
          >
            加入
          </Button>
        </div>
      </CardBlock>

      <Toolbar>
        <SearchField value={q} onChange={setQ} placeholder="搜索用户 / 来源 / 范围" className="max-w-[320px]" />
      </Toolbar>
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.bot_id}:${row.chat_id}:${row.user_id}`}
        empty={<span className="text-[13px] text-muted-foreground">白名单为空。</span>}
        columns={columns}
      />
    </>
  )
}

function ProfileSection() {
  const state = useMiniState(true)
  const run = useRunFeedback()
  const mut = useWhitelistMutation()
  const [q, setQ] = useState('')
  if (!state.data) return null
  const { profile_ok, bots, tz_name } = state.data
  const botLabel = (id: number) => bots.find((b) => b.bot_id === id)?.label ?? `bot ${id}`
  const rows = filterRows(profile_ok, q, (row) => profileOKKey(row, botLabel))

  const columns: Column<ProfileOKRow>[] = [
    { key: 'user', header: '用户', width: 120, render: (row) => `uid ${row.user_id}` },
    { key: 'bot', header: '机器人', width: 160, render: (row) => botLabel(row.bot_id) },
    { key: 'hours', header: '放行时长', width: 100, render: (row) => `${row.hours} 小时` },
    { key: 'reason', header: '原因', render: (row) => row.reason || '—' },
    { key: 'expires', header: '到期', width: 170, render: (row) => fmtTSFull(row.expires_at, tz_name) },
    {
      key: 'actions',
      header: '',
      width: 90,
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={mut.isPending}
          onClick={() => run(mut.mutateAsync({ action: 'unprofile', bot_id: row.bot_id, user_id: row.user_id }), '已撤销')}
        >
          撤销
        </Button>
      ),
    },
  ]

  return (
    <>
      <Toolbar>
        <SearchField value={q} onChange={setQ} placeholder="搜索用户 / 机器人" className="max-w-[320px]" />
      </Toolbar>
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.bot_id}:${row.user_id}`}
        empty={<span className="text-[13px] text-muted-foreground">没有资料放行记录。</span>}
        columns={columns}
      />
    </>
  )
}

function GbanSection() {
  const state = useMiniState(true)
  const run = useRunFeedback()
  const gbanMut = useGbanMutation()
  const ownMut = useGbanOwnMutation()
  const [sub, setSub] = useState<'global' | 'own'>('global')
  const [q, setQ] = useState('')
  const [userId, setUserId] = useState('')
  const [reason, setReason] = useState('')

  if (!state.data) return null
  const { gban, gban_own, tz_name, chats, bots, me } = state.data
  const valid = /^\d+$/.test(userId.trim())
  const ownChatIDs = new Set(chats.filter((c) => bots.some((b) => b.bot_id === c.bot_id && (me.main || b.owner_id === me.uid))).map((c) => c.chat_id))

  const gbanColumns = (onRemove: (row: GbanRow) => void): Column<GbanRow>[] => [
    { key: 'user', header: '用户', width: 120, render: (row) => `uid ${row.user_id}` },
    { key: 'reason', header: '原因', render: (row) => row.reason || '—' },
    { key: 'at', header: '加入时间', width: 170, render: (row) => fmtTSFull(row.created_at, tz_name) },
    {
      key: 'actions',
      header: '',
      width: 80,
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onRemove(row)}
        >
          移除
        </Button>
      ),
    },
  ]

  const addForm = (
    <CardBlock title="加入联合封禁">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-[160px] flex-col gap-1">
          <Label htmlFor="gban-user">用户 uid</Label>
          <Input id="gban-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
        <div className="flex w-[280px] flex-col gap-1">
          <Label htmlFor="gban-reason">原因</Label>
          <Input id="gban-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button
          disabled={!valid || (sub === 'global' ? gbanMut.isPending : ownMut.isPending)}
          onClick={() => {
            const body = { action: 'add', user_id: userId.trim(), reason: reason.trim() }
            run(sub === 'global' ? gbanMut.mutateAsync(body) : ownMut.mutateAsync(body), '已加入联合封禁')
            setUserId('')
            setReason('')
          }}
        >
          加入{sub === 'global' ? '全局组' : '专属组'}
        </Button>
      </div>
    </CardBlock>
  )

  return (
    <>
      <Tabs value={sub} onValueChange={(v) => setSub(v as 'global' | 'own')}>
        <TabsList className="mb-4">
          <TabsTrigger value="global">全局组</TabsTrigger>
          <TabsTrigger value="own">专属组</TabsTrigger>
        </TabsList>
        <TabsContent value="global">
          {addForm}
          <Toolbar>
            <SearchField value={q} onChange={setQ} placeholder="搜索用户 / 原因" className="max-w-[320px]" />
          </Toolbar>
          <DataTable
            rows={filterRows(gban, q, gbanKey)}
            rowKey={(row) => row.user_id}
            empty={<span className="text-[13px] text-muted-foreground">全局联合封禁名单为空。</span>}
            columns={gbanColumns((row) =>
              run(gbanMut.mutateAsync({ action: 'remove', user_id: row.user_id }), '已移除'),
            )}
          />
        </TabsContent>
        <TabsContent value="own">
          <CardBlock
            title="专属组开关"
            actions={
              <Checkbox
                aria-label="启用专属组"
                checked={gban_own.enabled}
                onCheckedChange={(checked) => run(ownMut.mutateAsync({ action: 'enable', on: checked }), '已更新')}
              />
            }
          >
            <span className="text-[13px] leading-relaxed text-muted-foreground">
              专属组只在本归属人的机器人之间共享封禁；关闭后不生效。
            </span>
          </CardBlock>
          {addForm}
          <CardBlock title={`生效群组（${gban_own.chats.length}）`}>
            {chats.filter((c) => ownChatIDs.has(c.chat_id)).length === 0 ? (
              <span className="text-[13px] text-muted-foreground">你名下还没有群组。</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {chats
                  .filter((c) => ownChatIDs.has(c.chat_id))
                  .map((c) => {
                    const on = gban_own.chats.includes(c.chat_id)
                    return (
                      <Button
                        key={`${c.bot_id}:${c.chat_id}`}
                        size="sm"
                        variant={on ? 'default' : 'outline'}
                        onClick={() => run(ownMut.mutateAsync({ action: 'chat', chat_id: c.chat_id, on: !on }), '已更新')}
                      >
                        {c.title || c.chat_id}
                      </Button>
                    )
                  })}
              </div>
            )}
          </CardBlock>
          <Toolbar>
            <SearchField value={q} onChange={setQ} placeholder="搜索用户 / 原因" className="max-w-[320px]" />
          </Toolbar>
          <DataTable
            rows={filterRows(gban_own.bans, q, gbanKey)}
            rowKey={(row) => row.user_id}
            empty={<span className="text-[13px] text-muted-foreground">专属组名单为空。</span>}
            columns={gbanColumns((row) =>
              run(ownMut.mutateAsync({ action: 'remove', user_id: row.user_id }), '已移除'),
            )}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

function AdminsSection() {
  const state = useMiniState(true)
  const run = useRunFeedback()
  const mut = useAdminMutation()
  const [userId, setUserId] = useState('')
  const [note, setNote] = useState('')

  if (!state.data) return null
  const admins = state.data.admins ?? []
  const valid = /^\d+$/.test(userId.trim())

  const columns: Column<AdminRow>[] = [
    { key: 'user', header: '用户', width: 140, render: (row) => `uid ${row.user_id}` },
    { key: 'note', header: '备注', render: (row) => row.note || '—' },
    {
      key: 'actions',
      header: '',
      width: 80,
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={mut.isPending}
          onClick={() => run(mut.mutateAsync({ action: 'remove', user_id: row.user_id }), '已移除')}
        >
          移除
        </Button>
      ),
    },
  ]

  return (
    <>
      <CardBlock title="添加次级管理员">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-[160px] flex-col gap-1">
            <Label htmlFor="admin-user">用户 uid</Label>
            <Input id="admin-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <div className="flex w-[280px] flex-col gap-1">
            <Label htmlFor="admin-note">备注</Label>
            <Input id="admin-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            disabled={!valid || mut.isPending}
            onClick={() => {
              run(mut.mutateAsync({ action: 'add', user_id: userId.trim(), note: note.trim() }), '已添加')
              setUserId('')
              setNote('')
            }}
          >
            添加
          </Button>
        </div>
      </CardBlock>
      <DataTable
        rows={admins}
        rowKey={(row) => row.user_id}
        empty={<span className="text-[13px] text-muted-foreground">没有次级管理员。</span>}
        columns={columns}
      />
    </>
  )
}
