// 申诉详情页（_w/apv/<id>/<sig>）：资料、留底与申诉处理详情。
// 桌面端按视口宽度自适应列数：<900 一列、≥900 两列、≥1400 三列。
//
// 列数由纯 CSS 断点决定（`min-[900px]:` / `min-[1400px]:`），不用 JS 读视口：
// 少一次 matchMedia 订阅，窗口缩放时也不用 React 重渲染。
// 三栏各包一层 div —— 每栏内部是多张卡片，不包的话它们会各自成为网格项、
// 被拆到不同列里。
import type { ReactNode } from 'react'
import { Button, Spinner } from '../../components/ui'
import type { AppealDossierView, WebRoute } from '../api'
import { InvalidState } from '../InvalidState'
import { useGate } from '../useGate'
import { ChatRef } from '../../components/mobile'

/** 卡片：与 Phase 3 的 SectionCard 视觉一致，但公开页不需要标题栏。 */
const CARD = 'mb-4 rounded-lg bg-card p-4'
const TITLE = 'mb-2 text-[15px] font-bold'

export function AppealViewPage({ route }: { route: WebRoute }) {
  const { gate, view, error, loading, reveal } = useGate<AppealDossierView>(route)

  if (error) return <InvalidState message={error} />
  if (view) return <AppealContent view={view} />
  if (!gate)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={22} />
      </div>
    )
  return (
    <>
      <WarnCard text={gate.warn} />
      <div className={CARD}>
        <Button disabled={loading} onClick={() => void reveal()}>
          {loading ? '正在读取…' : '查看内容'}
        </Button>
        <p className="mt-2 text-[13px] text-muted-foreground">
          链接只对持有者有效；查看凭据 5 分钟内有效。
        </p>
      </div>
    </>
  )
}

function AppealContent({ view }: { view: AppealDossierView }) {
  // 手机一列；≥900px 主栏 + 资料/活动两列；≥1400px 主栏 + 资料栏 + 活动栏三列。
  // 两列时主栏跨两行，资料与活动同处右栏 —— 避免宽屏下正文被拉成一条细长列。
  return (
    <div data-testid="appeal-view">
      <WarnCard text="敏感内容，请勿转发。以下为账号资料、留底与申诉处理详情。" />
      <div
        data-testid="appeal-grid"
        className="grid grid-cols-1 items-start gap-4 min-[900px]:grid-cols-2 min-[1400px]:grid-cols-3"
      >
        <div
          data-testid="appeal-main"
          className="min-w-0 min-[900px]:row-span-2 min-[1400px]:row-span-1"
        >
          <MainColumn view={view} />
        </div>
        <div data-testid="appeal-profile" className="min-w-0">
          <SideProfile view={view} />
        </div>
        <div data-testid="appeal-activity" className="min-w-0">
          <SideActivity view={view} />
        </div>
      </div>
    </div>
  )
}

