// oxlint-disable react/set-state-in-effect -- 草稿态需要跟随服务端返回的值重置（保存后刷新）。
// 上游详情：改名、渠道配置、启停、连通性测试、删除。
import { useEffect, useState } from 'react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '../../components/ui'
import { useUpstreamMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { CardBlock, ConfirmButton, InfoList, PageHeader, StatusBadge } from '../components'
import { useRunFeedback } from '../feedback'
import { KINDS, kindCaps } from './upstreamKinds'
import type { UpstreamKind, UpstreamTestResp } from '../../api/types'

export function UpstreamDetailView({ id }: { id: number }) {
  const state = useMiniState(true)
  const run = useRunFeedback()
  const mut = useUpstreamMutation<UpstreamTestResp>()

  if (!state.data) return null
  const up = (state.data.upstreams ?? []).find((u) => u.id === id)
  if (!up) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">上游不存在。</span>
      </CardBlock>
    )
  }

  return (
    <>
      <PageHeader
        title={up.name}
        subtitle={`渠道 ${KINDS.find((k) => k.value === up.kind)?.label ?? up.kind}`}
        actions={<StatusBadge info={up.status ? { label: '启用', tone: 'ok' } : { label: '停用', tone: 'neutral' }} />}
      />

      <CardBlock
        title="启停"
        actions={
          <Switch
            checked={up.status}
            disabled={mut.isPending}
            aria-label="启用该上游"
            onCheckedChange={(checked) =>
              run(mut.mutateAsync({ action: 'update', id: up.id, status: checked }), checked ? '已启用' : '已停用')
            }
          />
        }
      >
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          停用后该上游不参与选路，其名下模型的判定请求会失败。
        </span>
      </CardBlock>

      <ConfigCard up={{ id: up.id, name: up.name, kind: up.kind, base_url: up.base_url, supports_chat: up.supports_chat, supports_systemone: up.supports_systemone }} />

      <CardBlock title="连通性测试">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={mut.isPending}
            onClick={() => {
              mut.mutate({ action: 'test', id: up.id })
            }}
          >
            测试
          </Button>
          {mut.data &&
            (mut.data.ok ? (
              <span className="text-[13px] text-[#067A3E] dark:text-[#4ADE80]">
                连通正常{mut.data.latency_ms !== undefined ? ` · ${mut.data.latency_ms} ms` : ''}
                {mut.data.model ? ` · ${mut.data.model}` : ''}
              </span>
            ) : (
              <span className="text-[13px] text-[#C62828] dark:text-[#FF8A80]">{mut.data.error || '测试失败'}</span>
            ))}
        </div>
      </CardBlock>

      <CardBlock title="其他">
        <InfoList
          items={[
            { label: 'id', value: up.id },
            { label: 'api_key', value: up.api_key },
            { label: '权重', value: up.weight },
          ]}
        />
        <div className="mt-4">
          <ConfirmButton
            variant="outlined"
            color="error"
            danger
            title="删除上游"
            description="名下有模型时禁止删除——会留下一批绑定的上游不存在的死引用。"
            confirmLabel="删除"
            disabled={mut.isPending}
            onConfirm={() => run(mut.mutateAsync({ action: 'remove', id: up.id }), '已删除')}
          >
            删除上游
          </ConfirmButton>
        </div>
      </CardBlock>
    </>
  )
}

function ConfigCard({
  up,
}: {
  up: {
    id: number
    name: string
    kind: UpstreamKind
    base_url: string
    supports_chat: boolean
    supports_systemone: boolean
  }
}) {
  const run = useRunFeedback()
  const mut = useUpstreamMutation()
  const [name, setName] = useState(up.name)
  const [kind, setKind] = useState<UpstreamKind>(up.kind)
  const [baseURL, setBaseURL] = useState(up.base_url)
  const [apiKey, setApiKey] = useState('')
  useEffect(() => {
    setName(up.name)
    setKind(up.kind)
    setBaseURL(up.base_url)
    setApiKey('')
  }, [up.id, up.name, up.kind, up.base_url])

  const dirty = name !== up.name || kind !== up.kind || baseURL !== up.base_url || apiKey !== ''

  return (
    <CardBlock title="配置">
      <div className="grid max-w-[560px] gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="up-name">名称</Label>
          <Input id="up-name" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="text-[12px] text-muted-foreground">改名会连带改写模型名与绑定，谨慎操作</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="up-kind">渠道类型</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as UpstreamKind)}>
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="up-base-url">base_url</Label>
          <Input id="up-base-url" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          <span className="text-[12px] text-muted-foreground">留空用渠道默认端点</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="up-api-key">api_key</Label>
          <Input id="up-api-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <span className="text-[12px] text-muted-foreground">留空表示不修改；当前为掩码显示</span>
        </div>
        <div>
          <Button
            disabled={!dirty || mut.isPending}
            onClick={() => {
              const caps = kindCaps(kind)
              run(
                mut.mutateAsync({
                  action: 'update',
                  id: up.id,
                  kind,
                  name,
                  supports_chat: caps.chat,
                  supports_systemone: caps.systemone,
                  ...(baseURL.trim() !== '' ? { base_url: baseURL.trim() } : {}),
                  ...(apiKey.trim() !== '' ? { api_key: apiKey.trim() } : {}),
                }),
                '已保存',
              )
            }}
          >
            保存配置
          </Button>
        </div>
      </div>
    </CardBlock>
  )
}
