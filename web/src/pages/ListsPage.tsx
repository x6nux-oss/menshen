// 名单管理：
// - 主管理员：白名单 / 资料放行 / 联合封禁 / 次级管理员 四个分段；
//   次级管理员只显示联合封禁一个分段，服务端仍是唯一裁决方。
// - 四处本地搜索（白名单 / 资料放行 / 全局组 / 专属组）全部受控：输入即时过滤，
//   不整页重建、焦点不丢。
// - 顶部新增按钮按当前分段打开抽屉：白名单 / 全局组 / 专属组 / 管理员。
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import {
  useAdminMutation,
  useGbanMutation,
  useGbanOwnMutation,
  useOptimisticMiniMutation,
  useWhitelistMutation,
} from '../api/mutations'
import type { AdminRow, Bot, Chat, GbanRow, ProfileOKRow, State, WhiteRow } from '../api/types'
import { ErrorState, Skeletons, useToast } from '../components/feedback'
import {
  ChatRef,
  FormDrawer,
  ListRow,
  SearchField,
  SectionCard,
  Segmented,
  SwitchRow,
  useConfirm,
} from '../components/mobile'
import { Badge } from '../components/ui'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { filterRows, gbanKey, profileOKKey, whiteKey } from '../lib/filters'
import { displayTz, fmtTS, meLabel, whiteSourceLabel } from '../lib/format'
import { usePageParam } from '../nav'

const MAIN_SECTIONS = ['white', 'profile', 'gban', 'admins'] as const
type MainSection = (typeof MAIN_SECTIONS)[number]

function isMainSection(value: string | undefined): value is MainSection {
  return value !== undefined && (MAIN_SECTIONS as readonly string[]).includes(value)
}

/** botLabelOf 按 bot_id 找展示名，找不到回退 bot <id>（与群组页同口径）。 */
function botLabelOf(bots: Bot[], botID: number): string {
  return bots.find((b) => b.bot_id === botID)?.label ?? `bot ${botID}`
}

/** ScopeText 白名单范围：全平台 / bot 所有群 / 群（公开群带 t.me 链接）。 */
function ScopeText({ w }: { w: Pick<WhiteRow, 'bot_id' | 'chat_id' | 'chat' | 'chat_url'> }) {
  if (w.bot_id === 0) return <>全平台</>
  if (w.chat_id === 0) return <>bot 所有群</>
  return (
    <>
      群 <ChatRef name={w.chat} url={w.chat_url} fallback={w.chat_id} />
    </>
  )
}

/** countText 搜索计数：无过滤时输出 `共 N 人`，过滤时输出 `匹配 M / 共 N 人`。 */
function countText(shown: number, total: number): string {
  return shown === total ? `共 ${total} 人` : `匹配 ${shown} / 共 ${total} 人`
}

/** ownChats 名下 bot 覆盖的群（专属组的生效群只能从这里圈）。 */
function ownChats(state: State): Chat[] {
  const owned = new Set(
    state.bots.filter((b) => b.owner_id === state.me.uid).map((b) => b.bot_id),
  )
  return state.chats.filter((c) => owned.has(c.bot_id))
}

/** SearchCount 搜索框下方那行 `共 N 人` / `匹配 M / 共 N 人`。 */
function SearchCount({ shown, total }: { shown: number; total: number }) {
  return <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">{countText(shown, total)}</p>
}

/** Hint 是卡片内的一段说明文字。 */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pt-3 text-[13px] leading-[1.6] text-muted-foreground">{children}</p>
}

/** EmptyLine 是列表为空时的一行灰字。 */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-3 text-[13px] text-muted-foreground">{children}</p>
}

/** FieldLabel 抽屉里的字段标签（与 Input/Select 用 id 关联）。 */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="mt-3 mb-1 block first:mt-0">
      {children}
    </Label>
  )
}

