// 模型定价（仅主管理员）：
// - 列表：搜索（名称，本地）；行 = 等宽模型名 + 启用徽标 + 单价摘要；
// - ＋ 抽屉：上游（仅启用中）+ 模型 ID + 四个价格（数字键盘）→ model add；
// - 详情：四价格编辑、启停 Switch（乐观）、删除（ActionSheet 写明对象）。
import { useState } from 'react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { useModelMutation, useOptimisticMiniMutation } from '../api/mutations'
import { REASONING_EFFORTS } from '../api/types'
import type { Model, State } from '../api/types'
import { EmptyState, ErrorState, Skeletons, useToast } from '../components/feedback'
import { FormDrawer, ListRow, SearchField, SectionCard, SwitchRow, useConfirm } from '../components/mobile'
import { Badge } from '../components/ui'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { filterRows } from '../lib/filters'
import { useNav, usePageParam } from '../nav'

const REASONING_EFFORT_UNSET = '__unset__'

function priceText(m: Pick<Model, 'prompt_price' | 'completion_price'>): string {
  return `输入 $${m.prompt_price}/M · 补全 $${m.completion_price}/M`
}

function priceSummary(m: Model): string {
  return `${priceText(m)} · 缓存读 $${m.cache_read_price} / 写 $${m.cache_write_price}`
}

