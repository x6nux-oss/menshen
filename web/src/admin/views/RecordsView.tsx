// 记录：判定记录与申诉两个分段，服务端分页 + 搜索；筛选写入 URL 便于刷新/分享。
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../../components/ui'
import { useAppeals, useLogs, useMiniState } from '../../api/hooks'
import { actionLabel, apAI, displayTz, fmtTS, kindLabel } from '../../lib/format'
import { appealStatusInfo, verdictInfo } from '../../lib/status'
import { SearchField } from '../../components/mobile'
import { PageHeader, StatusBadge } from '../components'
import { DataTable } from '../data-table'
import { useAdminNav, useDebouncedValue } from '../nav'
import type { Column } from '../components'
import type { AppealRow, LogRow } from '../../api/types'
import { FilterChips } from './list-tools'
import { useSearchHotkey } from './use-search-hotkey'
import { choiceParam, intParam, textParam, useUrlFilter } from './use-url-filters'

const PAGE_SIZE = 20

const LOG_FILTERS = [
  { value: 'deleted', label: '已删除' },
  { value: 'all', label: '全部' },
  { value: 'ad', label: '广告' },
  { value: 'clean', label: '正常' },
  { value: 'skipped', label: '未送检' },
] as const

const APPEAL_FILTERS = [
  { value: 'open', label: '未结' },
  { value: 'all', label: '全部' },
] as const

const TABS = ['logs', 'appeals'] as const
const LOG_VALUES = LOG_FILTERS.map((item) => item.value)
const APPEAL_VALUES = APPEAL_FILTERS.map((item) => item.value)
const TAB_PARAM = choiceParam(TABS)
const LOG_FILTER_PARAM = choiceParam(LOG_VALUES)
const APPEAL_FILTER_PARAM = choiceParam(APPEAL_VALUES)
const SEARCH_PARAM = textParam()
const PAGE_PARAM = intParam(1)

export function RecordsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const [tab, setTab] = useUrlFilter<(typeof TABS)[number]>('tab', 'logs', TAB_PARAM)
  const [logFilter, setLogFilter] = useUrlFilter<(typeof LOG_VALUES)[number]>(
    'verdict',
    'deleted',
    LOG_FILTER_PARAM,
  )
  const [appealFilter, setAppealFilter] = useUrlFilter<(typeof APPEAL_VALUES)[number]>(
    'appeal',
    'open',
    APPEAL_FILTER_PARAM,
  )
  const [q, setQ] = useUrlFilter('q', '', SEARCH_PARAM)
  const [logPage, setLogPage] = useUrlFilter('page', 1, PAGE_PARAM)
  const [appealPage, setAppealPage] = useUrlFilter('apage', 1, PAGE_PARAM)
  const debouncedQ = useDebouncedValue(q)
  const searchRef = useSearchHotkey<HTMLDivElement>()

  const logs = useLogs({
    filter: logFilter,
    q: debouncedQ,
    page: logPage,
    enabled: tab === 'logs',
  })
  const appeals = useAppeals({ filter: appealFilter, page: appealPage, enabled: tab === 'appeals' })
  const tz = state.data ? displayTz(state.data) : undefined
  const openAppeals = state.data?.todo.open_appeals ?? 0

  const logRows = logs.data?.logs ?? []
  const appealRows = appeals.data?.appeals ?? []
  const logTotal = logs.data?.total ?? 0
  const appealTotal = appeals.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="记录"
        subtitle={
          tab === 'logs'
            ? `判定记录 ${logTotal} 条 · 按处置结果筛选并下钻到单条判定`
            : `申诉 ${appealTotal} 条 · 未结 ${openAppeals} 条`
        }
        actions={
          <Tabs value={tab} onValueChange={(next) => setTab(next as (typeof TABS)[number])}>
            <TabsList className="h-9">
              <TabsTrigger value="logs" className="px-3.5">
                判定记录
              </TabsTrigger>
              <TabsTrigger value="appeals" className="px-3.5">
                申诉
                {openAppeals > 0 && (
                  <span className="ml-1.5 rounded bg-warning/20 px-1 text-[11px] tabular-nums text-foreground">
                    {openAppeals}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {tab === 'logs' ? (
        <DataTable
          loading={logs.isPending}
          rows={logRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => nav.go({ k: 'log', id: row.id })}
          empty={
            <span className="text-[13px] text-muted-foreground">
              {q || logFilter !== 'deleted' ? '没有匹配的判定记录。' : '还没有判定记录。'}
            </span>
          }
          columns={logColumns(tz)}
          toolbar={
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <FilterChips
                ariaLabel="按判定结果筛选"
                value={logFilter}
                onChange={(value) => {
                  setLogFilter(value)
                  setLogPage(1)
                }}
                options={LOG_FILTERS.map((item) => ({ ...item }))}
              />
              <div ref={searchRef} className="w-full max-w-[320px]">
                <SearchField
                  value={q}
                  onChange={(value) => {
                    setQ(value)
                    setLogPage(1)
                  }}
                  placeholder="搜索正文 / 用户 id"
                  ariaLabel="搜索判定记录"
                />
              </div>
            </div>
          }
          footer={
            <Pager
              page={logPage}
              total={logTotal}
              loading={logs.isFetching}
              onChange={setLogPage}
              unit="条记录"
            />
          }
        />
      ) : (
        <DataTable
          loading={appeals.isPending}
          rows={appealRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => nav.go({ k: 'appeal', id: row.id })}
          empty={
            <span className="text-[13px] text-muted-foreground">
              {appealFilter === 'open' ? '没有未结申诉。' : '还没有申诉。'}
            </span>
          }
          columns={appealColumns(tz)}
          toolbar={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FilterChips
                ariaLabel="按申诉状态筛选"
                value={appealFilter}
                onChange={(value) => {
                  setAppealFilter(value)
                  setAppealPage(1)
                }}
                options={APPEAL_FILTERS.map((item) => ({ ...item }))}
              />
              <p className="ml-auto self-center text-[11.5px] text-muted-foreground">
                点击行查看申诉陈述与人工处置
              </p>
            </div>
          }
          footer={
            <Pager
              page={appealPage}
              total={appealTotal}
              loading={appeals.isFetching}
              onChange={setAppealPage}
              unit="条申诉"
            />
          }
        />
      )}
    </>
  )
}

function logColumns(tz?: string): Column<LogRow>[] {
  return [
    {
      key: 'id',
      header: '#',
      width: 72,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{row.id}</span>
      ),
    },
    {
      key: 'time',
      header: '时间',
      width: 120,
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums">{fmtTS(row.created_at, tz)}</span>
      ),
    },
    {
      key: 'verdict',
      header: '判定',
      width: 90,
      render: (row) => <StatusBadge info={verdictInfo(row.verdict)} />,
    },
    {
      key: 'action',
      header: '处置',
      width: 130,
      render: (row) => (
        <span className="text-[13px]">{actionLabel(row.action)}</span>
      ),
    },
    {
      key: 'kind',
      header: '类型',
      width: 100,
      render: (row) => (
        <span className="text-[12.5px] text-muted-foreground">{kindLabel(row.kind)}</span>
      ),
    },
    {
      key: 'user',
      header: '用户',
      width: 100,
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums">{row.user_id}</span>
      ),
    },
    {
      key: 'text',
      header: '正文 / 判定理由',
      render: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-1 text-[13px]">{row.text || row.reason || '—'}</p>
          {row.reason && row.text && (
            <p className="line-clamp-1 text-[11.5px] text-muted-foreground">{row.reason}</p>
          )}
        </div>
      ),
    },
    {
      key: 'cost',
      header: '开销',
      width: 90,
      align: 'right',
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {row.cost_text || '—'}
        </span>
      ),
    },
  ]
}

