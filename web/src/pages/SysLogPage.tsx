// 运行日志页（Mini App，仅主管理员）：进程内 slog 环形缓冲的只读视图。
//
//   - 级别 chips 按不低于语义：选 `警告` 同时看到 WARN 与 ERROR，这是
//     运维看日志的默认预期；`各级` 一行给出当前搜索下各档的条数；
//   - 搜索是服务端子串匹配（消息 + 字段的键和值），300ms 防抖、回车立即；
//   - 无限滚动（每页 50，新→旧）；日志只在内存、不落库，看最新的点 `刷新`。
import { useEffect, useRef, useState } from 'react'
import { errorStatus } from '../api/client'
import { useInfiniteSysLogs, useMiniState } from '../api/hooks'
import type { SysLogRow } from '../api/types'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { Segmented, SearchField } from '../components/mobile'
import { Badge } from '../components/ui'
import { Button } from '../components/ui/button'
import { displayTz, fmtTSFull } from '../lib/format'
import { logLevelInfo } from '../lib/status'
import { usePageParam } from '../nav'
import { InfiniteFooter, ListCount, ListLoading } from './shared'

const SEARCH_DEBOUNCE_MS = 300

/** LEVELS 是级别下限选项；value 直接发给后端（空串 = 不过滤）。 */
const LEVELS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
]

export function SysLogPage() {
  const state = useMiniState(true)
  const [level, setLevel] = usePageParam('level', '', LEVELS.map((l) => l.value))
  const [q, setQ] = usePageParam('q')
  // 搜索词防抖后再发请求；初值取已还原的 q，刷新后直接按该词查询。
  const [serverQ, setServerQ] = useState(q)
  const debounceRef = useRef<number | null>(null)

  // 卸载时清掉未触发的防抖，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  // 只有主管理员能读；非主管理员不发请求（服务端也会 403，这里是省一次往返）。
  const isMain = state.data?.me.main === true
  const logs = useInfiniteSysLogs({ level, q: serverQ, enabled: isMain })

  const changeQ = (next: string) => {
    setQ(next)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      setServerQ(next)
    }, SEARCH_DEBOUNCE_MS)
  }

  const submitQ = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setServerQ(q)
  }

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!isMain) {
    return (
      <EmptyState
        title="需要主管理员权限"
        description="运行日志是进程级的，会带出所有机器人的上下文，只有主管理员可以查看。"
      />
    )
  }

  const tz = displayTz(state.data)
  const rows = logs.data?.pages.flatMap((page) => page.logs) ?? []
  // 总数与各级统计取第一页：切换级别/搜索时 pages[0] 还是旧数据的占位，必须显示占位。
  const total = logs.data?.pages[0]?.total
  const counts = logs.data?.pages[0]?.counts
  const countLoading = logs.isPending || logs.isPlaceholderData

  return (
    <div data-testid="syslog-page">
      <div className="mb-2 flex items-center gap-2">
        <SearchField
          value={q}
          onChange={changeQ}
          onSubmit={submitQ}
          placeholder="搜消息 / 字段"
          ariaLabel="搜索运行日志"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void logs.refetch()}
          className="h-10 shrink-0 px-3"
        >
          刷新
        </Button>
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Segmented
          value={level}
          onChange={setLevel}
          options={LEVELS}
          ariaLabel="日志级别"
        />
        <span className="text-[12px] text-muted-foreground">级别含更高档</span>
      </div>

      {counts !== undefined && !countLoading && (
        <div data-testid="syslog-counts" className="mb-1 px-0.5 text-[12.5px] text-muted-foreground">
          {`各级：调试 ${counts.debug} · 信息 ${counts.info} · 警告 ${counts.warn} · 错误 ${counts.error}`}
        </div>
      )}

      {logs.isError && logs.data === undefined ? (
        <ErrorState status={errorStatus(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        <>
          <ListCount total={total} loading={countLoading} testId="syslog-total" />
          {logs.isPending ? (
            <Skeletons rows={3} />
          ) : rows.length === 0 ? (
            logs.isPlaceholderData || logs.isFetching ? (
              <ListLoading />
            ) : (
              <EmptyState title="没有日志" description="换个级别或搜索词试试；更早的日志看服务端标准输出。" />
            )
          ) : (
            <>
              <div className="mt-1">
                {rows.map((log) => (
                  <SysLogListRow key={log.seq} log={log} tz={tz} />
                ))}
              </div>
              <InfiniteFooter
                hasNextPage={logs.hasNextPage}
                isFetchingNextPage={logs.isFetchingNextPage}
                isFetchNextPageError={logs.isFetchNextPageError}
                error={logs.error}
                onLoadMore={() => void logs.fetchNextPage()}
                onRetry={() => void logs.fetchNextPage()}
              />
            </>
          )}
        </>
      )}

      <p className="mt-2 px-3 text-[12px] leading-[1.7] text-muted-foreground">
        这里只保留最近若干条，进程重启后清空；完整日志落在数据库同目录
        （data.db → data.log），单文件与总大小上限在「全局设置 → 护栏与成本」调整。
      </p>
    </div>
  )
}

/** SysLogListRow：`MM-DD HH:mm:ss` + 级别徽标 + 消息 + 结构化字段（k=v）。 */
function SysLogListRow({ log, tz }: { log: SysLogRow; tz?: string }) {
  const info = logLevelInfo(log.level)
  return (
    <div
      data-testid={`syslog-row-${log.seq}`}
      className="border-b border-border px-0.5 py-1.5"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[12.5px] text-muted-foreground">
          {fmtTSFull(log.at, tz)}
        </span>
        <Badge tone={info.tone}>{info.label}</Badge>
        <span className="min-w-0 flex-[1_1_220px] text-sm leading-[1.6] break-words">
          {log.message}
        </span>
      </div>
      {log.attrs.length > 0 && (
        <div className="mt-0.5 font-mono text-[12px] leading-[1.6] break-words text-muted-foreground">
          {log.attrs.map((attr, i) => (
            <span key={`${attr.k}-${i}`} className="mr-2">
              {attr.k}={attr.v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
