// 全局设置（仅主管理员；次级管理员按无权限处理）：
// - 总开关：antiad_enabled / alert_copy_main / gban_enabled，Switch 乐观更新，
//   提交必须是字符串 '1'/'0'；
// - 默认模型：判定/复判/识图/规则发现，抽屉内已启用模型快选；判定与复判
//   是逗号列表（按重试顺序），识图与规则发现是单项；
// - 主题折叠卡（state.sections）：卡头显示已设置 N 项；逐项智能控件——
//   toggle → Switch、number → 抽屉（时长类预设按 spec.min/max 过滤并显示换算）；
// - 展示时区 / 群内提示附加链接 / 形态摘要 / 修正文本。
import { ChevronDown, MinusCircle, PlusCircle } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { errorStatus } from '../api/client'
import { useMiniState } from '../api/hooks'
import { useDigestMutation, useOptimisticMiniMutation, useSetMutation } from '../api/mutations'
import type { Spec, State } from '../api/types'
import { ErrorState, Skeletons, useToast } from '../components/feedback'
import {
  Chip,
  FormDrawer,
  ListRow,
  LocalModelsCard,
  SectionCard,
  SettingRow,
  SwitchRow,
} from '../components/mobile'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import {
  CAPTCHA_DEMO_PATH,
  controlKind,
  minutePresets,
  specHint,
  specValueText,
  validateSpecValue,
} from '../lib/settings'

/** parseModelList 把模型列表键（JSON 数组或逗号串）转成逗号分隔文本。 */
function parseModelList(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string').join(', ')
    }
  } catch {
    // 非 JSON（逗号串）原样展示。
    return raw
  }
  return ''
}

const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
]

const MASTER_TOGGLES: { key: string; label: string; hint: string }[] = [
  { key: 'antiad_enabled', label: '反广告总开关', hint: '关闭后所有机器人停止判定与处置' },
  { key: 'alert_copy_main', label: '告警抄送主管理员', hint: '命中告警同时私聊主管理员一份' },
  { key: 'gban_enabled', label: '联合封禁', hint: '关闭后联封名单不再自动执行' },
  {
    key: 'antiad_rule_auto',
    label: 'AI 规则发现自动运行',
    hint: '每小时最多一次：出现现有规则覆盖不到的新广告时自动运行，会调用模型',
  },
]

type ModelWhich = 'so' | 'llm' | 'rule'

const SINGLE_MODELS: ReadonlySet<ModelWhich> = new Set(['rule'])

const MODEL_ROWS: { which: ModelWhich; key: string; label: string; hint: string }[] = [
  {
    which: 'so',
    key: 'antiad_so_models',
    label: '判定模型（systemone）',
    hint: '按重试顺序，逗号分隔；各 bot 未覆盖时使用',
  },
  {
    which: 'llm',
    key: 'antiad_llm_models',
    label: '复判模型（大模型）',
    hint: '按重试顺序，逗号分隔',
  },
  {
    which: 'rule',
    key: 'antiad_rule_model',
    label: '规则发现模型（AI 必封规则）',
    hint: '留空 = 复判模型列表里第一个 OpenAI 兼容模型',
  },
]

/** FieldLabel 抽屉里的字段标签（与 Input/Textarea 用 id 关联）。 */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="mt-3 mb-1 block first:mt-0">
      {children}
    </Label>
  )
}

