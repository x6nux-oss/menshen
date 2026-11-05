// 模型调用流水页（Mini App / 网页版，仅主管理员）：ai_log 表的只读视图。
//
//   - 一行是一次模型请求（判定/复判/识图/总结都算），状态徽标区分成功与失败阶段；
//   - 搜索是服务端子串匹配（model / upstream / status / error），300ms 防抖；
//   - 流水的输入/输出全文在详情页（点行进入）；固定提示词在落库时已剥成
//     占位符，这里看到的就是存下的样子。
import { useEffect, useRef, useState } from 'react'
import { errorStatus } from '../api/client'
import { useInfiniteAILogs, useMiniState } from '../api/hooks'
import type { AILogRow } from '../api/types'
import { EmptyState, ErrorState, Skeletons } from '../components/feedback'
import { SearchField, Segmented } from '../components/mobile'
import { Badge, Button } from '../components/ui'
import { displayTz, fmtTSFull } from '../lib/format'
import { useNav, usePageParam } from '../nav'
import { InfiniteFooter, ListCount, ListLoading } from './shared'

const SEARCH_DEBOUNCE_MS = 300

/** STATUS_FILTERS 是结果筛选：全部 / 成功 / 失败。value 直接发给后端。 */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'ok', label: '成功' },
  { value: 'err', label: '失败' },
]

export function AILogPage() {
  const state = useMiniState(true)
  const nav = useNav()
  const [status, setStatus] = usePageParam(
    'status',
    '',
    STATUS_FILTERS.map((s) => s.value),
  )
  const [q, setQ] = usePageParam('q')
  const [serverQ, setServerQ] = useState(q)
  const debounceRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const isMain = state.data?.me.main === true
  const logs = useInfiniteAILogs({ q: serverQ, status, enabled: isMain })

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
        description="模型调用流水带着所有机器人的判定上下文，只有主管理员可以查看。"
      />
    )
  }

  const tz = displayTz(state.data)
  const rows = logs.data?.pages.flatMap((page) => page.logs) ?? []
  const total = logs.data?.pages[0]?.total
  const countLoading = logs.isPending || logs.isPlaceholderData

  return (
    <div data-testid="ailog-page">
      <div className="mb-1 flex items-center gap-2">
        <SearchField
          value={q}
          onChange={changeQ}
          onSubmit={submitQ}
          placeholder="搜模型 / 上游 / 错误"
          ariaLabel="搜索模型调用流水"
          className="flex-1"
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

      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
        <Segmented
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS}
          ariaLabel="调用结果"
        />
      </div>

      {logs.isError && logs.data === undefined ? (
        <ErrorState status={errorStatus(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        <>
          <ListCount total={total} loading={countLoading} testId="ailog-total" />
          {logs.isPending ? (
            <Skeletons rows={3} />
          ) : rows.length === 0 ? (
            logs.isPlaceholderData || logs.isFetching ? (
              <ListLoading />
            ) : (
              <EmptyState
                title="没有调用记录"
                description="每次模型调用的输入输出都会落一行；还没有记录或换个搜索词试试。"
              />
            )
          ) : (
            <>
              <div className="mt-0.5">
                {rows.map((row) => (
                  <AILogListRow
                    key={row.id}
                    row={row}
                    tz={tz}
                    onOpen={() => nav.push({ k: 'ailogitem', id: row.id })}
                  />
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
        固定系统提示词（判定/复判等）对所有请求都一样，落库时已换成占位符；正文、资料与上下文原样保留。
        保留天数在「全局设置 → 护栏与成本」调整。
      </p>
    </div>
  )
}

/** AILogListRow：时间 + 结果徽标 + 模型/上游 + 用量与时延；点行看全文。 */
function AILogListRow({ row, tz, onOpen }: { row: AILogRow; tz?: string; onOpen: () => void }) {
  const ok = row.status === 'ok'
  return (
    <button
      type="button"
      data-testid={`ailog-row-${row.id}`}
      onClick={onOpen}
      className="block min-h-[52px] w-full border-b border-border px-2 py-1.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="flex items-center gap-1.5">
        <Badge tone={ok ? 'ok' : 'no'}>{ok ? '成功' : '失败'}</Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {row.model || '（未记录）'}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">{row.latency_ms}ms</span>
      </span>
      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
        {fmtTSFull(row.ts, tz)} · {row.endpoint} · {row.upstream || '—'} ·{' '}
        {row.prompt_tokens}+{row.completion_tokens} tok · {row.cost_text}
        {!ok && row.status ? ` · ${row.status}` : ''}
      </span>
      {!ok && row.error && (
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{row.error}</span>
      )}
    </button>
  )
}
