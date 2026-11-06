// 入群验证页（_w/jv/<id>/<sig>）：新人进群后的自助门槛。
//
// 页面加载时取回提供方与 sitekey，渲染对应的验证码组件；拿到 token 后
// 连同浏览器特征提交，服务端向提供方核对通过即解除禁言。
//
// Phase 4：展示层换到新设计系统（Tailwind + components/ui）。
// **验证链路一字未动** —— mountCaptcha / collectSignals / postJSON 的调用、
// 回调签名、验证码容器的 ref 与 data-testid 全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import { getJSON, postJSON } from '../api'
import type { JoinVerifyData, WebRoute } from '../api'
import { mountCaptcha } from '../captcha'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'

const PROVIDER_LABEL: Record<string, string> = {
  turnstile: 'Cloudflare Turnstile',
  hcaptcha: 'hCaptcha',
  cap: 'Cap',
}

export function JoinVerifyPage({ route }: { route: WebRoute }) {
  const [data, setData] = useState<JoinVerifyData | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const doneRef = useRef(false)

  useEffect(() => {
    let alive = true
    getJSON<JoinVerifyData>(route.path + '?json=1')
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

  const submit = useCallback(
    async (token: string) => {
      // 组件可能在重试时重复回调；一次提交已经有结论就不再重复提交。
      if (doneRef.current) return
      doneRef.current = true
      setSubmitting(true)
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
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
    [route.path],
  )

  if (error) return <InvalidState message={error} />
  if (!data) return <Placeholder />
  if (data.status !== 'pending')
    return <InvalidState message="这张验证已经完成或已失效，请重新加入群聊。" />
  if (!data.provider || !data.sitekey)
    return <InvalidState message="本群未配置人机验证，请联系群管理员。" />

  return (
    <div data-testid="join-verify">
      <div className="mb-4 rounded-lg bg-card p-4 text-card-foreground">
        <p className="mb-2 text-[18px] font-bold">
          {data.chat ? (
            <>
              加入「
              <ChatRef name={data.chat} url={data.chat_url} />
              」
            </>
          ) : (
            '入群验证'
          )}
        </p>
        <p className="text-sm leading-[1.8]">
          为防广告机器人，请先完成人机验证。通过后即可在群里发言；
          {data.minutes > 0
            ? `请在 ${data.minutes} 分钟内完成，否则会被移出群聊（可重新加入）。`
            : '未通过验证前无法发言。'}
        </p>
      </div>

      <div className="rounded-lg bg-card p-4 text-card-foreground">
        <p className="mb-3 text-[15px] font-bold">
          人机验证 · {PROVIDER_LABEL[data.provider] ?? data.provider}
        </p>
        <CaptchaWidget data={data} onToken={submit} />
        <p className="mt-2 text-[13px] text-muted-foreground">
          验证组件加载不出来时，请用系统浏览器打开本页。
        </p>
        <ResultArea submitting={submitting} result={result} />
      </div>

      <p className="mt-4 text-[12px] leading-[1.7] text-muted-foreground">
        本页会记录你的 IP 与浏览器特征，仅用于反垃圾审核。
      </p>
    </div>
  )
}

/** CaptchaWidget 按提供方挂载验证码组件，卸载时清理。 */
function CaptchaWidget({
  data,
  onToken,
}: {
  data: JoinVerifyData
  onToken: (token: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    return mountCaptcha(ref.current, {
      provider: data.provider,
      sitekey: data.sitekey,
      endpoint: data.endpoint,
      onToken,
    })
  }, [data.provider, data.sitekey, data.endpoint, onToken])
  return <div ref={ref} data-testid="captcha" className="my-2" />
}

function ResultArea({
  submitting,
  result,
}: {
  submitting: boolean
  result: { ok: boolean; msg: string } | null
}) {
  if (submitting)
    return (
      <div className="mt-3 flex items-center gap-2">
        <Spinner size={16} />
        <p className="text-sm">正在验证…</p>
      </div>
    )
  if (!result) return null
  return (
    <p className={`mt-3 text-sm ${result.ok ? 'text-success' : 'text-destructive'}`}>
      {result.msg}
    </p>
  )
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