export function ModelsPage() {
  const nav = useNav()
  const toast = useToast()
  const state = useMiniState(true)
  const addMut = useModelMutation()

  const [q, setQ] = usePageParam('q')
  const [addOpen, setAddOpen] = useState(false)
  const [upstream, setUpstream] = useState('')
  const [modelID, setModelID] = useState('')
  const [prompt, setPrompt] = useState('0')
  const [completion, setCompletion] = useState('0')
  const [cacheRead, setCacheRead] = useState('0')
  const [cacheWrite, setCacheWrite] = useState('0')

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!state.data.me.main) return <ErrorState status={403} />

  const models = state.data.models ?? []
  const enabledUpstreams = (state.data.upstreams ?? []).filter((u) => u.status)
  const visible = filterRows(models, q, (m) => m.name)

  function openAdd() {
    setUpstream(enabledUpstreams[0]?.name ?? '')
    setModelID('')
    setPrompt('0')
    setCompletion('0')
    setCacheRead('0')
    setCacheWrite('0')
    setAddOpen(true)
  }

  function submitAdd() {
    addMut.mutate(
      {
        action: 'add',
        upstream,
        model_id: modelID.trim(),
        prompt_price: prompt.trim(),
        completion_price: completion.trim(),
        cache_read_price: cacheRead.trim(),
        cache_write_price: cacheWrite.trim(),
      },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已添加；可在「全局设置 → 默认模型」里引用')
          setAddOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <div data-testid="models-page">
      <div className="mb-2">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索模型名称"
          ariaLabel="搜索模型"
        />
      </div>

      <SectionCard
        title={countText(visible.length, models.length)}
        footer={
          enabledUpstreams.length === 0 ? undefined : (
            <ListRow primary="＋ 添加模型" chevron onClick={openAdd} />
          )
        }
      >
        {visible.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            {models.length === 0 ? '（还没有模型）' : '没有匹配的模型'}
          </p>
        ) : (
          visible.map((m) => (
            <ListRow
              key={m.name}
              primary={<span className="font-mono text-[15px]">{m.name}</span>}
              secondary={priceSummary(m)}
              badge={<Badge tone={m.enabled ? 'ok' : 'no'}>{m.enabled ? '启用' : '停用'}</Badge>}
              chevron
              onClick={() => nav.push({ k: 'model', name: m.name })}
            />
          ))
        )}
      </SectionCard>

      {enabledUpstreams.length === 0 && (
        <p className="px-3 text-[12px] leading-[1.7] text-muted-foreground">
          还没有启用的上游渠道：先到「上游渠道」添加并启用，才能登记模型。
        </p>
      )}

      <FormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加模型"
        pending={addMut.isPending}
        submitText="添加"
        submitDisabled={upstream === '' || modelID.trim() === ''}
        onSubmit={submitAdd}
      >
        <div className="mb-3">
          <Label htmlFor="model-upstream" className="mb-1 block">
            上游（仅启用中）
          </Label>
          <Select value={upstream} onValueChange={(value) => setUpstream(value)}>
            <SelectTrigger id="model-upstream" aria-label="上游（仅启用中）">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {enabledUpstreams.map((u) => (
                <SelectItem key={u.id} value={u.name}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="model-id" className="mb-1 block">
            模型 ID
          </Label>
          <Input
            id="model-id"
            placeholder="如 gpt-5-mini"
            value={modelID}
            onChange={(event) => setModelID(event.target.value)}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="model-prompt" className="mb-1 block">
              输入价 $/M
            </Label>
            <Input
              id="model-prompt"
              inputMode="decimal"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor="model-completion" className="mb-1 block">
              补全价 $/M
            </Label>
            <Input
              id="model-completion"
              inputMode="decimal"
              value={completion}
              onChange={(event) => setCompletion(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="model-cache-read" className="mb-1 block">
              缓存读取价
            </Label>
            <Input
              id="model-cache-read"
              inputMode="decimal"
              value={cacheRead}
              onChange={(event) => setCacheRead(event.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Label htmlFor="model-cache-write" className="mb-1 block">
              缓存创建价
            </Label>
            <Input
              id="model-cache-write"
              inputMode="decimal"
              value={cacheWrite}
              onChange={(event) => setCacheWrite(event.target.value)}
            />
          </div>
        </div>

        <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground">
          四项价格单位都是每百万 token 美元；留空按 0 计。模型全名 = 上游名/模型 ID。
        </p>
      </FormDrawer>
    </div>
  )
}

function countText(shown: number, total: number): string {
  return shown === total ? `共 ${total} 个模型` : `匹配 ${shown} / 共 ${total} 个模型`
}

/** PriceCard 是详情的四价格编辑卡：子组件持有草稿，挂载时从模型值初始化。 */
function PriceCard({ model }: { model: Model }) {
  const toast = useToast()
  const mut = useModelMutation()
  const [prompt, setPrompt] = useState(String(model.prompt_price))
  const [completion, setCompletion] = useState(String(model.completion_price))
  const [cacheRead, setCacheRead] = useState(String(model.cache_read_price))
  const [cacheWrite, setCacheWrite] = useState(String(model.cache_write_price))

  function submit() {
    mut.mutate(
      {
        action: 'update',
        name: model.name,
        prompt_price: prompt.trim(),
        completion_price: completion.trim(),
        cache_read_price: cacheRead.trim(),
        cache_write_price: cacheWrite.trim(),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? '已保存'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const field = (id: string, label: string, value: string, setValue: (next: string) => void) => (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id} className="mb-1 block">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  )

  return (
    <SectionCard title="单价（每百万 token，美元）">
      <div className="p-3">
        <div className="flex gap-2">
          {field('price-prompt', '输入价', prompt, setPrompt)}
          {field('price-completion', '补全价', completion, setCompletion)}
        </div>
        <div className="mt-3 flex gap-2">
          {field('price-cache-read', '缓存读取价', cacheRead, setCacheRead)}
          {field('price-cache-write', '缓存创建价', cacheWrite, setCacheWrite)}
        </div>
        <Button className="mt-4 h-11 w-full" disabled={mut.isPending} onClick={submit}>
          保存价格
        </Button>
        <p className="mt-2 text-[12px] leading-[1.7] text-muted-foreground">
          留空按 0 计；改价只影响之后的核算，不会重算历史开销。
        </p>
      </div>
    </SectionCard>
  )
}

export function ModelDetailPage({ name }: { name: string }) {
  const nav = useNav()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)
  const removeMut = useModelMutation()
  const enableMut = useOptimisticMiniMutation('model')

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!state.data.me.main) return <ErrorState status={403} />

  const model = (state.data.models ?? []).find((m) => m.name === name)
  if (!model) {
    return <EmptyState title="模型不存在" description="它可能已被删除。" />
  }

  function toggleEnabled(next: boolean) {
    enableMut.mutate(
      {
        body: { action: 'update', name, enabled: next },
        apply: (s: State) => ({
          ...s,
          models: (s.models ?? []).map((m) => (m.name === name ? { ...m, enabled: next } : m)),
        }),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? (next ? '已启用' : '已停用')),
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggleSimple(next: boolean) {
    enableMut.mutate(
      {
        body: { action: 'update', name, simple_instructions: next },
        apply: (s: State) => ({
          ...s,
          models: (s.models ?? []).map((m) =>
            m.name === name ? { ...m, simple_instructions: next } : m,
          ),
        }),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? (next ? '已简化' : '已还原完整提示词')),
        onError: (err) => toast(err.message),
      },
    )
  }

  function setEffort(next: string) {
    enableMut.mutate(
      {
        body: { action: 'update', name, reasoning_effort: next },
        apply: (state: State) => ({
          ...state,
          models: (state.models ?? []).map((entry) =>
            entry.name === name ? { ...entry, reasoning_effort: next } : entry,
          ),
        }),
      },
      {
        onSuccess: (resp) =>
          toast(resp.note ?? (next ? `思考强度 ${next}` : '不传思考强度')),
        onError: (err) => toast(err.message),
      },
    )
  }

  async function removeModel() {
    const ok = await confirm({
      title: '删除该模型？',
      description: `将删除「${model?.name}」及其单价配置；仍在默认模型或机器人模型列表里引用时会判定失败，请先改掉引用。此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    removeMut.mutate(
      { action: 'remove', name },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已删除')
          nav.pop()
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <div data-testid="model-detail-page">
      <SectionCard>
        <ListRow
          primary={<span className="font-mono text-[15px]">{model.name}</span>}
          secondary={`上游 ${model.upstream || '（旧格式）'} ｜ 模型 ID ${model.model_id}`}
          badge={<Badge tone={model.enabled ? 'ok' : 'no'}>{model.enabled ? '启用' : '停用'}</Badge>}
        />
        <SwitchRow
          primary="启用"
          secondary={
            model.enabled ? '停用后不能再被选为默认模型或 bot 模型' : '启用后才能被引用'
          }
          checked={model.enabled}
          disabled={enableMut.isPending}
          onChange={toggleEnabled}
        />
        <SwitchRow
          primary="初判提示词简化为一句话"
          secondary={
            model.simple_instructions
              ? 'is_ad 只问一句「是不是广告」，给微调过的初判模型用'
              : '初判带完整判定口径；微调过的初判模型可打开此项'
          }
          checked={model.simple_instructions}
          disabled={enableMut.isPending}
          onChange={toggleSimple}
        />
        <div className="px-4 py-3">
          <Label htmlFor="model-reasoning-effort" className="mb-1 block">
            思考强度
          </Label>
          <Select
            value={
              model.reasoning_effort === ''
                ? REASONING_EFFORT_UNSET
                : model.reasoning_effort
            }
            disabled={enableMut.isPending}
            onValueChange={(next) =>
              setEffort(next === REASONING_EFFORT_UNSET ? '' : next)
            }
          >
            <SelectTrigger id="model-reasoning-effort" aria-label="思考强度">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REASONING_EFFORT_UNSET}>不填</SelectItem>
              {REASONING_EFFORTS.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[12px] leading-[1.7] text-muted-foreground">
            不填不发，模型按自己的默认思考；模型不认时自动去掉
          </p>
        </div>
      </SectionCard>

      <PriceCard key={model.name} model={model} />

      <SectionCard title="危险区">
        <ListRow
          primary="删除该模型"
          secondary="先确认没有默认模型或机器人还在引用它"
          disabled={removeMut.isPending}
          onClick={() => void removeModel()}
          className="text-destructive"
        />
      </SectionCard>
    </div>
  )
}
