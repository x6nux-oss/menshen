// 用户资料页：
// 资料卡 + 分段（只看被处置过的，默认 / 全部判定记录）+ 无限滚动记录列表。
// 数据来自 user op（每页都带完整资料字段），默认 filter=act，hasMore 用 shown 判断。
import { useState } from 'react'
import { errorStatus } from '../api/client'
import { useInfiniteUserLogs, useMiniState } from '../api/hooks'
import type { UserDossier, UserLogRow } from '../api/types'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { ChatRef, ListRow, SectionCard, Segmented } from '../components/mobile'
import { Badge } from '../components/ui'
import { actionLabel, displayTz, fmtTS } from '../lib/format'
import { verdictInfo } from '../lib/status'
import { useNav } from '../nav'
import { InfiniteFooter, InfoRow, ListLoading } from './shared'

export function UserPage({ id }: { id: number }) {
  const nav = useNav()
  const [filter, setFilter] = useState<'act' | 'all'>('act')
  const state = useMiniState(true)
  const user = useInfiniteUserLogs(id, filter)

  if (user.isError && user.data === undefined) {
    return <ErrorState status={errorStatus(user.error)} onRetry={() => void user.refetch()} />
  }
  if (user.isPending) return <Skeletons rows={4} />

  const pages = user.data?.pages ?? []
  const profile: UserDossier | undefined = pages[0]
  const rows = pages.flatMap((page) => page.logs)
  const tz = state.data ? displayTz(state.data) : undefined

  return (
    <div data-testid="user-page">
      <SectionCard title="用户资料">
        {profile && (
          <>
            <InfoRow label="用户 ID">
              <span className="font-mono">{profile.user_id}</span>
            </InfoRow>
            {profile.username !== '' && <InfoRow label="用户名">@{profile.username}</InfoRow>}
            <InfoRow label="昵称">{profile.name !== '' ? profile.name : '（查不到）'}</InfoRow>
            <InfoRow label="个人简介">{profile.bio !== '' ? profile.bio : '（空或查不到）'}</InfoRow>
            <InfoRow label="发言">
              留底 {profile.kept} 条 ｜ 画像累计 {profile.msgs} 条 ｜ 历史命中 {profile.hits} 次
            </InfoRow>
            <InfoRow label="群组">
              {profile.chats} 个 ｜ 首见 {fmtTS(profile.first_seen, tz)} ｜ 最近发言{' '}
              {fmtTS(profile.last_msg, tz)}
            </InfoRow>
            <InfoRow label="判定">
              共 {profile.total} 条，其中被处置过 {profile.processed} 条
            </InfoRow>
          </>
        )}
      </SectionCard>

      <div className="mb-2">
        <Segmented
          value={filter}
          onChange={(next) => setFilter(next === 'all' ? 'all' : 'act')}
          options={[
            { value: 'act', label: '只看被处置过的' },
            { value: 'all', label: '全部判定记录' },
          ]}
          ariaLabel="用户记录筛选"
        />
      </div>

      {rows.length === 0 ? (
        user.isPlaceholderData || user.isFetching ? (
          <ListLoading />
        ) : (
          <EmptyState
            title="没有记录"
            description={
              filter === 'act' ? '该用户还没有被处置过的记录。' : '该用户还没有判定记录。'
            }
          />
        )
      ) : (
        <>
          <SectionCard>
            {rows.map((row) => (
              <UserLogListRow
                key={row.id}
                log={row}
                tz={tz}
                onOpen={() => nav.push({ k: 'log', id: row.id })}
              />
            ))}
          </SectionCard>
          <InfiniteFooter
            hasNextPage={user.hasNextPage}
            isFetchingNextPage={user.isFetchingNextPage}
            isFetchNextPageError={user.isFetchNextPageError}
            error={user.error}
            onLoadMore={() => void user.fetchNextPage()}
            onRetry={() => void user.fetchNextPage()}
          />
        </>
      )}
    </div>
  )
}

/** UserLogListRow：`#id · 时间` + 判定/处置徽标 + 群号与置信度 + 原文 50 字。 */
function UserLogListRow({
  log,
  tz,
  onOpen,
}: {
  log: UserLogRow
  tz?: string
  onOpen: () => void
}) {
  const verdict = verdictInfo(log.verdict)
  return (
    <ListRow
      primary={
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-sm">
            #{log.id} · {fmtTS(log.created_at, tz)}
          </span>
          <Badge tone={verdict.tone}>{verdict.label}</Badge>
          <Badge>{actionLabel(log.action)}</Badge>
        </span>
      }
      secondary={
        <span className="block">
          群 <ChatRef name={log.chat} url={log.chat_url} fallback={log.chat_id} /> ·{' '}
          {Math.round(log.confidence * 100)}%
          {log.text !== '' && <span className="block">{log.text.slice(0, 50)}</span>}
        </span>
      }
      chevron
      onClick={onOpen}
    />
  )
}
