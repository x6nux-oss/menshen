// 入群验证页（_w/jv/<id>/<sig>）：新人进群后的自助门槛。
//
// 页面加载时取回提供方与 sitekey，渲染对应的验证码组件；拿到 token 后
// 连同浏览器特征提交，服务端向提供方核对通过即解除禁言。
//
// **验证链路保持不变** —— mountCaptcha / collectSignals / postJSON 的调用、
// 回调签名、验证码容器的 ref 与 data-testid 全部保持原样（CSP 与安全边界）。
//
// 失败后必须能重试：验证码 token 是一次性的，失败后组件不会自己再回调，
// 因此这里在结果区给「重新验证」并在挂载点重建组件，让用户能拿到新 token。
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ShieldCheck, TriangleAlert, UserPlus } from 'lucide-react'
import { Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import { getJSON, postJSON } from '../api'
import type { JoinVerifyData, WebRoute } from '../api'
import { mountCaptcha } from '../captcha'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { Button } from '../../components/ui'
import { PageHeader, SectionCard, Steps } from '../ui'

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
  const [attempt, setAttempt] = useState(0)
  const doneRef = useRef(false)

  useEffect(() => {
    let alive = true
    getJSON<JoinVerifyData>(route.path + '?json=1')
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

  const submit = useCallback(
    async (token: string) => {
      // 组件可能在重试时重复回调；一次提交已经有结论就不再重复提交。
      if (doneRef.current) return
      doneRef.current = true
      setSubmitting(true)
      let passed = false
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; msg: string }>(route.path, {
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
    [route.path],
  )

  if (error) return <InvalidState message={error} />
  if (!data) return <Placeholder />
  if (data.status !== 'pending')
    return <InvalidState message="这张验证已经完成或已失效，请重新加入群聊。" />
  if (!data.provider || !data.sitekey)
    return <InvalidState message="本群未配置人机验证，请联系群管理员。" />

  const retry = () => {
    setResult(null)
    doneRef.current = false
    setAttempt((current) => current + 1)
  }

  return (
    <div data-testid="join-verify" className="space-y-4">
      <PageHeader
        title={
          data.chat ? (
            <>
              加入「
              <ChatRef name={data.chat} url={data.chat_url} />
              」
            </>
          ) : (
            '入群验证'
          )
        }
        description="为防广告机器人，请先完成人机验证。通过后即可在群里发言。"
      />

      <Steps
        current={result?.ok ? 3 : submitting || result ? 1 : 0}
        steps={[
          { title: '阅读说明', description: '确认群与时限' },
          { title: '完成人机验证', description: '按提示完成挑战' },
          { title: '开始发言', description: '验证通过后自动解除' },
        ]}
      />

      <SectionCard icon={<UserPlus />} title="验证要求">
        <p className="text-[16px] leading-7">
          {data.minutes > 0
            ? `请在 ${data.minutes} 分钟内完成，否则会被移出群聊（可重新加入）。`
            : '未通过验证前无法发言。'}
        </p>
      </SectionCard>

      <SectionCard
        icon={<ShieldCheck />}
        title={`人机验证 · ${PROVIDER_LABEL[data.provider] ?? data.provider}`}
      >
        {!result?.ok && (
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <CaptchaWidget key={attempt} data={data} onToken={submit} />
          </div>
        )}
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          验证组件加载不出来时，请用系统浏览器打开本页。
        </p>
        <ResultArea submitting={submitting} result={result} onRetry={retry} />
      </SectionCard>

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[12px] leading-5 text-muted-foreground">
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
  onRetry,
}: {
  submitting: boolean
  result: { ok: boolean; msg: string } | null
  onRetry: () => void
}) {
  if (submitting)
    return (
      <div
        role="status"
        className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2.5"
      >
        <Spinner size={16} />
        <p className="text-[14px]">正在验证…</p>
      </div>
    )
  if (!result) return null
  if (result.ok)
    return (
      <div
        role="status"
        className="mt-4 flex gap-3 rounded-md border border-success/40 bg-success/8 p-4"
      >
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <p className="text-[14px] font-semibold text-success">验证通过</p>
          <p className="mt-1 text-[14px] leading-6">{result.msg}</p>
        </div>
      </div>
    )
  return (
    <div
      role="alert"
      className="mt-4 flex gap-3 rounded-md border border-destructive/35 bg-destructive/6 p-4"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-destructive">验证未通过</p>
        <p className="mt-1 text-[14px] leading-6 break-words">{result.msg}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          重新验证
        </Button>
      </div>
    </div>
  )
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
