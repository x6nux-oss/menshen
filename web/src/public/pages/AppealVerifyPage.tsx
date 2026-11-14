// 申诉验证页（_w/ap/<id>/<sig>）：展示处罚依据 + Turnstile + 采集浏览器
// 特征提交，换取解禁码。
//
// **验证链路保持不变** —— collectSignals / postJSON 的调用、回调签名、
// TurnstileWidget 的 props、resetKey 语义全部保持原样（CSP 与安全边界）。
// 页面只重排信息顺序：先说明为什么被拦，再给证据与 AI 结论，最后验证。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldAlert,
  Sparkles,
  UserRound,
  TriangleAlert,
} from 'lucide-react'
import { Button, Spinner } from '../../components/ui'
import { ChatRef } from '../../components/mobile'
import { getJSON, postJSON } from '../api'
import type { AppealData, WebRoute } from '../api'
import { collectSignals } from '../fingerprint'
import { errorText, InvalidState } from '../InvalidState'
import { TurnstileWidget } from '../TurnstileWidget'
import {
  Callout,
  EmptyLine,
  Meta,
  MetaGrid,
  Mono,
  PageHeader,
  SectionCard,
  Steps,
} from '../ui'

const LIMIT_LABEL: Record<string, string> = {
  join_profile: '进群资料审核限制',
  prewarm: '前置号识别限制',
  message: '消息判定处置',
  gban: '联合封禁 · 全平台',
  gban_own: '联合封禁 · 本 bot 名下群组',
}

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
      // 组件可能在重试时重复回调、令牌过期重发时也会再触发；一次提交
      // 在途时忽略后续令牌。
      if (busyRef.current) return
      busyRef.current = true
      setSubmitting(true)
      let passed = false
      try {
        const signals = await collectSignals()
        const resp = await postJSON<{ ok: boolean; code?: string; msg: string }>(route.path, {
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

  // 成功后不再接受任何组件事件；失败信息不清掉成功结果。
  const onToken = useCallback((token: string) => void submit(token), [submit])
  const onError = useCallback((msg: string) => {
    setResult((prev) => (prev?.ok ? prev : { ok: false, msg }))
  }, [])

  const retry = useCallback(() => {
    setResult(null)
    setResetKey((current) => current + 1)
  }, [])

  if (error) return <InvalidState message={error} />
  if (!data) return <Placeholder />
  const done = result?.ok === true
  return (
    <div data-testid="appeal-verify" className="space-y-4">
      <PageHeader
        title="申诉验证"
        description="核对限制原因，完成一次人机验证，获取交给群管理员的解禁码。"
      />

      <Steps
        current={done ? 3 : result || submitting ? 1 : 0}
        steps={[
          { title: '核对记录', description: '查看限制依据与留底' },
          { title: '完成验证', description: '人机验证通过后签发' },
          { title: '提交解禁码', description: '交给群管理员处理' },
        ]}
      />

      <Callout tone="info" icon={<ShieldAlert />} title="隐私说明">
        为防止滥用，本页会记录你的 IP 与浏览器特征，仅用于反垃圾审核，保留 {data.days} 天。
      </Callout>

      <SectionCard icon={<ShieldAlert />} title="为什么被限制">
        {data.limits.length > 0 ? (
          <ul className="space-y-4">
            {data.limits.map((limit, index) => (
              <li key={index} className="text-[16px] leading-7">
                <p className="font-medium">{LIMIT_LABEL[limit.type] ?? limit.type}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                  {limit.chat_id ? (
                    <span>
                      群{' '}
                      <ChatRef name={limit.chat} url={limit.chat_url} fallback={limit.chat_id} />
                    </span>
                  ) : null}
                  {limit.time && (
                    <span className="inline-flex items-center gap-1">
                      <Clock3 aria-hidden className="size-3.5" />
                      {limit.time}
                    </span>
                  )}
                </p>
                {limit.reason && <Detail label="理由">{limit.reason}</Detail>}
                {limit.text && <Detail label="原消息">{limit.text}</Detail>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>本 bot 名下已查不到仍在生效的限制，可能已经解除。</EmptyLine>
        )}
      </SectionCard>

      <SectionCard icon={<UserRound />} title="账号信息">
        <MetaGrid>
          <Meta label="用户 ID">
            <Mono>{data.account.uid}</Mono>
          </Meta>
          {data.account.name && <Meta label="判定时的昵称">{data.account.name}</Meta>}
        </MetaGrid>
        <Tip>
          这些是 bot 判定时记下的资料。广告号的昵称、用户名或简介里常写着推广、收益承诺或引流话术，
          即使某条消息看起来无害也会被整体判为广告号。把资料改干净再申诉，通过率会高很多。
        </Tip>
      </SectionCard>

      <SectionCard icon={<MessageSquareText />} title="你在群里的发言（留底）">
        {data.messages.length > 0 ? (
          <Messages messages={data.messages} />
        ) : (
          <EmptyLine>
            没有查到你的发言留底（可能已过保留期，或你还没在本 bot 的群里发过言）。
          </EmptyLine>
        )}
        <Tip>
          以上是 bot 留底的你的发言，最多显示最近 100 条、每条 300 字；留底保留 {data.days} 天。
        </Tip>
      </SectionCard>

      <SectionCard icon={<Sparkles />} title="AI 复核结论">
        <p className="text-[16px] leading-7">
          <span className="font-medium">{data.ai.label}</span>
          {data.ai.conf > 0 && (
            <span className="text-muted-foreground">
              {' '}
              · 置信度 {Math.round(data.ai.conf * 100)}%
            </span>
          )}
          {data.ai.model && (
            <span className="mt-1 block text-[12.5px] text-muted-foreground">
              模型 <Mono>{data.ai.model}</Mono>
            </span>
          )}
        </p>
        {data.ai.reason && <Detail label="复核理由">{data.ai.reason}</Detail>}
        {data.ai.statement && <Detail label="你的申诉理由">{data.ai.statement}</Detail>}
      </SectionCard>

      <SectionCard icon={<CheckCircle2 />} title="人机验证">
        <p className="text-[15px] leading-7">
          完成下方验证后，会给你一个<strong className="font-semibold">解禁码</strong>。
          把它交给群管理员即可解除限制。
        </p>
        {data.sitekey ? (
          !done && (
            <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
              <TurnstileWidget
                sitekey={data.sitekey}
                cdata={data.cdata}
                resetKey={resetKey}
                onToken={onToken}
                onError={onError}
              />
            </div>
          )
        ) : (
          <Callout tone="danger" icon={<TriangleAlert />} title="未配置验证">
            本页未配置人机验证，请联系群管理员处理。
          </Callout>
        )}
        {!done && (
          <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
            验证组件加载不出来时，请用系统浏览器打开本页。
          </p>
        )}
        <ResultArea
          submitting={submitting}
          result={result}
          onRetry={result && !result.ok && data.sitekey ? retry : undefined}
        />
      </SectionCard>

      <p className="flex items-center justify-center gap-2 pt-1 text-[12px] text-muted-foreground">
        <Bot aria-hidden className="size-3.5" />
        门神自动审核 · 申诉单 <Mono>#{data.appeal_id}</Mono>
      </p>
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
      <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2.5">
        <Spinner size={16} />
        <span className="text-[14px]">正在验证…</span>
      </div>
    )
  if (!result) return null
  if (result.ok)
    return (
      <div
        role="status"
        className="mt-4 rounded-md border border-success/40 bg-success/8 p-4"
      >
        <p className="flex items-center gap-2 text-[14px] font-semibold text-success">
          <CheckCircle2 aria-hidden className="size-4" />
          验证通过
        </p>
        {result.code && (
          <>
            <p className="mt-2 text-[13px] text-muted-foreground">解禁码</p>
            <p className="mt-1 select-all font-mono text-[24px] leading-8 font-semibold tracking-[0.12em] break-all">
              {result.code}
            </p>
          </>
        )}
        <p className="mt-2 text-[14px] leading-6">{result.msg}</p>
      </div>
    )
  return (
    <div role="alert" className="mt-4 rounded-md border border-destructive/35 bg-destructive/6 p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-destructive">
        <TriangleAlert aria-hidden className="size-4" />
        验证未通过
      </p>
      <p className="mt-1 text-[14px] leading-6">{result.msg}</p>
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
    for (const message of messages) {
      const last = out[out.length - 1]
      if (last && last.title === message.title) last.items.push(message)
      else out.push({ title: message.title, items: [message] })
    }
    return out
  }, [messages])
  return (
    <div className="space-y-4">
      {groups.map((group, index) => (
        <div key={index} className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">
            群{' '}
            <ChatRef
              name={group.title}
              url={group.items[0]?.chat_url}
              fallback={group.items[0]?.chat_id}
            />
          </p>
          <ul className="mt-1.5 divide-y divide-border rounded-md border border-border bg-muted/40">
            {group.items.map((message, itemIndex) => (
              <li key={itemIndex} className="flex gap-3 px-3 py-2 text-[14px] leading-6">
                <Mono className="shrink-0 text-[12px] text-muted-foreground">
                  {message.time}
                </Mono>
                <span className="min-w-0 break-words">{message.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[13.5px] leading-6 text-muted-foreground">
      <span className="mr-1 font-medium text-foreground">{label}：</span>
      <span className="break-words">{children}</span>
    </p>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[13px] leading-6 text-muted-foreground">{children}</p>
}

function Placeholder() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size={22} />
    </div>
  )
}
