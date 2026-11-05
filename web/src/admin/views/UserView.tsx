// 用户资料：画像概览 + 该用户的判定记录（分段：已处置 / 全部）。
import { useState } from 'react'
import { useUser, useMiniState } from '../../api/hooks'
import { actionLabel, displayTz, fmtTS, fmtTSFull } from '../../lib/format'
import { verdictInfo } from '../../lib/status'
import { Button } from '../../components/ui'
import { ChatRef, Segmented } from '../../components/mobile'
import { CardBlock, DataTable, InfoList, PageHeader, StatCard, StatusBadge } from '../components'
import type { Column } from '../components'
import type { UserLogRow } from '../../api/types'

const PAGE_SIZE = 20

export function UserView({ id }: { id: number }) {
  const state = useMiniState(true)
  const [filter, setFilter] = useState<'act' | 'all'>('act')
  const [page, setPage] = useState(1)
  const user = useUser(id, filter, page)

  if (user.isPending) return <span className="text-sm text-muted-foreground">加载中…</span>
  if (user.isError || !user.data) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">用户资料加载失败或不存在。</span>
      </CardBlock>
    )
  }

  const d = user.data
  const tz = state.data ? displayTz(state.data) : undefined
  const pages = Math.max(1, Math.ceil(d.shown / PAGE_SIZE))
  const columns: Column<UserLogRow>[] = [
    { key: 'id', header: '#', width: 70, render: (row) => row.id },
    { key: 'time', header: '时间', width: 130, render: (row) => fmtTS(row.created_at, tz) },
    { key: 'verdict', header: '判定', width: 90, render: (row) => <StatusBadge info={verdictInfo(row.verdict)} /> },
    { key: 'action', header: '处置', width: 120, render: (row) => actionLabel(row.action) },
    { key: 'chat', header: '群组', width: 140, render: (row) => <ChatRef name={row.chat} url={row.chat_url} fallback={row.chat_id} /> },
    {
      key: 'text',
      header: '正文',
      render: (row) => (
        <span className="block truncate text-[12.5px] text-muted-foreground">
          {row.text || row.reason || '—'}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title={d.name || `uid ${d.user_id}`}
        subtitle={d.username ? `@${d.username} · uid ${d.user_id}` : `uid ${d.user_id}`}
      />

      <div className="mb-2 grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard label="留底消息" value={d.msgs} hint={`缓存 ${d.kept} 条`} />
        <StatCard label="命中记录" value={d.hits} hint={`共 ${d.total} 条记录`} />
        <StatCard label="涉及群组" value={d.chats} />
        <StatCard label="入群时间" value={d.first_seen ? fmtTS(d.first_seen, tz) : '未知'} />
      </div>

      <CardBlock title="画像">
        <InfoList
          items={[
            { label: '最近发言', value: d.last_msg ? fmtTSFull(d.last_msg, tz) : '—' },
            { label: '简介', value: d.bio || '（空）' },
          ]}
        />
      </CardBlock>

      <CardBlock
        title="判定记录"
        actions={
          <Segmented
            value={filter}
            onChange={(value) => {
              setFilter(value === 'all' ? 'all' : 'act')
              setPage(1)
            }}
            options={[
              { value: 'act', label: '已处置' },
              { value: 'all', label: '全部' },
            ]}
          />
        }
      >
        <DataTable
          loading={user.isFetching}
          rows={d.logs}
          rowKey={(row) => row.id}
          empty={<span className="text-[13px] text-muted-foreground">没有匹配的记录。</span>}
          columns={columns}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1 || user.isFetching} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="text-[13px] text-muted-foreground">
            第 {page} / {pages} 页（{d.shown} 条）
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pages || user.isFetching}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </CardBlock>
    </>
  )
}
