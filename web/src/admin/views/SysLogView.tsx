// 运行日志（主管理员）：进程内 slog 环形缓冲的只读视图。级别按不低于所选级别筛选。
import { useState } from 'react'
import { useInfiniteSysLogs, useMiniState } from '../../api/hooks'
import { displayTz, fmtTSFull } from '../../lib/format'
import { logLevelInfo } from '../../lib/status'
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui'
import { SearchField } from '../../components/mobile'
import { CardBlock, DataTable, MonoText, PageHeader, StatusBadge, Toolbar } from '../components'
import { useDebouncedValue } from '../nav'
import type { Column } from '../components'
import type { SysLogRow } from '../../api/types'

const LEVELS = [
  { value: '', label: '全部' },
  { value: 'debug', label: '调试及以上' },
  { value: 'info', label: '信息及以上' },
  { value: 'warn', label: '警告及以上' },
  { value: 'error', label: '仅错误' },
]

/** EMPTY_VALUE 是「全部」（值为空串）在下拉里的占位 key。
 *  Base UI 的 Select 用 null 表示未选中，空串会被当成「没选」，所以映射成一个哨兵值。 */
const ALL = '__all__'

export function SysLogView() {
  const state = useMiniState(true)
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const debouncedQ = useDebouncedValue(q)
  const main = state.data?.me.main ?? false
  const logs = useInfiniteSysLogs({ level, q: debouncedQ, enabled: main })

  if (!main) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">运行日志只对主管理员开放。</span>
      </CardBlock>
    )
  }

  const pages = logs.data?.pages ?? []
  const rows = pages.flatMap((p) => p.logs)
  const counts = pages[0]?.counts
  const tz = state.data ? displayTz(state.data) : undefined

  const columns: Column<SysLogRow>[] = [
    { key: 'time', header: '时间', width: 160, render: (row) => fmtTSFull(row.at, tz) },
    { key: 'level', header: '级别', width: 90, render: (row) => <StatusBadge info={logLevelInfo(row.level)} /> },
    { key: 'message', header: '消息', render: (row) => row.message },
    {
      key: 'attrs',
      header: '字段',
      render: (row) =>
        row.attrs.length === 0 ? (
          '—'
        ) : (
          <MonoText>{row.attrs.map((a) => `${a.k}=${a.v}`).join(' ')}</MonoText>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="运行日志"
        subtitle={
          counts
            ? `最近 ${logs.data?.pages.length ?? 0} 页；搜索命中：调试 ${counts.debug} · 信息 ${counts.info} · 警告 ${counts.warn} · 错误 ${counts.error}`
            : '进程内缓冲（最近 2000 条，重启清空）'
        }
        actions={
          <Button variant="outline" disabled={logs.isFetching} onClick={() => void logs.refetch()}>
            刷新
          </Button>
        }
      />
      <Toolbar>
        <div className="flex min-w-[160px] flex-col gap-1">
          <Label htmlFor="syslog-level">级别</Label>
          <Select
            value={level === '' ? ALL : level}
            onValueChange={(v) => setLevel(v === ALL ? '' : v)}
          >
            <SelectTrigger id="syslog-level" aria-label="级别">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value === '' ? ALL : l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SearchField value={q} onChange={setQ} placeholder="搜索消息 / 字段" className="max-w-[320px]" />
      </Toolbar>

      <DataTable
        loading={logs.isPending}
        rows={rows}
        rowKey={(row) => row.seq}
        empty={<span className="text-[13px] text-muted-foreground">没有匹配的日志。</span>}
        columns={columns}
      />

      <div className="mt-1.5 flex justify-center gap-2">
        {logs.hasNextPage && (
          <Button
            variant="outline"
            disabled={logs.isFetchingNextPage}
            onClick={() => void logs.fetchNextPage()}
          >
            {logs.isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        )}
        {!logs.hasNextPage && rows.length > 0 && (
          <span className="text-[13px] text-muted-foreground">已到末尾（{rows.length} 条）</span>
        )}
      </div>
    </>
  )
}