export function ListsPage({ section }: { section?: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)

  const whiteMut = useWhitelistMutation()
  const gbanMut = useGbanMutation()
  const ownMut = useOptimisticMiniMutation('gbanown')
  const ownListMut = useGbanOwnMutation()
  const adminMut = useAdminMutation()

  // 分段与各段搜索词都进 URL：刷新/深链后回到同一分段与筛选。
  const [seg, setSeg] = usePageParam<MainSection>(
    'seg',
    isMainSection(section) ? section : 'white',
    MAIN_SECTIONS,
  )
  const [gbanSub, setGbanSub] = usePageParam<'global' | 'own'>('sub', 'global', ['global', 'own'])

  const [whiteQ, setWhiteQ] = usePageParam('wq')
  const [profileQ, setProfileQ] = usePageParam('pq')
  const [gbanQ, setGbanQ] = usePageParam('gq')
  const [ownQ, setOwnQ] = usePageParam('oq')

  // 白名单添加
  const [whiteOpen, setWhiteOpen] = useState(false)
  const [whiteBot, setWhiteBot] = useState(0)
  const [whiteUID, setWhiteUID] = useState('')
  const [whiteChat, setWhiteChat] = useState('')
  const [whiteHours, setWhiteHours] = useState('')
  // 全局组添加
  const [gbanOpen, setGbanOpen] = useState(false)
  const [gbanUID, setGbanUID] = useState('')
  const [gbanReason, setGbanReason] = useState('')
  // 专属组添加
  const [ownAddOpen, setOwnAddOpen] = useState(false)
  const [ownUID, setOwnUID] = useState('')
  const [ownReason, setOwnReason] = useState('')
  // 管理员添加
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminUID, setAdminUID] = useState('')
  const [adminNote, setAdminNote] = useState('')

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }

  const data = state.data
  const main = data.me.main
  const activeSeg: MainSection = main ? seg : 'gban'
  const { whitelist, profile_ok: profileOK, gban, gban_own: gbanOwn, admins, bots } = data
  const tz = displayTz(data)

  const whiteRows = filterRows(whitelist, whiteQ, whiteKey)
  const profileRows = filterRows(profileOK, profileQ, (p: ProfileOKRow) =>
    profileOKKey(p, (id) => botLabelOf(bots, id)),
  )
  const gbanRows = filterRows(gban, gbanQ, gbanKey)
  const ownRows = filterRows(gbanOwn.bans, ownQ, gbanKey)
  const ownedChats = ownChats(data)

  const segOptions = (
    main
      ? [
          { value: 'white', label: '白名单' },
          { value: 'profile', label: '资料放行' },
          { value: 'gban', label: '联合封禁' },
          { value: 'admins', label: '次级管理员' },
        ]
      : [{ value: 'gban', label: '联合封禁' }]
  ) as { value: MainSection; label: string }[]

  function openAdd() {
    if (activeSeg === 'white') {
      setWhiteBot(bots[0]?.bot_id ?? 0)
      setWhiteUID('')
      setWhiteChat('')
      setWhiteHours('')
      setWhiteOpen(true)
      return
    }
    if (activeSeg === 'gban') {
      if (gbanSub === 'own') setOwnAddOpen(true)
      else setGbanOpen(true)
      return
    }
    if (activeSeg === 'admins') setAdminOpen(true)
  }

  function submitWhite() {
    // 本地先校验整数，非法输入不提交（服务端 400 文案较泛，这里给出可操作提示）。
    const uid = whiteUID.trim()
    if (!/^\d+$/.test(uid)) {
      toast('user_id 必须是正整数')
      return
    }
    const chat = whiteChat.trim()
    if (chat !== '' && !/^-?\d+$/.test(chat)) {
      toast('chat_id 必须是整数（0 = 该 bot 所有群）')
      return
    }
    const hours = whiteHours.trim()
    if (hours !== '' && !/^\d+$/.test(hours)) {
      toast('小时必须是非负整数（留空 = 永久）')
      return
    }
    whiteMut.mutate(
      {
        action: 'add',
        bot_id: whiteBot,
        chat_id: chat === '' ? 0 : Number(chat),
        user_id: uid,
        hours: hours === '' ? 0 : Number(hours),
      },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已加入白名单')
          setWhiteOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function removeWhite(w: WhiteRow) {
    whiteMut.mutate(
      { action: 'remove', bot_id: w.bot_id, chat_id: w.chat_id, user_id: w.user_id },
      {
        onSuccess: (resp) => toast(resp.note ?? '已移除'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function revokeProfile(p: ProfileOKRow) {
    whiteMut.mutate(
      { action: 'unprofile', bot_id: p.bot_id, user_id: p.user_id },
      {
        onSuccess: (resp) => toast(resp.note ?? '已撤销'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function submitGban() {
    gbanMut.mutate(
      { action: 'add', user_id: gbanUID.trim(), reason: gbanReason.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已加入名单')
          setGbanOpen(false)
          setGbanUID('')
          setGbanReason('')
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  async function removeGban(row: GbanRow) {
    const ok = await confirm({
      title: '解除联合封禁？',
      description: `将把 uid ${row.user_id} 从全局联合封禁名单移除${
        row.reason ? `（原因：${row.reason}）` : ''
      }。解除后该用户不再被全局组自动处置。`,
      confirmText: '确认解除',
      danger: true,
    })
    if (!ok) return
    gbanMut.mutate(
      { action: 'remove', user_id: row.user_id },
      {
        onSuccess: (resp) => toast(resp.note ?? '已解除'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function submitOwn() {
    ownListMut.mutate(
      { action: 'add', user_id: ownUID.trim(), reason: ownReason.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已加入专属组')
          setOwnAddOpen(false)
          setOwnUID('')
          setOwnReason('')
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggleOwnEnabled(next: boolean) {
    ownMut.mutate(
      {
        body: { action: 'enable', on: next },
        apply: (s: State) => ({ ...s, gban_own: { ...s.gban_own, enabled: next } }),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? (next ? '已开启' : '已关闭')),
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggleOwnChat(chatID: number, next: boolean) {
    ownMut.mutate(
      {
        body: { action: 'chat', chat_id: chatID, on: next },
        apply: (s: State) => ({
          ...s,
          gban_own: {
            ...s.gban_own,
            chats: next
              ? [...s.gban_own.chats.filter((id) => id !== chatID), chatID]
              : s.gban_own.chats.filter((id) => id !== chatID),
          },
        }),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? '已保存'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function removeOwn(row: GbanRow) {
    ownListMut.mutate(
      { action: 'remove', user_id: row.user_id },
      {
        onSuccess: (resp) => toast(resp.note ?? '已移除'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function submitAdmin() {
    adminMut.mutate(
      { action: 'add', user_id: adminUID.trim(), note: adminNote.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已添加')
          setAdminOpen(false)
          setAdminUID('')
          setAdminNote('')
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  async function removeAdmin(row: AdminRow) {
    const ok = await confirm({
      title: '移除次级管理员？',
      description: `将移除 uid ${row.user_id}${row.note ? `（${row.note}）` : ''} 的管理员权限；其名下 bot 的配置保留，但该账号将无法再打开面板。`,
      confirmText: '确认移除',
      danger: true,
    })
    if (!ok) return
    adminMut.mutate(
      { action: 'remove', user_id: row.user_id },
      {
        onSuccess: (resp) => toast(resp.note ?? '已移除'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const showAdd = activeSeg !== 'profile'

  return (
    <div
      data-testid="lists-page"
      // 悬浮新增按钮压在内容上，给它留出可滚到的底部空间。
      style={{
        paddingBottom: showAdd ? 'calc(72px + env(safe-area-inset-bottom))' : undefined,
      }}
    >
      <Segmented
        value={activeSeg}
        onChange={(next) => setSeg(next as MainSection)}
        options={segOptions}
        ariaLabel="名单分段"
        className="mb-2"
      />

      {showAdd && (
        // ListsPage 是二级页，TabBar 在这时不渲染：贴着底部安全区放。
        <button
          type="button"
          aria-label="新增"
          onClick={openAdd}
          className="fixed right-4 z-20 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2"
          style={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      {activeSeg === 'white' && (
        <>
          <SectionCard title="白名单">
            <div className="px-3 pt-3 pb-2">
              <SearchField
                value={whiteQ}
                onChange={setWhiteQ}
                placeholder="搜索 user_id / 来源 / 群号"
                ariaLabel="搜索白名单"
              />
              <SearchCount shown={whiteRows.length} total={whitelist.length} />
            </div>
            {whiteRows.map((w) => (
              <ListRow
                key={`${w.bot_id}:${w.chat_id}:${w.user_id}`}
                primary={
                  <>
                    {w.user_id} · <ScopeText w={w} />
                  </>
                }
                secondary={`来源 ${whiteSourceLabel(w.source)} · ${
                  w.expires_at ? `到 ${fmtTS(w.expires_at, tz)}` : '永久'
                }`}
                trailing={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-destructive hover:bg-destructive/10"
                    disabled={whiteMut.isPending}
                    onClick={() => removeWhite(w)}
                  >
                    移除
                  </Button>
                }
              />
            ))}
            {whiteRows.length === 0 && <EmptyLine>没有匹配的白名单</EmptyLine>}
          </SectionCard>

          <SectionCard title="默认豁免（内置，无需配置）">
            <Hint>
              下面这些人的消息不送检、不处置。它们不在上面的白名单表里，是判定前的内置放行：
            </Hint>
            <ListRow primary="主管理员（你）" value={meLabel(data.me)} />
            {bots
              .filter((b) => b.owner_id)
              .map((b) => (
                <ListRow
                  key={b.bot_id}
                  primary={`「${b.label}」归属人`}
                  value={`uid ${b.owner_id}`}
                />
              ))}
            <ListRow
              primary="各群的群主与管理员"
              badge={<Badge tone="ok">判定时实时查询</Badge>}
            />
            <ListRow
              primary="匿名管理员 / 关联频道转发"
              badge={<Badge tone="ok">默认放行</Badge>}
            />
            <ListRow primary="有管理员权限的 bot" badge={<Badge tone="ok">默认不判</Badge>} />
            <ListRow primary="普通 bot（工具 bot）" badge={<Badge>默认照判</Badge>} />
            <div className="px-4 pb-3">
              <p className="text-[12px] leading-[1.7] text-muted-foreground">
                群主/管理员向 Telegram 实时查询，结果缓存 10 分钟。工具 bot
                默认与普通成员一样送检；要全豁免可在机器人详情页关闭「判定普通成员 bot」。
              </p>
            </div>
          </SectionCard>
        </>
      )}

      {activeSeg === 'profile' && (
        <SectionCard title="资料放行（复判确认）">
          <Hint>
            这些人的账号资料被复判判定「不构成广告」，到期前不再因资料被删；改过资料或到期后自动失效。
            正文与链接内容照常判定。
          </Hint>
          <div className="px-3 pt-3 pb-2">
            <SearchField
              value={profileQ}
              onChange={setProfileQ}
              placeholder="搜索 user_id / 机器人 / 原因"
              ariaLabel="搜索资料放行"
            />
            <SearchCount shown={profileRows.length} total={profileOK.length} />
          </div>
          {profileRows.map((p) => (
            <ListRow
              key={`${p.bot_id}:${p.user_id}`}
              primary={`${p.user_id} · ${botLabelOf(bots, p.bot_id)}`}
              secondary={`${p.hours} 小时 · 到 ${fmtTS(p.expires_at, tz)}`}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-destructive hover:bg-destructive/10"
                  disabled={whiteMut.isPending}
                  onClick={() => revokeProfile(p)}
                >
                  撤销
                </Button>
              }
            />
          ))}
          {profileRows.length === 0 && (
            <EmptyLine>
              {profileOK.length === 0 ? '（没有放行中的资料）' : '没有资料放行'}
            </EmptyLine>
          )}
        </SectionCard>
      )}

      {activeSeg === 'gban' && (
        <>
          <Segmented
            value={gbanSub}
            onChange={(next) => setGbanSub(next === 'own' ? 'own' : 'global')}
            options={[
              { value: 'global', label: '全局组' },
              { value: 'own', label: '我的专属组' },
            ]}
            ariaLabel="联封分组"
            className="mb-3"
          />

          {gbanSub === 'global' ? (
            <SectionCard title="全局联合封禁组">
              <Hint>
                所有管理员共同维护；只有加入全局组的 bot 会执行（机器人详情页里选）。
              </Hint>
              <div className="px-3 pt-3 pb-2">
                <SearchField
                  value={gbanQ}
                  onChange={setGbanQ}
                  placeholder="搜索 user_id / 原因"
                  ariaLabel="搜索全局组"
                />
                <SearchCount shown={gbanRows.length} total={gban.length} />
              </div>
              {gbanRows.map((g) => (
                <ListRow
                  key={g.user_id}
                  primary={`${g.user_id} · ${g.reason || '（无原因）'}`}
                  secondary={g.created_at ? `加入 ${fmtTS(g.created_at, tz)}` : undefined}
                  trailing={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive hover:bg-destructive/10"
                      disabled={gbanMut.isPending}
                      onClick={() => void removeGban(g)}
                    >
                      解除
                    </Button>
                  }
                />
              ))}
              {gbanRows.length === 0 && (
                <EmptyLine>
                  {gban.length === 0 ? '（名单为空）' : '没有匹配的名单条目'}
                </EmptyLine>
              )}
            </SectionCard>
          ) : (
            <>
              <SectionCard title="专属联合封禁组">
                <SwitchRow
                  primary="启用"
                  secondary="名下 bot 判定的最高档命中自动进这个组，只在你圈定的群里执行"
                  checked={gbanOwn.enabled}
                  disabled={ownMut.isPending}
                  onChange={toggleOwnEnabled}
                />
                <p className="px-4 pt-2 text-[13px] text-muted-foreground">生效群（点开关圈定）</p>
                {ownedChats.length === 0 ? (
                  <EmptyLine>（名下 bot 还没有群）</EmptyLine>
                ) : (
                  ownedChats.map((c) => (
                    <SwitchRow
                      key={c.chat_id}
                      ariaLabel={c.title || String(c.chat_id)}
                      primary={c.title || String(c.chat_id)}
                      secondary={c.username ? `@${c.username}` : String(c.chat_id)}
                      checked={gbanOwn.chats.includes(c.chat_id)}
                      disabled={ownMut.isPending}
                      onChange={(next) => toggleOwnChat(c.chat_id, next)}
                    />
                  ))
                )}
              </SectionCard>

              <SectionCard title="封禁名单">
                <div className="px-3 pt-3 pb-2">
                  <SearchField
                    value={ownQ}
                    onChange={setOwnQ}
                    placeholder="搜索 user_id / 原因"
                    ariaLabel="搜索专属组"
                  />
                  <SearchCount shown={ownRows.length} total={gbanOwn.bans.length} />
                </div>
                {ownRows.map((g) => (
                  <ListRow
                    key={g.user_id}
                    primary={`${g.user_id} · ${g.reason || '（无原因）'}`}
                    trailing={
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-destructive hover:bg-destructive/10"
                        disabled={ownListMut.isPending}
                        onClick={() => removeOwn(g)}
                      >
                        移除
                      </Button>
                    }
                  />
                ))}
                {ownRows.length === 0 && (
                  <EmptyLine>
                    {gbanOwn.bans.length === 0 ? '（名单为空）' : '没有匹配的名单条目'}
                  </EmptyLine>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}

      {activeSeg === 'admins' && (
        <SectionCard title="次级管理员">
          <Hint>
            次级管理员能管理自己名下的机器人、群组与联封名单，看不到白名单、资料放行、上游、模型与全局设置。
          </Hint>
          {admins !== undefined && admins.length === 0 && (
            <EmptyLine>（还没有次级管理员）</EmptyLine>
          )}
          {(admins ?? []).map((a) => (
            <ListRow
              key={a.user_id}
              primary={String(a.user_id)}
              secondary={a.note || '（无备注）'}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-destructive hover:bg-destructive/10"
                  disabled={adminMut.isPending}
                  onClick={() => void removeAdmin(a)}
                >
                  移除
                </Button>
              }
            />
          ))}
        </SectionCard>
      )}

      <FormDrawer
        open={whiteOpen}
        onClose={() => setWhiteOpen(false)}
        title="加入白名单"
        pending={whiteMut.isPending}
        submitText="加入"
        submitDisabled={whiteBot === 0 || whiteUID.trim() === ''}
        onSubmit={submitWhite}
      >
        <Label htmlFor="white-bot" className="mb-1 block">
          机器人
        </Label>
        <Select value={String(whiteBot)} onValueChange={(value) => setWhiteBot(Number(value))}>
          {/* Base UI 的 Trigger 是 role=combobox，htmlFor 对它不生效，必须补 aria-label。 */}
          <SelectTrigger id="white-bot" aria-label="机器人">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bots.map((b) => (
              <SelectItem key={b.bot_id} value={String(b.bot_id)}>
                {b.label} · {b.bot_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldLabel htmlFor="white-uid">user_id</FieldLabel>
        <Input
          id="white-uid"
          inputMode="numeric"
          value={whiteUID}
          onChange={(event) => setWhiteUID(event.target.value)}
        />
        <FieldLabel htmlFor="white-chat">chat_id（0 = 该 bot 所有群）</FieldLabel>
        <Input
          id="white-chat"
          inputMode="numeric"
          value={whiteChat}
          onChange={(event) => setWhiteChat(event.target.value)}
        />
        <FieldLabel htmlFor="white-hours">小时（留空 = 永久）</FieldLabel>
        <Input
          id="white-hours"
          inputMode="numeric"
          value={whiteHours}
          onChange={(event) => setWhiteHours(event.target.value)}
        />
        <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
          白名单只免判定，不会自动撤销已经执行的处罚。
        </p>
      </FormDrawer>

      <FormDrawer
        open={gbanOpen}
        onClose={() => setGbanOpen(false)}
        title="加入全局联合封禁组"
        pending={gbanMut.isPending}
        submitText="加入"
        submitDisabled={gbanUID.trim() === ''}
        onSubmit={submitGban}
      >
        <FieldLabel htmlFor="gban-uid">user_id</FieldLabel>
        <Input
          id="gban-uid"
          inputMode="numeric"
          value={gbanUID}
          onChange={(event) => setGbanUID(event.target.value)}
        />
        <FieldLabel htmlFor="gban-reason">原因（可留空）</FieldLabel>
        <Input
          id="gban-reason"
          value={gbanReason}
          onChange={(event) => setGbanReason(event.target.value)}
        />
        <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
          手工加入与判定命中同待遇：名单内的用户会被全局组覆盖范围内执行封禁。
        </p>
      </FormDrawer>

      <FormDrawer
        open={ownAddOpen}
        onClose={() => setOwnAddOpen(false)}
        title="加入我的专属组"
        pending={ownListMut.isPending}
        submitText="加入"
        submitDisabled={ownUID.trim() === ''}
        onSubmit={submitOwn}
      >
        <FieldLabel htmlFor="own-uid">user_id</FieldLabel>
        <Input
          id="own-uid"
          inputMode="numeric"
          value={ownUID}
          onChange={(event) => setOwnUID(event.target.value)}
        />
        <FieldLabel htmlFor="own-reason">原因（可留空）</FieldLabel>
        <Input
          id="own-reason"
          value={ownReason}
          onChange={(event) => setOwnReason(event.target.value)}
        />
      </FormDrawer>

      <FormDrawer
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        title="添加次级管理员"
        pending={adminMut.isPending}
        submitText="添加"
        submitDisabled={adminUID.trim() === ''}
        onSubmit={submitAdmin}
      >
        <FieldLabel htmlFor="admin-uid">user_id</FieldLabel>
        <Input
          id="admin-uid"
          inputMode="numeric"
          value={adminUID}
          onChange={(event) => setAdminUID(event.target.value)}
        />
        <FieldLabel htmlFor="admin-note">备注（可留空）</FieldLabel>
        <Input
          id="admin-note"
          value={adminNote}
          onChange={(event) => setAdminNote(event.target.value)}
        />
      </FormDrawer>
    </div>
  )
}
