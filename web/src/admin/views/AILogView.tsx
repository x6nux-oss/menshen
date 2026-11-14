// AI 调用流水（主管理员）：ai_log 表的只读视图，一行是一次模型请求。
//
// 与 Mini App 的 AILogPage 消费同一套接口（ailog / ailogitem），桌面形态用表格 +
// 侧滑详情：列表密、详情深。数据层（useInfiniteAILogs / useAILogItem）已存在，
// 本文件只做展示。
import { useState } from 'react'
import { errorStatus } from '../../api/client'
import { useAILogItem, useInfiniteAILogs, useMiniState } from '../../api/hooks'
import type { AILogRow } from '../../api/types'
import { displayTz, fmtTSFull } from '../../lib/format'
import { ErrorState } from '../../components/feedback'
import { SearchField } from '../../components/mobile'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
} from '../../components/ui'
import { CardBlock, MonoText, PageHeader, StatusBadge, Toolbar } from '../components'
import { DataTable } from '../data-table'
import { useDebouncedValue } from '../nav'
import type { Column } from '../components'

/** STATUS_FILTERS 是结果筛选：value 原样发给后端（''=全部）。 */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'ok', label: '成功' },
  { value: 'err', label: '失败' },
]

/** ALL 是「全部」在下拉里的占位 key（Base UI Select 用 null 表示未选中，空串会被当成没选）。 */
const ALL = '__all__'

/** aiStatusInfo 把后端的状态串归成徽标：ok 正常、其余都算失败阶段。 */
function aiStatusInfo(status: string) {
  return status === 'ok'
    ? { label: '成功', tone: 'ok' as const }
    : { label: status || '失败', tone: 'no' as const }
}

/** usageText 渲染用量：prompt→completion，有缓存命中时补一段。 */
function usageText(row: AILogRow): string {
  const base = `${row.prompt_tokens} → ${row.completion_tokens}`
  return row.cached_tokens > 0 ? `${base}（缓存 ${row.cached_tokens}）` : base
}

export function AILogView() {
  const state = useMiniState(true)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const debouncedQ = useDebouncedValue(q)
  const main = state.data?.me.main ?? false
  const logs = useInfiniteAILogs({ q: debouncedQ, status, enabled: main })
  const [openId, setOpenId] = useState<number | null>(null)

  if (!main) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">AI 调用流水只对主管理员开放。</span>
      </CardBlock>
    )
  }

  const pages = logs.data?.pages ?? []
  const rows = pages.flatMap((p) => p.logs)
  const total = pages[pages.length - 1]?.total
  const tz = state.data ? displayTz(state.data) : undefined

  const columns: Column<AILogRow>[] = [
    { key: 'time', header: '时间', width: 160, render: (row) => fmtTSFull(row.ts, tz) },
    { key: 'model', header: '模型', width: 220, render: (row) => <MonoText>{row.model}</MonoText> },
    { key: 'upstream', header: '上游', width: 120, render: (row) => row.upstream || '—' },
    { key: 'status', header: '状态', width: 90, render: (row) => <StatusBadge info={aiStatusInfo(row.status)} /> },
    { key: 'latency_ms', header: '耗时', width: 90, align: 'right', render: (row) => `${row.latency_ms} ms` },
    { key: 'usage', header: '用量（入→出）', width: 170, render: (row) => <MonoText>{usageText(row)}</MonoText> },
    { key: 'cost', header: '开销', width: 100, align: 'right', render: (row) => row.cost_text || '—' },
  ]

  return (
    <>
      <PageHeader
        title="AI 调用流水"
        subtitle={
          total !== undefined
            ? `共 ${total} 条；判定、复判、识图、总结都算一次调用`
            : '每次模型请求一行（判定 / 复判 / 识图 / 总结）'
        }
        actions={
          <Button variant="outline" disabled={logs.isFetching} onClick={() => void logs.refetch()}>
            刷新
          </Button>
        }
      />
      <Toolbar>
        <div className="flex min-w-[140px] flex-col gap-1">
          <Label htmlFor="ailog-status">结果</Label>
          <Select
            value={status === '' ? ALL : status}
            onValueChange={(v) => setStatus(v === ALL ? '' : v)}
          >
            <SelectTrigger id="ailog-status" aria-label="结果">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value === '' ? ALL : s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索模型 / 上游 / 状态 / 错误"
          className="max-w-[360px]"
        />
      </Toolbar>

      {logs.isError ? (
        <ErrorState status={errorStatus(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        <DataTable
          loading={logs.isPending}
          rows={rows}
          rowKey={(row) => row.id}
          sortable={['status', 'latency_ms']}
          onRowClick={(row) => setOpenId(row.id)}
          empty={<span className="text-[13px] text-muted-foreground">没有匹配的调用记录。</span>}
          columns={columns}
        />
      )}

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

      <AILogDetailDialog id={openId} onClose={() => setOpenId(null)} tz={tz} />
    </>
  )
}

/** AILogDetailDialog 是一行的详情：元信息 + 请求/响应全文。
 *  全文可能很长，用 max-h + 滚动容器，保持换行与等宽。 */
function AILogDetailDialog({
  id,
  onClose,
  tz,
}: {
  id: number | null
  onClose: () => void
  tz: string | undefined
}) {
  const detail = useAILogItem(id ?? 0, id !== null)
  const row = detail.data

  return (
    <Dialog open={id !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[900px]">
        <DialogHeader>
          <DialogTitle>调用详情</DialogTitle>
          <DialogDescription>
            {row ? fmtTSFull(row.ts, tz) : '加载中…'}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> 加载中…
          </div>
        ) : detail.isError ? (
          <ErrorState status={errorStatus(detail.error)} onRetry={() => void detail.refetch()} />
        ) : row ? (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
              <Meta label="模型" value={row.model} mono />
              <Meta label="上游" value={row.upstream || '—'} />
              <Meta label="端点" value={row.endpoint || '—'} mono />
              <Meta label="状态" value={aiStatusInfo(row.status).label} />
              <Meta label="耗时" value={`${row.latency_ms} ms`} />
              <Meta label="用量" value={usageText(row)} />
              <Meta label="开销" value={row.cost_text || '—'} />
              <Meta label="记录号" value={String(row.id)} mono />
            </dl>

            {row.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {row.error}
              </div>
            )}

            <Separator />
            <TextBlock title="请求（input）" text={row.input} />
            <TextBlock title="响应（output）" text={row.output} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono text-[12.5px]' : 'truncate text-[13px]'}>{value}</dd>
    </div>
  )
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-muted-foreground">{title}</span>
      {text ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-[12.5px] leading-relaxed">
          {text}
        </pre>
      ) : (
        <span className="text-[13px] text-muted-foreground">（空）</span>
      )}
    </div>
  )
}