/** FieldHint 字段下方的辅助说明（旧 TextField 的 helperText）。 */
function FieldHint({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[12px] leading-[1.6] text-muted-foreground">{children}</p>
}

/** SettingsSection 是设置主题折叠卡：卡头显示已设置项数，展开后渲染子行。 */
function SettingsSection({
  name,
  configured,
  children,
}: {
  name: string
  configured: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3 overflow-hidden rounded-xl bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[52px] w-full items-center gap-2 px-4 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-[1.4]">{name}</span>
          <span className="block text-[12px] leading-[1.4] text-muted-foreground">
            已设置 {configured} 项
          </span>
        </span>
        <ChevronDown
          className={`size-5 shrink-0 text-muted-foreground/60 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

export function SettingsPage() {
  const toast = useToast()
  const state = useMiniState(true)
  const setMut = useSetMutation()
  const toggleMut = useOptimisticMiniMutation('set')
  const digestMut = useDigestMutation()
  const runMut = useDigestMutation()

  const [modelEdit, setModelEdit] = useState<ModelWhich | null>(null)
  const [modelDraft, setModelDraft] = useState('')
  const [editingSpec, setEditingSpec] = useState<Spec | null>(null)
  const [specDraft, setSpecDraft] = useState('')
  const [tzOpen, setTzOpen] = useState(false)
  const [tzDraft, setTzDraft] = useState('')
  const [footerOpen, setFooterOpen] = useState(false)
  const [footerDraft, setFooterDraft] = useState('')
  const [digestOpen, setDigestOpen] = useState(false)
  const [digestDraft, setDigestDraft] = useState('')
  const [fixOpen, setFixOpen] = useState(false)
  const [fixDraft, setFixDraft] = useState('')
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [captchaField, setCaptchaField] = useState<string | null>(null)
  const [captchaDraft, setCaptchaDraft] = useState('')

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!state.data.me.main) return <ErrorState status={403} />

  const data = state.data
  const global = data.global ?? {}
  const enabledModels = (data.models ?? []).filter((m) => m.enabled)
  // 已设置只统计显式写过的键（settings 表里有行）；global 里的是代码默认值。
  const settingsSet = new Set(data.settings_set ?? [])

  /** toggleKey 是总开关与 spec 开关共用的乐观写：全局值只认字符串 '1'/'0'。 */
  function toggleKey(key: string, next: boolean) {
    const value = next ? '1' : '0'
    toggleMut.mutate(
      {
        body: { scope: 'global', key, value },
        apply: (s: State) => ({ ...s, global: { ...(s.global ?? {}), [key]: value } }),
      },
      {
        onSuccess: (resp) => toast(resp.note ?? '已保存'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function openModel(which: ModelWhich) {
    const row = MODEL_ROWS.find((r) => r.which === which)
    if (!row) return
    setModelDraft(
      SINGLE_MODELS.has(which) ? (global[row.key] ?? '') : parseModelList(global[row.key]),
    )
    setModelEdit(which)
  }

  function toggleModelChip(name: string) {
    if (modelEdit !== null && SINGLE_MODELS.has(modelEdit)) {
      setModelDraft(modelDraft.trim() === name ? '' : name)
      return
    }
    const list = modelDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const index = list.indexOf(name)
    if (index >= 0) list.splice(index, 1)
    else list.push(name)
    setModelDraft(list.join(', '))
  }

  function submitModel() {
    const row = MODEL_ROWS.find((r) => r.which === modelEdit)
    if (!row) return
    setMut.mutate(
      { scope: 'global', key: row.key, value: modelDraft.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setModelEdit(null)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function openSpec(spec: Spec) {
    setSpecDraft(global[spec.key] ?? '')
    setEditingSpec(spec)
  }

  function submitSpec() {
    if (!editingSpec) return
    const val = specDraft.trim()
    if (controlKind(editingSpec) !== 'text') {
      if (val === '') {
        toast('请输入取值；全局设置项不回退默认，请填一个合法整数')
        return
      }
      const invalid = validateSpecValue(editingSpec, val)
      if (invalid) {
        toast(invalid)
        return
      }
    }
    setMut.mutate(
      { scope: 'global', key: editingSpec.key, value: val },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setEditingSpec(null)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function stepSpec(delta: number) {
    if (!editingSpec) return
    const parsed = parseInt(specDraft, 10)
    const base = Number.isFinite(parsed) ? parsed : editingSpec.min
    let next = base + delta
    if (next < editingSpec.min) next = editingSpec.min
    if (editingSpec.max !== 0 && next > editingSpec.max) next = editingSpec.max
    setSpecDraft(String(next))
  }

  function submitTz() {
    const value = tzDraft.trim() || 'Asia/Shanghai'
    setMut.mutate(
      { scope: 'global', key: 'tz_name', value },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setTzOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function submitFooter() {
    setMut.mutate(
      { scope: 'global', key: 'antiad_group_footer', value: footerDraft.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setFooterOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  /** CAPTCHA_FIELDS 是入群验证的四个字符串型设置（settings 表）。 */
  const CAPTCHA_FIELDS: Record<string, { label: string; hint: string }> = {
    captcha_provider: {
      label: '入群验证提供方',
      hint: 'turnstile / hcaptcha / cap（cap 内置无需密钥）；填 - 关闭入群验证',
    },
    captcha_site_key: { label: '入群验证 Site Key', hint: '域名白名单须含本站主机名；填 - 清空' },
    captcha_secret: { label: '入群验证 Secret', hint: '与 site key 配对的服务端密钥；填 - 清空' },
    captcha_demo_keys: {
      label: '测试台密钥',
      hint: '形如 turnstile=site_key,secret;hcaptcha=site_key,secret；填 - 清空',
    },
  }

  /** openCaptcha 打开入群验证字段抽屉；secret 不回显，每次都从空输入。 */
  function openCaptcha(field: string) {
    setCaptchaField(field)
    setCaptchaDraft(field === 'captcha_secret' ? '' : (global[field] ?? ''))
    setCaptchaOpen(true)
  }

  function submitCaptcha() {
    if (!captchaField) return
    setMut.mutate(
      { scope: 'global', key: captchaField, value: captchaDraft.trim() },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setCaptchaOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function saveDigest() {
    digestMut.mutate(
      { action: 'save', value: digestDraft },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存')
          setDigestOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function saveFix() {
    digestMut.mutate(
      { action: 'save_fix', value: fixDraft },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已保存修正文本')
          setFixOpen(false)
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function runDigest() {
    runMut.mutate(
      { action: 'run' },
      {
        onSuccess: (resp) => toast(resp.note ?? '已触发重新总结'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const editingIsToggle = editingSpec !== null && controlKind(editingSpec) === 'toggle'
  const editingIsMinutes = editingSpec !== null && editingSpec.key.endsWith('_minutes')
  const stepSize = editingSpec !== null && editingSpec.key.endsWith('_ms') ? 100 : 1
  const presetSelected = (value: number) => {
    if (specDraft.trim() === '') return false
    const n = Number(specDraft)
    return Number.isFinite(n) && n === value
  }

  function specRow(spec: Spec) {
    const raw = global[spec.key] ?? ''
    if (controlKind(spec) === 'toggle') {
      return (
        <SwitchRow
          key={spec.key}
          primary={spec.label}
          secondary={specHint(spec)}
          checked={raw === '1'}
          disabled={toggleMut.isPending}
          onChange={(next) => toggleKey(spec.key, next)}
        />
      )
    }
    return (
      <ListRow
        key={spec.key}
        primary={spec.label}
        secondary={specHint(spec)}
        value={raw === '' ? '未设置' : specValueText(raw, spec)}
        trailing={
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openSpec(spec)}>
            编辑
          </Button>
        }
      />
    )
  }

  const modelDisplay = (which: ModelWhich, key: string): string => {
    if (SINGLE_MODELS.has(which)) return global[key] || '未设置'
    return parseModelList(global[key]) || '未设置'
  }

  const editingModelRow = MODEL_ROWS.find((r) => r.which === modelEdit)

  return (
    <div data-testid="settings-page">
      <SectionCard title="总开关">
        {MASTER_TOGGLES.map((t) => (
          <SwitchRow
            key={t.key}
            primary={t.label}
            secondary={t.hint}
            checked={global[t.key] === '1'}
            disabled={toggleMut.isPending}
            onChange={(next) => toggleKey(t.key, next)}
          />
        ))}
      </SectionCard>

      <LocalModelsCard />

      <SectionCard title="默认模型">
        {MODEL_ROWS.map((row) => (
          <SettingRow
            key={row.key}
            label={row.label}
            hint={row.hint}
            value={modelDisplay(row.which, row.key)}
            onClick={() => openModel(row.which)}
          />
        ))}
        <div className="px-4 py-3">
          <p className="text-[12px] leading-[1.7] text-muted-foreground">
            模型必须是「模型定价」里已登记且启用的；判定与复判列表按重试顺序排列。
          </p>
        </div>
      </SectionCard>

      <h2 className="mt-0 mb-1.5 pl-2 text-[13px] font-medium text-muted-foreground">
        全局参数（各 bot 未覆盖时使用）
      </h2>
      {data.sections.map((sec) => (
        <SettingsSection
          key={sec.name}
          name={sec.name}
          configured={sec.specs.filter((sp) => settingsSet.has(sp.key)).length}
        >
          {sec.specs.map((sp) => specRow(sp))}
        </SettingsSection>
      ))}

      <SectionCard title="展示时区">
        <SettingRow
          label="展示时区"
          hint="所有时间按它显示；IANA 时区名"
          value={global.tz_name || 'Asia/Shanghai'}
          onClick={() => {
            setTzDraft(global.tz_name || 'Asia/Shanghai')
            setTzOpen(true)
          }}
        />
      </SectionCard>

      <SectionCard title="群内提示附加链接">
        <SettingRow
          label="附加文本"
          hint="原样附在群内告警与进群限制通知的末尾；留空 = 不附加"
          value={global.antiad_group_footer || '未设置'}
          onClick={() => {
            setFooterDraft(global.antiad_group_footer ?? '')
            setFooterOpen(true)
          }}
        />
      </SectionCard>

      <SectionCard title="入群人机验证">
        <SwitchRow
          primary="人机验证测试台"
          secondary="开启后 <public_url>/_w/demo/1/x 可逐个测试各验证方式，/_w/apdemo/1/x 测申诉验证路径；仅测试用"
          checked={global.captcha_demo === '1'}
          disabled={toggleMut.isPending}
          onChange={(next) => toggleKey('captcha_demo', next)}
        />
        <SettingRow
          label="提供方"
          hint="turnstile / hcaptcha / cap（cap 内置，无需密钥）"
          value={global.captcha_provider || '未设置（入群验证关闭）'}
          onClick={() => openCaptcha('captcha_provider')}
        />
        <SettingRow
          label="Site Key"
          hint="turnstile / hcaptcha 需要配；cap 不需要"
          value={global.captcha_site_key || '未设置'}
          onClick={() => openCaptcha('captcha_site_key')}
        />
        <SettingRow
          label="Secret"
          hint="已设置时不回显，编辑即整体替换；填 - 清空"
          value={settingsSet.has('captcha_secret') ? '已设置' : '未设置'}
          onClick={() => openCaptcha('captcha_secret')}
        />
        <SettingRow
          label="测试台密钥"
          hint="测试台里 turnstile / hcaptcha 的密钥；cap 不需要"
          value={global.captcha_demo_keys || '未设置'}
          onClick={() => openCaptcha('captcha_demo_keys')}
        />
        {global.captcha_demo === '1' && (
          <SettingRow
            label="打开人机验证测试台"
            hint={`在新窗口打开 ${CAPTCHA_DEMO_PATH}，逐个完成各验证方式`}
            value="新窗口 ↗"
            onClick={() => window.open(CAPTCHA_DEMO_PATH, '_blank', 'noopener')}
          />
        )}
      </SectionCard>

      <SectionCard title="形态摘要">
        <div className="px-4 py-3">
          <p
            className={`text-sm leading-[1.7] whitespace-pre-wrap ${
              data.digest ? '' : 'text-muted-foreground'
            }`}
          >
            {data.digest || '（还没有摘要；点「立即重新总结」生成）'}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDigestDraft(data.digest ?? '')
                setDigestOpen(true)
              }}
            >
              编辑摘要
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={runMut.isPending}
              onClick={runDigest}
            >
              立即重新总结
            </Button>
          </div>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted-foreground">
            摘要随每条群消息发给判定模型；越长越准也越贵。
          </p>
        </div>
      </SectionCard>

      <SectionCard title="修正文本">
        <div className="px-4 py-3">
          <p
            className={`text-sm leading-[1.7] whitespace-pre-wrap ${
              data.digest_fix ? '' : 'text-muted-foreground'
            }`}
          >
            {data.digest_fix || '（未设置）'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setFixDraft(data.digest_fix ?? '')
              setFixOpen(true)
            }}
          >
            编辑修正文本
          </Button>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted-foreground">
            写给总结模型的口径说明，每轮重新总结都会附上它；不改摘要正文，想让它立刻生效请点摘要卡的「立即重新总结」。
          </p>
        </div>
      </SectionCard>

      <FormDrawer
        open={modelEdit !== null}
        onClose={() => setModelEdit(null)}
        title={editingModelRow?.label ?? '默认模型'}
        pending={setMut.isPending}
        submitText="保存"
        onSubmit={submitModel}
      >
        {modelEdit !== null && SINGLE_MODELS.has(modelEdit) ? (
          <>
            <FieldLabel htmlFor="model-single">模型名</FieldLabel>
            <Input
              id="model-single"
              placeholder="如 demo/gpt-5-mini"
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
            />
            <FieldHint>
              形如 上游名/模型ID；留空 = 复判模型列表里第一个 OpenAI 兼容模型
            </FieldHint>
          </>
        ) : (
          <>
            <FieldLabel htmlFor="model-list">模型列表（逗号分隔，按重试顺序）</FieldLabel>
            <Textarea
              id="model-list"
              rows={2}
              placeholder="如 demo/gpt-5-mini, demo/gpt-5"
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
            />
            <FieldHint>留空 = 清空，跟随内置默认</FieldHint>
          </>
        )}
        {enabledModels.length > 0 ? (
          <>
            <p className="mt-3 text-[13px] text-muted-foreground">
              已登记且启用的模型（点选加入/移出）
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {enabledModels.map((m) => {
                const picked =
                  modelEdit !== null && SINGLE_MODELS.has(modelEdit)
                    ? modelDraft.trim() === m.name
                    : modelDraft
                        .split(',')
                        .map((s) => s.trim())
                        .includes(m.name)
                return (
                  <Chip
                    key={m.name}
                    label={m.name}
                    selected={picked}
                    onClick={() => toggleModelChip(m.name)}
                  />
                )
              })}
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-muted-foreground">
            「模型定价」里还没有启用的模型，先去登记。
          </p>
        )}
      </FormDrawer>

      <FormDrawer
        open={editingSpec !== null}
        onClose={() => setEditingSpec(null)}
        title={editingSpec ? `设置：${editingSpec.label}` : ''}
        pending={setMut.isPending}
        submitText="保存"
        onSubmit={submitSpec}
      >
        {editingSpec !== null && (
          <>
            {editingIsToggle ? (
              <SwitchRow
                primary={editingSpec.label}
                secondary={specHint(editingSpec)}
                checked={specDraft === '1'}
                onChange={(next) => setSpecDraft(next ? '1' : '0')}
              />
            ) : controlKind(editingSpec) === 'text' ? (
              <>
                <FieldLabel htmlFor="spec-text">{editingSpec.label}</FieldLabel>
                <Input
                  id="spec-text"
                  value={specDraft}
                  onChange={(event) => setSpecDraft(event.target.value)}
                />
                <FieldHint>{specHint(editingSpec)}</FieldHint>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="减一"
                    onClick={() => stepSpec(-stepSize)}
                    className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <MinusCircle className="size-5" aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="spec-number" className="mb-1 block">
                      {editingSpec.label}
                    </Label>
                    <Input
                      id="spec-number"
                      inputMode="numeric"
                      value={specDraft}
                      onChange={(event) => setSpecDraft(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="加一"
                    onClick={() => stepSpec(stepSize)}
                    className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <PlusCircle className="size-5" aria-hidden />
                  </button>
                </div>
                <FieldHint>{specHint(editingSpec)}</FieldHint>
                {editingIsMinutes && minutePresets(editingSpec).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {minutePresets(editingSpec).map((preset) => {
                      const picked = presetSelected(preset.value)
                      return (
                        <Chip
                          key={preset.value}
                          label={preset.label}
                          selected={picked}
                          data-testid={`preset-${preset.value}`}
                          data-selected={picked ? 'true' : undefined}
                          onClick={() => setSpecDraft(String(preset.value))}
                        />
                      )
                    })}
                  </div>
                )}
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {specDraft.trim() === ''
                    ? '请输入取值；全局设置项不支持留空恢复默认。'
                    : `生效值：${specValueText(specDraft, editingSpec)}`}
                </p>
              </>
            )}
          </>
        )}
      </FormDrawer>

      <FormDrawer
        open={captchaOpen}
        onClose={() => setCaptchaOpen(false)}
        title={captchaField ? (CAPTCHA_FIELDS[captchaField]?.label ?? '入群验证') : '入群验证'}
        pending={setMut.isPending}
        submitText="保存"
        onSubmit={submitCaptcha}
      >
        {captchaField === 'captcha_provider' && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {['turnstile', 'hcaptcha', 'cap'].map((p) => (
              <Chip
                key={p}
                label={p}
                selected={captchaDraft.trim() === p}
                onClick={() => setCaptchaDraft(p)}
              />
            ))}
          </div>
        )}
        <FieldLabel htmlFor="captcha-value">
          {captchaField ? (CAPTCHA_FIELDS[captchaField]?.label ?? '') : ''}
        </FieldLabel>
        <Input
          id="captcha-value"
          value={captchaDraft}
          onChange={(event) => setCaptchaDraft(event.target.value)}
        />
        <FieldHint>{captchaField ? CAPTCHA_FIELDS[captchaField]?.hint : ''}</FieldHint>
      </FormDrawer>

      <FormDrawer
        open={tzOpen}
        onClose={() => setTzOpen(false)}
        title="展示时区"
        pending={setMut.isPending}
        submitText="保存"
        onSubmit={submitTz}
      >
        <div className="flex flex-wrap gap-1.5">
          {TIMEZONES.map((tz) => (
            <Chip
              key={tz}
              label={tz}
              selected={tzDraft.trim() === tz}
              onClick={() => setTzDraft(tz)}
            />
          ))}
        </div>
        <FieldLabel htmlFor="tz-custom">自定义 IANA 时区</FieldLabel>
        <Input
          id="tz-custom"
          placeholder="如 Asia/Shanghai"
          value={tzDraft}
          onChange={(event) => setTzDraft(event.target.value)}
        />
        <FieldHint>留空 = 恢复默认 Asia/Shanghai</FieldHint>
      </FormDrawer>

      <FormDrawer
        open={footerOpen}
        onClose={() => setFooterOpen(false)}
        title="群内提示附加链接"
        pending={setMut.isPending}
        submitText="保存"
        onSubmit={submitFooter}
      >
        <FieldLabel htmlFor="footer-text">附加文本</FieldLabel>
        <Textarea
          id="footer-text"
          rows={3}
          maxLength={300}
          placeholder="② 使用指南 (https://t.me/your_link)"
          value={footerDraft}
          onChange={(event) => setFooterDraft(event.target.value)}
        />
        <FieldHint>留空 = 不附加；上限 300 字</FieldHint>
      </FormDrawer>

      <FormDrawer
        open={digestOpen}
        onClose={() => setDigestOpen(false)}
        title="编辑形态摘要"
        pending={digestMut.isPending}
        submitText="保存摘要"
        onSubmit={saveDigest}
      >
        <FieldLabel htmlFor="digest-text">摘要正文</FieldLabel>
        <Textarea
          id="digest-text"
          rows={5}
          value={digestDraft}
          onChange={(event) => setDigestDraft(event.target.value)}
        />
        <FieldHint>随每条群消息发给判定模型；越长越准也越贵</FieldHint>
      </FormDrawer>

      <FormDrawer
        open={fixOpen}
        onClose={() => setFixOpen(false)}
        title="编辑修正文本"
        pending={digestMut.isPending}
        submitText="保存修正文本"
        onSubmit={saveFix}
      >
        <FieldLabel htmlFor="fix-text">修正文本</FieldLabel>
        <Textarea
          id="fix-text"
          rows={5}
          placeholder="例：技术讨论里出现的 GitHub、npm 链接不算广告；兼职招募一律按诈骗归类。"
          value={fixDraft}
          onChange={(event) => setFixDraft(event.target.value)}
        />
      </FormDrawer>
    </div>
  )
}