function MainColumn({ view }: { view: AppealDossierView }) {
  return (
    <>
      <div className={CARD}>
        <p className="text-[13.5px] leading-[1.9]">
          申诉单：<Mono>#{view.id}</Mono> ｜ 状态：{view.status}
          <br />
          申诉人：<Mono>{view.uid}</Mono>
          {view.u_name && `（${view.u_name}）`} ｜ 提交时间：{view.created}
          <br />
          申诉理由：{view.statement || '（未填写）'}
        </p>
      </div>
      <div className={CARD}>
        <p className={TITLE}>AI 复核</p>
        <p className="text-[13.5px] leading-[1.9]">
          {view.ai_result || '（无结论）'}
          {view.ai_model && ` ｜ 模型 `}
          {view.ai_model && <Mono>{view.ai_model}</Mono>}
          {view.ai_conf > 0 && ` ｜ 置信度 ${Math.round(view.ai_conf)}%`}
        </p>
        {view.ai_reason && (
          <p className="mt-1 text-[13px] text-muted-foreground">理由：{view.ai_reason}</p>
        )}
        <p className={`${TITLE} mt-4`}>网页验证</p>
        <p className="text-[13.5px]">尝试次数：{view.web_attempts}</p>
        {view.code && (
          <p className="mt-1 text-[13.5px]">
            解禁码：<Mono>{view.code}</Mono>
            {view.code_expires && `（有效期至 ${view.code_expires}）`}
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">验证与发言记录见资料栏。</p>
      </div>
    </>
  )
}

/** SideProfile 是资料栏：账号信息 + 当前生效限制 + 历史处罚。 */
function SideProfile({ view }: { view: AppealDossierView }) {
  // 数组字段兜底：字段可能为 null，直接 .length/.map 会导致整页白屏，
  // 故统一回退为空数组。
  const limits = view.limits ?? []
  const penalties = view.penalties ?? []
  return (
    <>
      <div className={CARD}>
        <p className={TITLE}>账号信息</p>
        <p className="text-[13.5px] leading-[1.9]">
          用户 ID：<Mono>{view.uid}</Mono>
          {view.u_name && (
            <>
              <br />
              判定时昵称：{view.u_name}
            </>
          )}
          <br />
          所属 bot：{view.bot}
          {view.first_seen && (
            <>
              <br />
              首次见到：{view.first_seen}
            </>
          )}
          {view.joined && (
            <>
              <br />
              最早入群：{view.joined}
            </>
          )}
          {view.last_msg && (
            <>
              <br />
              最近发言：{view.last_msg}
            </>
          )}
          <br />
          群内发言：{view.msgs} 条 ｜ 历史命中：{view.hits} 次
          <br />
          涉及群组：{view.chats} 个
          {view.gban && (
            <>
              <br />
              联合封禁：{view.gban}
            </>
          )}
          <br />
          生效中限制：{limits.length} 条
        </p>
      </div>

      <PenaltyList title="当前生效限制" items={limits} active />
      <PenaltyList title={`历史处罚（${penalties.length} 条）`} items={penalties} />
    </>
  )
}

/** SideActivity 是活动栏：留底发言 + 判定流水 + 网页验证 + 关联账号。 */
function SideActivity({ view }: { view: AppealDossierView }) {
  const history = view.history ?? []
  const historyMore = view.history_more ?? []
  const logs = view.logs ?? []
  const checks = view.checks ?? []
  const strong = view.strong ?? []
  const weak = view.weak ?? []
  return (
    <>
      {history.length > 0 && (
        <div className={CARD}>
          <p className={TITLE}>群内留底发言（最近 {view.history_count} 条）</p>
          <HistoryList items={history} />
          {historyMore.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px]">
                展开其余 {historyMore.length} 条
              </summary>
              <HistoryList items={historyMore} />
            </details>
          )}
        </div>
      )}

      {logs.length > 0 && (
        <div className={CARD}>
          <p className={TITLE}>判定流水（{logs.length} 条）</p>
          <List>
            {logs.map((l) => (
              <li key={l.id}>
                <Mono>{l.time}</Mono> <ChatRef name={l.chat} url={l.chat_url} /> · {l.verdict}{' '}
                {Math.round(l.confidence * 100)}% →{' '}
                {l.action_label || l.action}
                {l.reason && <Sub>理由：{l.reason}</Sub>}
              </li>
            ))}
          </List>
        </div>
      )}

      {checks.length > 0 && (
        <div className={CARD}>
          <p className={TITLE}>网页验证记录（{checks.length} 条）</p>
          <List>
            {checks.map((c, i) => (
              <li key={i}>
                <Mono>{c.time}</Mono> {c.result}
                {(c.ip || c.fp) && (
                  <Sub>
                    IP：<Mono>{c.ip || '—'}</Mono>
                    {c.fp && (
                      <>
                        {' ｜ 指纹：'}
                        <Mono>{c.fp}</Mono>
                      </>
                    )}
                  </Sub>
                )}
                {c.flags && <Sub>信号：{c.flags}</Sub>}
                {c.ua && <Sub>UA：{c.ua}</Sub>}
              </li>
            ))}
          </List>
        </div>
      )}

      {(strong.length > 0 || weak.length > 0) && (
        <div className={CARD}>
          <p className={TITLE}>关联账号</p>
          {strong.length > 0 && (
            <>
              <p className="mt-1 text-[13px] text-muted-foreground">强关联（同指纹）</p>
              <Related items={strong} />
            </>
          )}
          {weak.length > 0 && (
            <>
              <p className="mt-1 text-[13px] text-muted-foreground">
                弱关联（30 天内同 IP，仅供参考）
              </p>
              <Related items={weak} />
            </>
          )}
        </div>
      )}
    </>
  )
}

function PenaltyList({
  title,
  items,
  active,
}: {
  title: string
  items: NonNullable<AppealDossierView['limits']>
  active?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div className={CARD}>
      <p className={TITLE}>{title}</p>
      <List>
        {items.map((p, i) => (
          <li key={i}>
            <Badge active={active}>{active ? '生效中' : '历史'}</Badge> {p.label || p.type}
            {p.chat && (
              <>
                {' · '}
                <ChatRef name={p.chat} url={p.chat_url} />
              </>
            )}
            {p.time && ` `}
            {p.time && <Mono>{p.time}</Mono>}
            {p.reason && <Sub>理由：{p.reason}</Sub>}
            {p.text && <Sub>原消息：{p.text}</Sub>}
          </li>
        ))}
      </List>
    </div>
  )
}

function HistoryList({ items }: { items: NonNullable<AppealDossierView['history']> }) {
  return (
    <List>
      {items.map((h, i) => (
        <li key={i} className={h.blocked ? 'rounded bg-destructive/8' : undefined}>
          <Mono>{h.time}</Mono>
          {h.chat && (
            <span className="text-muted-foreground">
              {' '}
              <ChatRef name={h.chat} url={h.chat_url} />
            </span>
          )}
          <div className="break-words">
            {h.text}
            {h.mark && <b> ← {h.mark}</b>}
          </div>
        </li>
      ))}
    </List>
  )
}

function Related({ items }: { items: NonNullable<AppealDossierView['strong']> }) {
  return (
    <List>
      {items.map((r) => (
        <li key={r.uid}>
          <Mono>{r.uid}</Mono> {r.mark}
        </li>
      ))}
    </List>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 pl-5 text-[13.5px] [&>li]:mb-2">{children}</ul>
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[12.5px] text-muted-foreground">{children}</p>
}

function Badge({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 align-[1px] text-[11px] ${
        active ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {children}
    </span>
  )
}

function WarnCard({ text }: { text: string }) {
  return (
    <div className="mb-4 rounded-lg bg-warning p-3 text-[13px] leading-[1.7] text-warning-foreground">
      {text}
    </div>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>
}
