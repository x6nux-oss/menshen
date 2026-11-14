// 上游渠道（主管理员）：列表 + 新增。行点击进入详情。
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui'
import { useUpstreamMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { filterRows } from '../../lib/filters'
import { SearchField } from '../../components/mobile'
import { PageHeader, StatusBadge } from '../components'
import type { Column } from '../components'
import { DataTable } from '../data-table'
import { useRunFeedback } from '../feedback'
import { useAdminNav } from '../nav'
import { KINDS, kindCaps } from './upstreamKinds'
import type { Upstream, UpstreamKind } from '../../api/types'
import { FilterChips } from './list-tools'
import { useSearchHotkey } from './use-search-hotkey'
import { choiceParam, textParam, useUrlFilter } from './use-url-filters'

const UPSTREAM_STATES = ['all', 'enabled', 'disabled'] as const
const STATE_PARAM = choiceParam(UPSTREAM_STATES)
const SEARCH_PARAM = textParam()

export function UpstreamsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const [q, setQ] = useUrlFilter('q', '', SEARCH_PARAM)
  const [filter, setFilter] = useUrlFilter<(typeof UPSTREAM_STATES)[number]>(
    'state',
    'all',
    STATE_PARAM,
  )
  const [open, setOpen] = useState(false)
  const searchRef = useSearchHotkey<HTMLDivElement>()
  if (!state.data) return null

  const upstreams = state.data.upstreams ?? []
  const rows = filterRows(
    upstreams,
    q,
    (u) => `${u.name} ${u.base_url} ${KINDS.find((k) => k.value === u.kind)?.label ?? ''}`,
  ).filter((u) => filter === 'all' || (filter === 'enabled' ? u.status : !u.status))
  const columns: Column<Upstream>[] = [
    {
      key: 'name',
      header: '渠道',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">{row.name}</p>
          <p className="truncate font-mono text-[11.5px] text-muted-foreground">
            {row.base_url || '默认端点'}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: '协议',
      width: 170,
      render: (row) => (
        <span className="text-[13px]">
          {KINDS.find((k) => k.value === row.kind)?.label ?? row.kind}
        </span>
      ),
    },
    {
      key: 'key',
      header: 'API key',
      width: 160,
      render: (row) => (
        <span className="font-mono text-[12px] text-muted-foreground">{row.api_key}</span>
      ),
    },
    {
      key: 'weight',
      header: '权重',
      width: 70,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.weight}</span>,
    },
    {
      key: 'caps',
      header: '能力',
      width: 160,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.supports_chat && <span className="text-[12px] text-muted-foreground">chat</span>}
          {row.supports_systemone && (
            <span className="text-[12px] text-muted-foreground">systemone</span>
          )}
          {!row.supports_chat && !row.supports_systemone && (
            <span className="text-[12px] text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: 90,
      render: (row) => (
        <StatusBadge
          info={row.status ? { label: '启用', tone: 'ok' } : { label: '停用', tone: 'neutral' }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="上游渠道"
        subtitle={`${upstreams.length} 个渠道 · 渠道类型决定请求/响应协议`}
        actions={<Button onClick={() => setOpen(true)}>＋ 新增上游</Button>}
      />
      <DataTable
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => nav.go({ k: 'upstream', id: row.id })}
        empty={
          <span className="text-[13px] text-muted-foreground">
            {q || filter !== 'all' ? '没有匹配的上游渠道。' : '还没有配置上游渠道。'}
          </span>
        }
        columns={columns}
        toolbar={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div ref={searchRef} className="w-full max-w-[320px]">
              <SearchField value={q} onChange={setQ} placeholder="搜索名称 / 端点 / 协议" />
            </div>
            <FilterChips
              ariaLabel="按上游状态筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: '全部', count: upstreams.length },
                {
                  value: 'enabled',
                  label: '启用',
                  count: upstreams.filter((u) => u.status).length,
                },
                {
                  value: 'disabled',
                  label: '停用',
                  count: upstreams.filter((u) => !u.status).length,
                },
              ]}
            />
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>
              显示 {rows.length} / {upstreams.length} 个
            </span>
            <span>点击行查看配置与连通性测试</span>
          </div>
        }
      />
      <AddUpstreamDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function AddUpstreamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useRunFeedback()
  const mut = useUpstreamMutation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<UpstreamKind>('openai')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')

  const valid = name.trim() !== '' && apiKey.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增上游渠道</DialogTitle>
          <DialogDescription>名称会作为模型名前缀；渠道类型决定请求协议。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="up-name">名称</Label>
            <Input
              id="up-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pai"
            />
            <p className="text-[11.5px] text-muted-foreground">用于模型名前缀，如 pai/llm</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="up-kind">渠道类型</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as UpstreamKind)}>
              <SelectTrigger id="up-kind" aria-label="渠道类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="up-base">base_url</Label>
            <Input
              id="up-base"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="留空用渠道默认端点"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="up-key">api_key</Label>
            <Input
              id="up-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!valid || mut.isPending}
            onClick={() => {
              const caps = kindCaps(kind)
              run(
                mut.mutateAsync({
                  action: 'add',
                  name: name.trim(),
                  kind,
                  base_url: baseURL.trim(),
                  api_key: apiKey.trim(),
                  supports_chat: caps.chat,
                  supports_systemone: caps.systemone,
                  disabled: false,
                }),
                '已新增',
              )
              setName('')
              setApiKey('')
              setBaseURL('')
              onClose()
            }}
          >
            新增
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