function appealColumns(tz?: string): Column<AppealRow>[] {
  return [
    {
      key: 'id',
      header: '#',
      width: 72,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{row.id}</span>
      ),
    },
    {
      key: 'time',
      header: '提交时间',
      width: 120,
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums">{fmtTS(row.created_at, tz)}</span>
      ),
    },
    {
      key: 'user',
      header: '用户',
      width: 100,
      render: (row) => (
        <span className="font-mono text-[12px] tabular-nums">{row.user_id}</span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: 100,
      render: (row) => <StatusBadge info={appealStatusInfo(row.status)} />,
    },
    {
      key: 'ai',
      header: 'AI 结论',
      width: 110,
      render: (row) => <span className="text-[13px]">{apAI(row.ai_result)}</span>,
    },
    {
      key: 'reason',
      header: 'AI 理由 / 申诉',
      render: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-1 text-[13px]">{row.ai_reason || '—'}</p>
          {row.statement && (
            <p className="line-clamp-1 text-[11.5px] text-muted-foreground">{row.statement}</p>
          )}
        </div>
      ),
    },
    {
      key: 'web',
      header: '网页尝试',
      width: 90,
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.web_attempts}</span>
      ),
    },
    {
      key: 'code',
      header: '解禁码',
      width: 90,
      render: (row) => (
        <span className={row.has_code ? 'text-[13px]' : 'text-[13px] text-muted-foreground'}>
          {row.has_code ? '已签发' : '—'}
        </span>
      ),
    },
  ]
}

function Pager({
  page,
  total,
  loading,
  onChange,
  unit,
}: {
  page: number
  total: number
  loading: boolean
  onChange: (page: number) => void
  unit: string
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(total, page * PAGE_SIZE)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted-foreground">
      <span>
        {total === 0 ? `0 ${unit}` : `${from}–${to} / 共 ${total} ${unit}`}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <span className="min-w-14 text-center tabular-nums">
          {page} / {pages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pages || loading}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
