// 申诉验证测试台（_w/apdemo）：用申诉页同一条校验路径做真机自测。
//
// 与人机验证测试台（_w/demo）同一套约定：仅 captcha_demo=1 时可用；
// 页面只含 site key（公开信息），校验走服务端与申诉页同一条
// verifyTurnstile——config 的 Turnstile 密钥、action / cdata / hostname
// 全部照查，所以这里通过即代表申诉那条路也通。申诉页只回一句
// `验证未通过`，密钥、域名白名单或 cdata 绑定出了问题，具体原因
// 全靠这页显示。
//
// Phase 4：展示层换到新设计系统（Tailwind + components/ui）。
// **验证链路一字未动** —— collectSignals / postJSON 的调用、回调签名、
// TurnstileWidget 的 props 全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { getJSON, postJSON } from '../api'
import type { AppealDemoData, WebRoute } from '../api'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { TurnstileWidget } from '../TurnstileWidget'

export function AppealDemoPage({ route }: { route: WebRoute }) {
  const [data, setData] = useState<AppealDemoData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getJSON<AppealDemoData>(route.path + '?json=1')
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
  if (!data.sitekey)
    return (
      <InvalidState message="服务端未配置申诉验证的 Turnstile 密钥（config.yaml 的 turnstile_site_key / turnstile_secret）。" />
    )

  return (
    <div data-testid="appeal-demo">
      <h1 className="mb-1 text-xl font-bold">申诉验证测试台</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        与用户申诉页同一条校验路径（action=appeal、cdata 绑定、hostname 核对），
        通过即代表申诉验证也通；失败原因会显示在下方。
      </p>
      <div className="rounded-lg bg-card p-4 text-card-foreground">
        <p className="text-[15px] font-bold">Cloudflare Turnstile</p>
        <DemoCard route={route} sitekey={data.sitekey} cdata={data.cdata} />
      </div>
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
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
          token,
          signals,
        })
        setResult(resp)
      } catch (err) {
        setResult({ ok: false, msg: errorText(err) })
      } finally {
        busyRef.current = false
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
    setResetKey((k) => k + 1)
  }, [])

  return (
    <>
      <TurnstileWidget
        sitekey={sitekey}
        cdata={cdata}
        resetKey={resetKey}
        onToken={onToken}
        onError={onError}
      />
      <p className="text-[12px] break-all text-muted-foreground">
        site key：{sitekey} · cdata：{cdata}
      </p>
      {submitting && (
        <div className="mt-2 flex items-center gap-2">
          <Spinner size={14} />
          <span className="text-[13px]">正在校验…</span>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <p className={result.ok ? 'text-[13.5px] text-success' : 'text-[13.5px] text-destructive'}>
            {result.ok ? '✅ ' : '❌ '}
            {result.msg}
          </p>
          {!result.ok && (
            <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
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
