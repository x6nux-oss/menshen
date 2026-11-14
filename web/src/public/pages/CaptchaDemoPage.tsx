// 人机验证演示页（_w/demo）：同一页展示并校验四家验证方式。
//
// 仅测试用（服务端 captcha_demo=1 才可用）。只显示各家的 site key；
// 校验走服务端与入群验证同一条路径，所以这里通过即代表那条路也通。
//
// **验证链路保持不变** —— mountCaptcha / collectSignals / postJSON 的调用、
// 回调签名、验证码容器的 ref 与 data-testid 全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, FlaskConical, TriangleAlert } from 'lucide-react'
import { Spinner } from '../../components/ui'
import { getJSON, postJSON } from '../api'
import type { CaptchaDemoData, CaptchaDemoProvider, WebRoute } from '../api'
import { mountCaptcha } from '../captcha'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { PageHeader, SectionCard } from '../ui'

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
      .then((response) => {
        if (alive) setData(response)
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
    <div data-testid="captcha-demo" className="space-y-4">
      <PageHeader
        title="人机验证测试台"
        description="逐个完成下方验证，通过后服务端会向对应提供方核对并返回结果。"
      />
      {data.providers.map((provider) => (
        <ProviderCard key={provider.provider} route={route} provider={provider} />
      ))}
    </div>
  )
}

function ProviderCard({
  route,
  provider,
}: {
  route: WebRoute
  provider: CaptchaDemoProvider
}) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const doneRef = useRef(false)

  const submit = useCallback(
    async (token: string) => {
      if (doneRef.current) return
      doneRef.current = true
      setSubmitting(true)
      let passed = false
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
          provider: provider.provider,
          token,
          signals,
        })
        passed = resp.ok
        setResult({ ok: resp.ok, msg: resp.msg })
      } catch (err) {
        setResult({ ok: false, msg: errorText(err) })
      } finally {
        doneRef.current = passed
        setSubmitting(false)
      }
    },
    [route.path, provider.provider],
  )

  const retry = () => {
    setResult(null)
    doneRef.current = false
    setAttempt((count) => count + 1)
  }

  return (
    <SectionCard
      icon={<FlaskConical />}
      title={PROVIDER_LABEL[provider.provider] ?? provider.provider}
    >
      <div className="rounded-md border border-border bg-muted/50 p-3">
        <CaptchaWidget key={attempt} provider={provider} onToken={submit} />
      </div>
      <p className="text-[12px] break-all text-muted-foreground">
        site key：{provider.sitekey}
        {provider.endpoint ? ` · 端点：${provider.endpoint}` : ''}
      </p>
      {submitting && (
        <div className="mt-2 flex items-center gap-2">
          <Spinner size={14} />
          <span className="text-[13px]">正在校验…</span>
        </div>
      )}
      {result && (
        <div
          role={result.ok ? 'status' : 'alert'}
          className={`mt-3 flex items-start gap-2 text-[14px] leading-6 ${
            result.ok ? 'text-success' : 'text-destructive'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 aria-hidden className="mt-1 size-4 shrink-0" />
          ) : (
            <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="break-words">{result.msg}</p>
            {!result.ok && (
              <button
                type="button"
                onClick={retry}
                className="mt-1 text-[13px] font-medium underline underline-offset-4"
              >
                重新校验
              </button>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

/** CaptchaWidget 按提供方挂载组件，卸载时清理。 */
function CaptchaWidget({
  provider,
  onToken,
}: {
  provider: CaptchaDemoProvider
  onToken: (token: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    return mountCaptcha(ref.current, {
      provider: provider.provider,
      sitekey: provider.sitekey,
      endpoint: provider.endpoint,
      onToken,
    })
  }, [provider.provider, provider.sitekey, provider.endpoint, onToken])
  return <div ref={ref} data-testid={`captcha-${provider.provider}`} className="my-3" />
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
