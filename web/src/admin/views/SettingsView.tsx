// oxlint-disable react/set-state-in-effect -- 草稿态需要跟随服务端返回的值重置（保存后刷新）。
// 全局设置（主管理员）：总开关、默认模型、分组参数、时区、页脚、人机验证、摘要。
import { useEffect, useState } from 'react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from '../../components/ui'
import { useDigestMutation, useSetMutation } from '../../api/mutations'
import { useMiniState } from '../../api/hooks'
import { LocalModelsCard } from '../../components/mobile'
import { CAPTCHA_DEMO_PATH, controlKind, specHint, specUnit, specValueText, validateSpecValue } from '../../lib/settings'
import { openLink } from '../../telegram'
import { CardBlock, PageHeader } from '../components'
import { useRunFeedback } from '../feedback'
import type { Spec } from '../../api/types'

/** NOT_SET 是「未启用」提供方在下拉里的哨兵（Base UI Select 用 null 表示未选中）。 */
const NOT_SET = '__none__'

const MASTER_TOGGLES: { key: string; label: string; hint: string }[] = [
  { key: 'antiad_enabled', label: '反广告总开关', hint: '关闭后所有群都不判定。' },
  { key: 'gban_enabled', label: '联合封禁', hint: '关闭后联封名单不生效。' },
  { key: 'alert_copy_main', label: '私聊告警抄送', hint: '把命中与失败告警发给全部主管理员。' },
  { key: 'antiad_rule_auto', label: '规则发现自动运行', hint: '每小时最多自动跑一轮，只在新广告未被覆盖时才启动。' },
  { key: 'captcha_demo', label: '人机验证测试台', hint: '在「我的」露出测试台入口。' },
]

const MODEL_KEYS: { key: string; label: string; hint: string }[] = [
  { key: 'antiad_so_models', label: '初判模型（systemone）', hint: '逗号分隔的有序列表，重试按顺序轮换。' },
  { key: 'antiad_llm_models', label: '复判模型（llm）', hint: '逗号分隔的有序列表。' },
  { key: 'antiad_rule_model', label: '规则发现模型', hint: '留空用回退模型。' },
]

const CAPTCHA_PROVIDERS = [
  { value: '', label: '未启用' },
  { value: 'turnstile', label: 'Turnstile' },
  { value: 'hcaptcha', label: 'hCaptcha' },
  { value: 'cap', label: '内置 Cap' },
]

const NAV_SECTIONS = [
  { id: 'settings-controls', label: '运行开关', hint: '总开关与告警' },
  { id: 'settings-local-models', label: '本地模型', hint: 'OCR / NSFW' },
  { id: 'settings-models', label: '模型路由', hint: '判定与复判' },
  { id: 'settings-display', label: '展示与落地', hint: '时区与页脚' },
  { id: 'settings-captcha', label: '人机验证', hint: '入群校验' },
  { id: 'settings-digest', label: '摘要与文案', hint: '形态摘要' },
] as const

export function SettingsView() {
  const state = useMiniState(true)
  if (!state.data) return null
  if (!state.data.me.main || !state.data.global) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">全局设置只对主管理员开放。</span>
      </CardBlock>
    )
  }
  const { global, sections, specs, digest, digest_fix, tz_name, settings_set } = state.data
  return (
    <SettingsBody
      global={global}
      sections={sections}
      specs={specs}
      digest={digest ?? ''}
      digestFix={digest_fix ?? ''}
      tz={tz_name ?? global.tz_name ?? ''}
      settingsSet={settings_set ?? []}
    />
  )
}

