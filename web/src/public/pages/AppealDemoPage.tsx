// 申诉验证测试台（_w/apdemo）：用申诉页同一条校验路径做真机自测。
//
// 与人机验证测试台（_w/demo）同一套约定：仅 captcha_demo=1 时可用；
// 页面只含 site key（公开信息），校验走服务端与申诉页同一条
// verifyTurnstile——config 的 Turnstile 密钥、action / cdata / hostname
// 全部照查，所以这里通过即代表申诉那条路也通。申诉页只回一句
// `验证未通过`，密钥、域名白名单或 cdata 绑定出了问题，具体原因
// 全靠这页显示。
//
// **验证链路保持不变** —— collectSignals / postJSON 的调用、回调签名、
// TurnstileWidget 的 props 全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, FlaskConical, TriangleAlert } from 'lucide-react'
import { Button, Spinner } from '../../components/ui'
import { getJSON, postJSON } from '../api'
import type { AppealDemoData, WebRoute } from '../api'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { TurnstileWidget } from '../TurnstileWidget'
import { PageHeader, SectionCard } from '../ui'

export function AppealDemoPage({ route }: { route: WebRoute }) {
  const [data, setData] = useState<AppealDemoData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getJSON<AppealDemoData>(route.path + '?json=1')
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
  if (!data.sitekey)
    return (
      <InvalidState message="服务端未配置申诉验证的 Turnstile 密钥（config.yaml 的 turnstile_site_key / turnstile_secret）。" />
    )

  return (
    <div data-testid="appeal-demo" className="space-y-4">
      <PageHeader
        title="申诉验证测试台"
        description="与用户申诉页同一条校验路径（action=appeal、cdata 绑定、hostname 核对），通过即代表申诉验证也通。"
      />
      <SectionCard icon={<FlaskConical />} title="Cloudflare Turnstile">
        <DemoCard route={route} sitekey={data.sitekey} cdata={data.cdata} />
      </SectionCard>
    </div>
  )
}

function DemoCard({
  route,
  sitekey,
  cdata,
}: {
  route: WebRoute
  sitekey: string
  cdata: string
}) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const busyRef = useRef(false)

  const submit = useCallback(
    async (token: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setSubmitting(true)
      let passed = false
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
          token,
          signals,
        })
        passed = resp.ok
        setResult(resp)
      } catch (err) {
        setResult({ ok: false, msg: errorText(err) })
      } finally {
        busyRef.current = passed
        setSubmitting(false)
      }
    },
    [route.path],
  )

  const onToken = useCallback((token: string) => void submit(token), [submit])
  const onError = useCallback((msg: string) => {
    setResult((prev) => (prev?.ok ? prev : { ok: false, msg }))
  }, [])
  const retry = useCallback(() => {
    setResult(null)
    setResetKey((current) => current + 1)
  }, [])

  return (
    <>
      {!result?.ok && (
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <TurnstileWidget
            sitekey={sitekey}
            cdata={cdata}
            resetKey={resetKey}
            onToken={onToken}
            onError={onError}
          />
        </div>
      )}
      <p className="mt-3 text-[12px] break-all text-muted-foreground">
        site key：{sitekey} · cdata：{cdata}
      </p>
      {submitting && (
        <div className="mt-3 flex items-center gap-2">
          <Spinner size={14} />
          <span className="text-[13px]">正在校验…</span>
        </div>
      )}
      {result && (
        <div
          role={result.ok ? 'status' : 'alert'}
          className={`mt-4 rounded-md border p-4 ${
            result.ok ? 'border-success/40 bg-success/8' : 'border-destructive/35 bg-destructive/6'
          }`}
        >
          <div className="flex gap-3">
            {result.ok ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
            ) : (
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
            )}
            <div className="min-w-0">
              <p
                className={`text-[14px] font-semibold ${
                  result.ok ? 'text-success' : 'text-destructive'
                }`}
              >
                {result.ok ? '校验通过' : '校验未通过'}
              </p>
              <p className="mt-1 text-[14px] leading-6 break-words">{result.msg}</p>
            </div>
          </div>
          {!result.ok && (
            <Button size="sm" variant="outline" className="mt-3 ml-8" onClick={retry}>
              重试验证
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
