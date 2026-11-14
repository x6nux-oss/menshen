// 人机验证演示页（_w/demo）：同一页展示并校验四家验证方式。
//
// 仅测试用（服务端 captcha_demo=1 才可用）。只显示各家的 site key；
// 校验走服务端与入群验证同一条路径，所以这里通过即代表那条路也通。
//
// Phase 4：展示层换到新设计系统（Tailwind + components/ui）。
// **验证链路一字未动** —— mountCaptcha / collectSignals / postJSON 的调用、
// 回调签名、验证码容器的 ref 与 data-testid 全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '../../components/ui'
import { getJSON, postJSON } from '../api'
import type { CaptchaDemoData, CaptchaDemoProvider, WebRoute } from '../api'
import { mountCaptcha } from '../captcha'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'

const PROVIDER_LABEL: Record<string, string> = {
  turnstile: 'Cloudflare Turnstile',
  hcaptcha: 'hCaptcha',
  cap: 'Cap（内置）',
}

export function CaptchaDemoPage({ route }: { route: WebRoute }) {
  const [data, setData] = useState<CaptchaDemoData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getJSON<CaptchaDemoData>(route.path + '?json=1')
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((err: unknown) => {
        if (alive) setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [route.path])

  if (error) return <InvalidState message={error} />
  if (!data) return <Placeholder />
  if (data.providers.length === 0)
    return <InvalidState message="演示页未配置任何验证方式（服务端 captcha_demo_keys 为空）。" />

  return (
    <div data-testid="captcha-demo">
      <h1 className="mb-1 text-xl font-bold">人机验证测试台</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        逐个完成下方验证，通过后服务端会向对应提供方核对并返回结果。
      </p>
      {data.providers.map((p) => (
        <ProviderCard key={p.provider} route={route} p={p} />
      ))}
    </div>
  )
}

function ProviderCard({ route, p }: { route: WebRoute; p: CaptchaDemoProvider }) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const doneRef = useRef(false)

  const submit = useCallback(
    async (token: string) => {
      if (doneRef.current) return
      doneRef.current = true
      setSubmitting(true)
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
          provider: p.provider,
          token,
          signals,
        })
        setResult({ ok: resp.ok, msg: resp.msg })
      } catch (err) {
        setResult({ ok: false, msg: errorText(err) })
      } finally {
        setSubmitting(false)
      }
    },
    [route.path, p.provider],
  )

  return (
    <div className="mb-4 rounded-lg bg-card p-4 text-card-foreground">
      <p className="text-[15px] font-bold">{PROVIDER_LABEL[p.provider] ?? p.provider}</p>
      <CaptchaWidget p={p} onToken={submit} />
      <p className="text-[12px] break-all text-muted-foreground">
        site key：{p.sitekey}
        {p.endpoint ? ` · 端点：${p.endpoint}` : ''}
      </p>
      {submitting && (
        <div className="mt-2 flex items-center gap-2">
          <Spinner size={14} />
          <span className="text-[13px]">正在校验…</span>
        </div>
      )}
      {result && (
        <p className={result.ok ? 'mt-2 text-[13.5px] text-success' : 'mt-2 text-[13.5px] text-destructive'}>
          {result.ok ? '✅ ' : '❌ '}
          {result.msg}
        </p>
      )}
    </div>
  )
}

/** CaptchaWidget 按提供方挂载组件，卸载时清理。 */
function CaptchaWidget({
  p,
  onToken,
}: {
  p: CaptchaDemoProvider
  onToken: (token: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    return mountCaptcha(ref.current, {
      provider: p.provider,
      sitekey: p.sitekey,
      endpoint: p.endpoint,
      onToken,
    })
  }, [p.provider, p.sitekey, p.endpoint, onToken])
  return <div ref={ref} data-testid={`captcha-${p.provider}`} className="my-3" />
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
