// 申诉验证页（_w/ap/<id>/<sig>）：展示处罚依据 + Turnstile + 采集浏览器
// 特征提交，换取解禁码。
//
// Phase 4：展示层换到新设计系统（Tailwind + components/ui）。
// **验证链路一字未动** —— collectSignals / postJSON 的调用、回调签名、
// TurnstileWidget 的 props、resetKey 语义全部保持原样（CSP 与安全边界）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import { getJSON, postJSON } from '../api'
import type { AppealData, WebRoute } from '../api'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { TurnstileWidget } from '../TurnstileWidget'

const LIMIT_LABEL: Record<string, string> = {
  join_profile: '进群资料审核限制',
  prewarm: '前置号识别限制',
  message: '消息判定处置',
  gban: '联合封禁 · 全平台',
  gban_own: '联合封禁 · 本 bot 名下群组',
}

const CARD_CLASS = 'mb-4 rounded-lg bg-card p-4 text-card-foreground'
const SECTION_CLASS = 'mb-2 text-[15px] font-bold'

export function AppealVerifyPage({ route }: { route: WebRoute }) {
  const [data, setData] = useState<AppealData | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ ok: boolean; code?: string; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 提交失败后组件里的令牌已被服务端核销，重试需要 reset 重新挑战；
  // reset 由重试按钮驱动、不自动进行（非交互挑战会自动出新令牌，
  // 自动 reset 会在无人操作时连续消耗失败次数）。
  const [resetKey, setResetKey] = useState(0)
  const busyRef = useRef(false)

  useEffect(() => {
    let alive = true
    getJSON<AppealData>(route.path + '?json=1')
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
      // 组件可能在重试时重复回调、令牌过期重发时也会再触发；一次提交
      // 在途时忽略后续令牌。
      if (busyRef.current) return
      busyRef.current = true
      setSubmitting(true)
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; code?: string; msg: string }>(route.path, {
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

  // 成功后不再接受任何组件事件；失败信息不清掉成功结果。
  const onToken = useCallback((token: string) => void submit(token), [submit])
  const onError = useCallback((msg: string) => {
    setResult((prev) => (prev?.ok ? prev : { ok: false, msg }))
  }, [])

  const retry = useCallback(() => {
    setResult(null)
    setResetKey((k) => k + 1)
  }, [])

  if (error) return <InvalidState message={error} />
  if (!data) return <Placeholder />
  return (
    <div data-testid="appeal-verify">
      <div className="mb-4 rounded-lg bg-warning p-3 text-[13px] leading-[1.7] text-warning-foreground">
        为防止滥用，本页会记录你的 IP 与浏览器特征，仅用于反垃圾审核，保留 {data.days} 天。
      </div>

      <Section title="为什么被限制">
        {data.limits.length > 0 ? (
          <ul className="m-0 pl-5">
            {data.limits.map((l, i) => (
              <li key={i} className="mb-2.5 text-sm leading-[1.7]">
                {LIMIT_LABEL[l.type] ?? l.type}
                {l.chat_id ? (
                  <>
                    {' · 群 '}
                    <ChatRef name={l.chat} url={l.chat_url} fallback={l.chat_id} />
                  </>
                ) : (
                  ''
                )}
                {l.time ? ` · ${l.time}` : ''}
                {l.reason && <Sub>理由：{l.reason}</Sub>}
                {l.text && <Sub>原消息：{l.text}</Sub>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">本 bot 名下已查不到仍在生效的限制，可能已经解除。</p>
        )}
      </Section>

      <Section title="账号信息">
        <p className="text-sm">
          用户 ID：<Mono>{data.account.uid}</Mono>
          {data.account.name && (
            <>
              <br />
              判定时的昵称：{data.account.name}
            </>
          )}
        </p>
        <Tip>
          这些是 bot 判定时记下的资料。广告号的昵称、用户名或简介里常写着推广、收益承诺或引流话术，
          即使某条消息看起来无害也会被整体判为广告号——把资料改干净再申诉，通过率会高很多。
        </Tip>
      </Section>

      <Section title="你在群里的发言（留底）">
        {data.messages.length > 0 ? (
          <Messages messages={data.messages} />
        ) : (
          <p className="text-sm">
            没有查到你的发言留底（可能已过保留期，或你还没在本 bot 的群里发过言）。
          </p>
        )}
        <Tip>
          以上是 bot 留底的你的发言，最多显示最近 100 条、每条 300 字；留底保留 {data.days} 天。
        </Tip>
      </Section>

      <Section title="AI 复核结论">
        <p className="text-sm">
          {data.ai.label}
          {data.ai.conf > 0 && `（置信度 ${Math.round(data.ai.conf * 100)}%`}
          {data.ai.conf > 0 && data.ai.model ? ` · ${data.ai.model}）` : data.ai.conf > 0 ? '）' : ''}
          {data.ai.conf <= 0 && data.ai.model ? `（${data.ai.model}）` : ''}
        </p>
        {data.ai.reason && <Sub>{data.ai.reason}</Sub>}
        {data.ai.statement && <Sub>你的申诉理由：{data.ai.statement}</Sub>}
      </Section>

      <Section title="人机验证">
        <p className="mb-3 text-sm">
          完成下方的人机验证后，会给你一个<b>解禁码</b>，把它交给群管理员即可解除限制。
        </p>
        {data.sitekey ? (
          !result?.ok && (
            <TurnstileWidget
              sitekey={data.sitekey}
              cdata={data.cdata}
              resetKey={resetKey}
              onToken={onToken}
              onError={onError}
            />
          )
        ) : (
          <p className="text-[13px] text-muted-foreground">
            本页未配置人机验证，请联系群管理员处理。
          </p>
        )}
        <p className="mt-2 text-[13px] text-muted-foreground">
          验证组件加载不出来时，请用系统浏览器打开本页。
        </p>
        <ResultArea
          submitting={submitting}
          result={result}
          onRetry={result && !result.ok && data.sitekey ? retry : undefined}
        />
      </Section>
    </div>
  )
}

function ResultArea({
  submitting,
  result,
  onRetry,
}: {
  submitting: boolean
  result: { ok: boolean; code?: string; msg: string } | null
  onRetry?: () => void
}) {
  if (submitting)
    return (
      <div className="mt-3 flex items-center gap-2">
        <Spinner size={16} />
        <span className="text-sm">正在验证…</span>
      </div>
    )
  if (!result) return null
  if (result.ok && result.code)
    return (
      <div className="mt-3">
        <p className="text-sm">
          解禁码：
          <span className="rounded-sm bg-success px-2 py-1 font-mono text-lg tracking-wider text-success-foreground">
            {result.code}
          </span>
        </p>
        <p className="mt-1 text-sm">{result.msg}</p>
      </div>
    )
  return (
    <div className="mt-3">
      <p className="text-sm text-destructive">{result.msg}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          重试验证
        </Button>
      )}
    </div>
  )
}

/** Messages 把发言留底按群分组（接口按群顺序扁平返回）。 */
function Messages({ messages }: { messages: AppealData['messages'] }) {
  const groups = useMemo(() => {
    const out: { title: string; items: AppealData['messages'] }[] = []
    for (const m of messages) {
      const last = out[out.length - 1]
      if (last && last.title === m.title) last.items.push(m)
      else out.push({ title: m.title, items: [m] })
    }
    return out
  }, [messages])
  return (
    <>
      {groups.map((g, i) => (
        <div key={i} className="mb-2">
          <p className="text-[13px] text-muted-foreground">
            群 <ChatRef name={g.title} url={g.items[0]?.chat_url} fallback={g.items[0]?.chat_id} />
          </p>
          <ul className="m-0 pl-5">
            {g.items.map((m, j) => (
              <li key={j} className="mb-2 text-[13.5px] leading-[1.6] break-words">
                <Mono>{m.time}</Mono> {m.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={CARD_CLASS}>
      <p className={SECTION_CLASS}>{title}</p>
      {children}
    </div>
  )
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[13px] break-words text-muted-foreground">{children}</p>
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13px] leading-[1.7] text-muted-foreground">{children}</p>
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono">{children}</span>
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
