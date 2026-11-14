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
import { DataTable, PageHeader, StatusBadge } from '../components'
import type { Column } from '../components'
import { useRunFeedback } from '../feedback'
import { useAdminNav } from '../nav'
import { KINDS, kindCaps } from './upstreamKinds'
import type { Upstream, UpstreamKind } from '../../api/types'

export function UpstreamsView() {
  const state = useMiniState(true)
  const nav = useAdminNav()
  const [open, setOpen] = useState(false)
  if (!state.data) return null

  const upstreams = state.data.upstreams ?? []
  const columns: Column<Upstream>[] = [
    { key: 'name', header: '名称', render: (row) => row.name },
    { key: 'kind', header: '渠道类型', width: 180, render: (row) => KINDS.find((k) => k.value === row.kind)?.label ?? row.kind },
    { key: 'base', header: 'base_url', render: (row) => row.base_url || '（默认）' },
    { key: 'key', header: 'api_key', width: 160, render: (row) => row.api_key },
    { key: 'weight', header: '权重', width: 80, align: 'right', render: (row) => row.weight },
    {
      key: 'status',
      header: '状态',
      width: 96,
      render: (row) => <StatusBadge info={row.status ? { label: '启用', tone: 'ok' } : { label: '停用', tone: 'neutral' }} />,
    },
    {
      key: 'caps',
      header: '能力',
      width: 180,
      render: (row) =>
        [row.supports_chat && 'chat', row.supports_systemone && 'systemone'].filter(Boolean).join(' · ') || '—',
    },
  ]

  return (
    <>
      <PageHeader
        title="上游渠道"
        subtitle="AI 上游的端点与密钥；渠道类型决定请求/响应协议"
        actions={
          <Button onClick={() => setOpen(true)}>
            ＋ 新增上游
          </Button>
        }
      />
      <DataTable
        rows={upstreams}
        rowKey={(row) => row.id}
        onRowClick={(row) => nav.go({ k: 'upstream', id: row.id })}
        empty={<span className="text-[13px] text-muted-foreground">还没有配置上游渠道。</span>}
        columns={columns}
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
            <p className="text-[11.5px] text-muted-foreground">留空用渠道默认端点</p>
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