function SettingsBody({
  global,
  sections,
  specs,
  digest,
  digestFix,
  tz,
  settingsSet,
}: {
  global: Record<string, string>
  sections: { name: string; specs: Spec[] }[]
  specs: Spec[]
  digest: string
  digestFix: string
  tz: string
  settingsSet: string[]
}) {
  const setMut = useSetMutation()
  const digestMut = useDigestMutation()
  const run = useRunFeedback()
  const set = (key: string, value: string, okText = '已保存') =>
    run(setMut.mutateAsync({ scope: 'global', key, value }), okText)

  const specByKey = new Map(specs.map((s) => [s.key, s]))

  return (
    <>
      <PageHeader
        title="全局设置"
        subtitle="默认模型、护栏参数与人机验证 · 只对主管理员可见"
      />
      <div className="grid items-start gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav
          aria-label="设置分区"
          className="sticky top-20 hidden rounded-xl border border-border bg-card p-1.5 lg:block"
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground">
            设置目录
          </p>
          <div className="grid gap-0.5">
            {NAV_SECTIONS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="group rounded-md px-2.5 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className="block text-[13px] font-medium text-foreground">{item.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{item.hint}</span>
              </a>
            ))}
            {sections.map((section) => (
              <a
                key={section.name}
                href={`#settings-${slug(section.name)}`}
                className="group rounded-md px-2.5 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className="block text-[13px] font-medium text-foreground">{section.name}</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {section.specs.filter((s) => settingsSet.includes(s.key)).length} / {section.specs.length} 项已设置
                </span>
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <section id="settings-controls" className="scroll-mt-20">
            <CardBlock title="总开关">
              <div className="divide-y divide-border">
                {MASTER_TOGGLES.filter((t) => global[t.key] !== undefined).map((t) => (
                  <div key={t.key} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex-1">
                      <div className="text-[13.5px] font-medium">{t.label}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">{t.hint}</div>
                    </div>
                    <Switch
                      checked={global[t.key] === '1'}
                      disabled={setMut.isPending}
                      aria-label={t.label}
                      onCheckedChange={(checked) => set(t.key, checked ? '1' : '0', '已更新')}
                    />
                  </div>
                ))}
              </div>
            </CardBlock>
          </section>

          <section id="settings-local-models" className="scroll-mt-20">
            <LocalModelsCard />
          </section>

          <section id="settings-models" className="scroll-mt-20">
            <CardBlock title="模型路由">
              <div className="divide-y divide-border">
                {MODEL_KEYS.map((m) => (
                  <SettingText
                    key={m.key}
                    label={m.label}
                    hint={m.hint}
                    value={global[m.key] ?? ''}
                    onSave={(v) => set(m.key, v)}
                  />
                ))}
              </div>
            </CardBlock>
          </section>

          <section id="settings-display" className="scroll-mt-20">
            <CardBlock title="展示与落地">
              <div className="divide-y divide-border">
                <SettingText
                  label="展示时区（IANA）"
                  hint="留空回退 Asia/Shanghai。"
                  value={tz}
                  onSave={(v) => set('tz_name', v.trim() || 'Asia/Shanghai')}
                />
                {specByKey.has('antiad_group_footer') && (
                  <SettingText
                    label="群内页脚"
                    hint="群内处置消息附带的说明文案。"
                    value={global.antiad_group_footer ?? ''}
                    onSave={(v) => set('antiad_group_footer', v)}
                  />
                )}
              </div>
            </CardBlock>
          </section>

          <section id="settings-captcha" className="scroll-mt-20">
            <CardBlock
              title="人机验证"
              actions={
                global.captcha_demo === '1' ? (
                  <Button size="sm" variant="ghost" onClick={() => openLink(CAPTCHA_DEMO_PATH)}>
                    打开测试台
                  </Button>
                ) : undefined
              }
            >
              <div className="grid max-w-[620px] gap-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="captcha-provider">提供方</Label>
                  <Select
                    value={global.captcha_provider === undefined || global.captcha_provider === '' ? NOT_SET : global.captcha_provider}
                    disabled={setMut.isPending}
                    onValueChange={(v) => set('captcha_provider', v === NOT_SET ? '' : v, '已更新')}
                  >
                    <SelectTrigger id="captcha-provider" aria-label="提供方" className="max-w-[260px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPTCHA_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value === '' ? NOT_SET : p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="divide-y divide-border">
                  <SettingText label="Site key" hint="前端公钥。" value={global.captcha_site_key ?? ''} onSave={(v) => set('captcha_site_key', v)} />
                  <SettingText
                    label="Secret"
                    hint={settingsSet.includes('captcha_secret') ? '已设置；留空保存表示清空。' : '服务端密钥，尚未设置。'}
                    value=""
                    placeholder="留空不修改"
                    onSave={(v) => (v === '' ? undefined : set('captcha_secret', v))}
                  />
                  <SettingText label="测试台密钥组" hint="演示页可一次展示多家：provider=key 逗号分隔。" value={global.captcha_demo_keys ?? ''} onSave={(v) => set('captcha_demo_keys', v)} />
                </div>
              </div>
            </CardBlock>
          </section>

          {sections.map((section) => (
            <section key={section.name} id={`settings-${slug(section.name)}`} className="scroll-mt-20">
              <CardBlock
                title={`${section.name}（已设置 ${section.specs.filter((s) => settingsSet.includes(s.key)).length} 项）`}
              >
                <div className="divide-y divide-border">
                  {section.specs.map((spec) => (
                    <SpecControl
                      key={spec.key}
                      spec={spec}
                      value={global[spec.key] ?? ''}
                      disabled={setMut.isPending}
                      onSave={(v) => set(spec.key, v)}
                    />
                  ))}
                </div>
              </CardBlock>
            </section>
          ))}

          <section id="settings-digest" className="scroll-mt-20">
            <CardBlock title="摘要与修复文案">
              <div className="grid gap-4">
                <MultilineSetting
                  label="形态摘要"
                  value={digest}
                  onSave={(v) => run(digestMut.mutateAsync({ action: 'save', value: v }), '已保存')}
                />
                <MultilineSetting
                  label="修复建议文案"
                  value={digestFix}
                  onSave={(v) => run(digestMut.mutateAsync({ action: 'save_fix', value: v }), '已保存')}
                />
                <div>
                  <Button variant="outline" disabled={digestMut.isPending} onClick={() => run(digestMut.mutateAsync({ action: 'run' }), '已开始重跑')}>
                    立即重跑摘要
                  </Button>
                </div>
              </div>
            </CardBlock>
          </section>
        </div>
      </div>
    </>
  )
}

function slug(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
}

function SettingText({
  label,
  hint,
  value,
  placeholder,
  onSave,
}: {
  label: string
  hint: string
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] md:items-start md:gap-6">
      <div className="min-w-0">
        <Label htmlFor={`setting-${label}`} className="text-[13.5px] font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-start gap-1.5">
        <Input
          id={`setting-${label}`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9"
        />
        <Button
          size="sm"
          variant={draft === value ? 'ghost' : 'outline'}
          className="h-9 shrink-0"
          disabled={draft === value}
          onClick={() => onSave(draft)}
        >
          保存
        </Button>
      </div>
    </div>
  )
}

function MultilineSetting({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="grid gap-2">
      <div>
        <Label htmlFor={`multi-${label}`} className="text-[13.5px] font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-[12px] text-muted-foreground">按群最近形态自动生成，可人工修订。</p>
      </div>
      <Textarea id={`multi-${label}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} />
      <div>
        <Button size="sm" variant="outline" disabled={draft === value} onClick={() => onSave(draft)}>
          保存
        </Button>
      </div>
    </div>
  )
}

function SpecControl({
  spec,
  value,
  disabled,
  onSave,
}: {
  spec: Spec
  value: string
  disabled: boolean
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDraft(value), [value])
  const kind = controlKind(spec)

  if (kind === 'toggle') {
    return (
      <div className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
        <div className="flex-1">
          <div className="text-[13.5px] font-medium">{spec.label}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{specHint(spec)}</div>
        </div>
        <Switch
          checked={draft === '1'}
          disabled={disabled}
          aria-label={spec.label}
          onCheckedChange={(checked) => onSave(checked ? '1' : '0')}
        />
      </div>
    )
  }

  const commit = () => {
    const err = validateSpecValue(spec, draft)
    if (err) {
      setError(err)
      return
    }
    if (draft.trim() === '') {
      setError('全局设置不能留空')
      return
    }
    setError(null)
    if (draft.trim() === value) return
    onSave(draft.trim())
  }

  const unit = specUnit(spec)

  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_240px] md:items-start md:gap-6">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{spec.label}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{specHint(spec)}</div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Input
            className="h-9"
            value={draft}
            disabled={disabled}
            aria-invalid={error !== null || undefined}
            aria-label={spec.label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
          />
          {unit && <span className="shrink-0 text-[12px] text-muted-foreground">{unit}</span>}
        </div>
        {error !== null ? (
          <span className="text-[12px] text-destructive">{error}</span>
        ) : draft !== '' ? (
          <span className="text-[12px] text-muted-foreground">{specValueText(draft, spec)}</span>
        ) : null}
      </div>
    </div>
  )
}
