// AI 必封规则（仅主管理员；服务端仍是唯一裁决，次管进页面只看到 403）：
// - Agent 卡：启动/停止 AI 从历史封禁里发现候选规则；运行中每 2 秒轮询步骤，
//   运行结束自动刷新规则列表（Agent 可能刚写入了新候选）；
// - 列表：名称 + 分类/正则副行、启用/候选与强制徽标、最近测试 TP/FP 摘要；
//   右上 `＋ 手动新增` 抽屉（保存由服务端强制跑全库测试）；
// - 详情：全库误封测试（FP/已撤销样本红色高亮，TP 样本可折叠）、启用/强制
//   开关（乐观更新；强制受服务端防误封门约束：未测试或 fp/undone>0 时禁用）、
//   删除确认（写明规则名与后果）。
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { errorStatus } from '../api/client'
import { miniQueryKeys, useMiniState, useRuleAgent, useRules } from '../api/hooks'
import { useOptimisticRulesMutation, useRulesMutation } from '../api/mutations'
import type {
  Rule,
  RuleAgent,
  RuleAgentStartResp,
  RuleKindStat,
  RuleSample,
  RuleSaveResp,
  RuleTest,
} from '../api/types'
import { actionLabel, displayTz, fmtTS, verdictLabel } from '../lib/format'
import { useNav, usePageParam } from '../nav'
import { EmptyState, ErrorState, Skeletons, useToast } from '../components/feedback'
import {
  ChatRef,
  Chip,
  FormDrawer,
  ListRow,
  SearchField,
  SectionCard,
  SwitchRow,
  useConfirm,
} from '../components/mobile'
import { Badge } from '../components/ui'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { InfoRow } from './shared'

/** 规则列表的筛选与排序。 */
type RuleFilter = 'all' | 'enabled' | 'candidate' | 'enforce'
type RuleSort = 'default' | 'coverage' | 'tp' | 'hits' | 'recent'

const RULE_FILTERS: { key: RuleFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'enabled', label: '启用' },
  { key: 'candidate', label: '候选' },
  { key: 'enforce', label: '强制' },
]

const RULE_SORTS: { key: RuleSort; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'coverage', label: '覆盖率' },
  { key: 'tp', label: '命中广告' },
  { key: 'hits', label: '规则命中' },
  { key: 'recent', label: '最近创建' },
]

/** ruleCoverageValue 覆盖率排序值；未测试或分母为 0 记 -1 排最后。 */
function ruleCoverageValue(rule: Rule): number {
  if (rule.last_ads_total <= 0) return -1
  return rule.last_tp / rule.last_ads_total
}

/** pct 覆盖率显示：一位小数；分母缺失或为 0 时 null（调用方决定 `—` 或省略）。 */
function pct(matched: number, total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return `${((matched / total) * 100).toFixed(1)}%`
}

/** KindCoverageList 是 `按类型覆盖` 小节：实时测试与落库数据共用。 */
function KindCoverageList({ kinds }: { kinds: RuleKindStat[] }) {
  if (!kinds || kinds.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-[13px] font-semibold text-muted-foreground">按类型覆盖</p>
      {kinds.map((k) => (
        <div
          key={k.kind || '（空）'}
          className="mt-1 flex items-baseline gap-2 text-[13px]"
        >
          <span className="min-w-0 flex-1 font-mono break-all">{k.kind || '（空）'}</span>
          <span className="whitespace-nowrap text-muted-foreground">
            {k.matched}/{k.total}
          </span>
          <span
            className={
              k.matched === 0
                ? 'min-w-12 text-right whitespace-nowrap text-muted-foreground/60'
                : 'min-w-12 text-right whitespace-nowrap'
            }
          >
            {pct(k.matched, k.total) ?? '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

/** agentStatus 把 Agent 运行态归成状态徽标（空闲/运行中/已完成/失败）。 */
function agentStatus(agent: RuleAgent | undefined): {
  label: string
  tone: 'ok' | 'no' | 'warn' | 'neutral'
} {
  if (agent?.running) return { label: '运行中', tone: 'warn' }
  if (agent?.error) return { label: '失败', tone: 'no' }
  if (agent && (agent.result !== '' || agent.finished_at > 0)) {
    return { label: '已完成', tone: 'ok' }
  }
  return { label: '空闲', tone: 'neutral' }
}

/** sourceLabel 规则来源文案；未知来源原样显示。 */
function sourceLabel(source: string): string {
  if (source === 'ai') return 'AI 发现'
  if (source === 'builtin') return '内置'
  return source || '未知'
}

/** sourceText 返回详情页需要的来源与创建时间。 */
function sourceText(rule: Rule, tz?: string): string {
  return `来源 ${sourceLabel(rule.source)} · 创建于 ${fmtTS(rule.created_at, tz)}`
}

/** enforceHint 强制开关的灰字说明：可开启时说效果，被防误封门拦住时说原因。 */
function enforceHint(rule: Rule): string {
  if (!rule.enabled) return '先启用规则，再开启强制'
  if (rule.last_tested_at === 0) return '还没跑过全库测试：先测试确认没有误封，再开启强制'
  if (rule.last_fp > 0 || rule.last_undone > 0) {
    return `全库测试有疑似误封（FP ${rule.last_fp} · 已撤销 ${rule.last_undone}）：先修净误封，再开启强制`
  }
  return '开启后命中即最高档处置（零 AI 成本）；不开则命中先删+临时禁言，再交 AI 复判'
}

/** RuleBadges 列表/详情共用的启用状态与强制徽标。 */
function RuleBadges({ rule }: { rule: Rule }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={rule.enabled ? 'ok' : 'neutral'}>{rule.enabled ? '启用' : '候选'}</Badge>
      {rule.enforce && <Badge tone="warn">强制</Badge>}
    </span>
  )
}

/** RuleSecondary 列表副行：分类灰字 + 等宽正则（单行截断）。 */
function RuleSecondary({ rule }: { rule: Rule }) {
  return (
    <span className="block">
      {rule.category !== '' && <span className="mr-1.5">{rule.category}</span>}
      <span className="inline-block max-w-full overflow-hidden align-bottom font-mono text-xs text-ellipsis whitespace-nowrap">
        {rule.pattern}
      </span>
    </span>
  )
}

/** TpFpValue 列表右侧的最近测试摘要：从未测试时明确写 `未测试`。 */
function TpFpValue({ rule }: { rule: Rule }) {
  if (rule.last_tested_at === 0) {
    return <span className="text-xs">未测试</span>
  }
  const cov = pct(rule.last_tp, rule.last_ads_total)
  return (
    <span data-testid={`rule-tpfp-${rule.id}`} className="text-xs whitespace-nowrap">
      TP {rule.last_tp} ·{' '}
      <span className={rule.last_fp > 0 ? 'text-destructive' : undefined}>FP {rule.last_fp}</span>
      {cov !== null && <> · 覆盖 {cov}</>}
    </span>
  )
}

/** AgentCard 是规则发现 Agent 的状态卡：只显示运行状态、启停与最终结果。 */
function AgentCard() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const agentQuery = useRuleAgent(true)
  const startMut = useRulesMutation<RuleAgentStartResp>()
  const stopMut = useRulesMutation<{ ok: boolean; stopped: boolean }>()
  const wasRunning = useRef(false)

  const agent = agentQuery.data?.agent
  const running = agent?.running ?? false
  const stepsCount = agent?.steps_count ?? 0
  const targetLogId = agent?.target_log_id ?? 0
  const status = agentQuery.isError
    ? { label: '失败', tone: 'no' as const }
    : agentStatus(agent)
  const ended =
    agent !== undefined &&
    (agent.error !== '' || agent.result !== '' || agent.created_rule_id > 0)

  // 运行 → 结束的跳变：Agent 可能刚写入了新规则，刷新规则列表。
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: miniQueryKeys.rules })
    }
    wasRunning.current = running
  }, [running, queryClient])

  function start() {
    startMut.mutate(
      { action: 'agent_start' },
      {
        // 竞态防护：挂载期的 agent_status 可能还在途，等它回来时若直接
        // setQueryData 会被旧响应覆盖（running 变回 false、轮询停掉、状态
        // 不再刷新）。先取消在途请求，再写启动态，最后失效重取确认真值。
        onSuccess: async (resp) => {
          if (resp.agent) {
            await queryClient.cancelQueries({ queryKey: miniQueryKeys.rulesAgent })
            queryClient.setQueryData(miniQueryKeys.rulesAgent, { agent: resp.agent })
            await queryClient.invalidateQueries({ queryKey: miniQueryKeys.rulesAgent })
          }
          toast('已开始规则发现，完成后会给出新规则')
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  function stop() {
    stopMut.mutate(
      { action: 'agent_stop' },
      {
        onSuccess: (resp) =>
          toast(resp.stopped ? '已请求停止，当前步骤结束后收尾' : '当前没有在运行的发现任务'),
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <SectionCard title="AI 规则发现">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {agentQuery.isError ? (
            <>
              <p className="min-w-0 flex-1 text-[13px] leading-normal text-destructive">
                状态读取失败
              </p>
              <Button size="sm" variant="ghost" onClick={() => void agentQuery.refetch()}>
                重试
              </Button>
            </>
          ) : (
            <p className="text-[13px] leading-normal text-muted-foreground">
              {running
                ? targetLogId > 0
                  ? `正在针对记录 #${targetLogId} 总结必封规则…已执行 ${stepsCount} 步`
                  : `正在从历史封禁里总结必封规则…已执行 ${stepsCount} 步`
                : '让 AI 扫描历史封禁生成规则；无误封的会自动启用（仅作为判定证据）。'}
            </p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            disabled={running || startMut.isPending || stopMut.isPending}
            onClick={start}
          >
            {startMut.isPending && <Spinner size={14} />}
            开始发现
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!running || stopMut.isPending || startMut.isPending}
            onClick={stop}
            className="text-destructive"
          >
            {stopMut.isPending && <Spinner size={14} />}
            停止
          </Button>
        </div>
      </div>

      {!running && ended && agent !== undefined && (
        <div className="border-t border-border px-4 py-3">
          {agent.error !== '' ? (
            <p className="text-[13px] leading-relaxed text-destructive">失败：{agent.error}</p>
          ) : (
            agent.result !== '' && <p className="text-[13px] leading-relaxed">{agent.result}</p>
          )}
          {(agent.created_rule_ids ?? []).length > 0 && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              本轮创建规则：{(agent.created_rule_ids ?? []).map((id) => `#${id}`).join('、')}
              ，可在下方列表查看与测试
            </p>
          )}
        </div>
      )}
    </SectionCard>
  )
}

export function RulesPage() {
  const nav = useNav()
  const toast = useToast()
  const state = useMiniState(true)
  const main = state.data?.me.main === true
  // rules op 只对主管理员开放：次管不发请求，直接落到 403。
  const rulesQuery = useRules(main)
  const addMut = useRulesMutation<RuleSaveResp>()
  const testMut = useRulesMutation<{ test: RuleTest }>()

  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [pattern, setPattern] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const [testPattern, setTestPattern] = useState('')
  // testResult 绑定提交时的 pattern：请求在途时改了输入，迟到的响应不能当
  // 当前输入的结果展示（否则会用旧统计误导 `用此正则新建规则`）。
  const [testResult, setTestResult] = useState<{ test: RuleTest; pattern: string } | null>(null)
  const [filter, setFilter] = usePageParam<RuleFilter>(
    'filter',
    'all',
    RULE_FILTERS.map((f) => f.key),
  )
  const [sort, setSort] = usePageParam<RuleSort>(
    'sort',
    'default',
    RULE_SORTS.map((s) => s.key),
  )
  const [search, setSearch] = usePageParam('q')

  if (state.isPending) return <Skeletons rows={3} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!main) return <ErrorState status={403} />

  const tz = displayTz(state.data)
  const rules = rulesQuery.data?.rules ?? []
  const query = search.trim().toLowerCase()
  const filteredRules = rules
    .filter((r) => {
      if (filter === 'enabled' && !r.enabled) return false
      if (filter === 'candidate' && r.enabled) return false
      if (filter === 'enforce' && !r.enforce) return false
      return (
        query === '' ||
        r.name.toLowerCase().includes(query) ||
        r.pattern.toLowerCase().includes(query)
      )
    })
    .sort((a, b) => {
      switch (sort) {
        case 'coverage':
          return ruleCoverageValue(b) - ruleCoverageValue(a) || a.id - b.id
        case 'tp':
          return b.last_tp - a.last_tp || a.id - b.id
        case 'hits':
          return b.hits - a.hits || a.id - b.id
        case 'recent':
          return b.created_at - a.created_at || a.id - b.id
        default:
          return a.id - b.id
      }
    })

  function openAdd() {
    setName('')
    setPattern('')
    setCategory('')
    setNote('')
    setAddOpen(true)
  }

  function submitAdd() {
    addMut.mutate(
      {
        action: 'save',
        id: 0,
        name: name.trim(),
        pattern: pattern.trim(),
        category: category.trim(),
        note: note.trim(),
      },
      {
        onSuccess: (resp) => {
          toast(`已保存；本次测试命中 ${resp.test?.matched ?? 0} 条`)
          setAddOpen(false)
        },
        // 400（正则非法/匹配空文本等）保持抽屉与输入，只 toast 服务端文案。
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <div data-testid="rules-page">
      <AgentCard />

      {rulesQuery.isError ? (
        <ErrorState
          status={errorStatus(rulesQuery.error)}
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : rulesQuery.isPending ? (
        <Skeletons rows={3} />
      ) : (
        <>
          <div className="mb-1.5 flex items-center pl-2">
            <h2 className="flex-1 text-[13px] font-medium text-muted-foreground">
              规则（{filteredRules.length}
              {filteredRules.length !== rules.length ? `/${rules.length}` : ''}）
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTestPattern('')
                setTestResult(null)
                setTestOpen(true)
              }}
              className="h-7.5 px-2 text-[13px]"
            >
              测试正则
            </Button>
            <Button size="sm" variant="ghost" onClick={openAdd} className="h-7.5 px-2 text-[13px]">
              ＋ 手动新增
            </Button>
          </div>
          <div className="mb-1.5 flex flex-col gap-1.5 px-2">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="搜索名称或正则"
              ariaLabel="搜索规则"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {RULE_FILTERS.map((f) => (
                <Chip
                  key={f.key}
                  label={f.label}
                  selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">排序</span>
              {RULE_SORTS.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  selected={sort === s.key}
                  onClick={() => setSort(s.key)}
                />
              ))}
            </div>
          </div>
          <SectionCard>
            {rules.length === 0 ? (
              <EmptyState
                title="还没有规则"
                description="点「开始发现」让 AI 从历史封禁里生成规则，也可以手动新增后自己测试。"
              />
            ) : filteredRules.length === 0 ? (
              <EmptyState title="没有符合条件的规则" description="换个筛选条件或清空搜索再试。" />
            ) : (
              filteredRules.map((rule) => (
                <ListRow
                  key={rule.id}
                  primary={rule.name}
                  secondary={<RuleSecondary rule={rule} />}
                  badge={<RuleBadges rule={rule} />}
                  value={<TpFpValue rule={rule} />}
                  chevron
                  onClick={() => nav.push({ k: 'rule', id: rule.id })}
                />
              ))
            )}
          </SectionCard>
        </>
      )}

      <FormDrawer
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title="测试正则"
        pending={testMut.isPending}
        submitText="开始测试"
        submitDisabled={testPattern.trim() === ''}
        onSubmit={() => {
          const submitted = testPattern.trim()
          testMut.mutate(
            { action: 'test', pattern: submitted },
            {
              onSuccess: (resp) => setTestResult({ test: resp.test, pattern: submitted }),
              onError: (err) => toast(err.message),
            },
          )
        }}
      >
        <Label htmlFor="rule-test-pattern">正则（RE2）</Label>
        <Textarea
          id="rule-test-pattern"
          className="mt-1 font-mono text-[13px]"
          rows={2}
          placeholder="如 兼职.{0,6}(日结|垫付|押金)"
          value={testPattern}
          onChange={(event) => {
            setTestPattern(event.target.value)
            // 改了正则，旧结果不再对应当前输入，立即作废。
            setTestResult(null)
          }}
        />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          只试跑不落库；保存时服务端仍会跑一次同样的全库测试。
        </p>
        {testResult !== null && testResult.pattern === testPattern.trim() && (
          <>
            <RuleTestPanel test={testResult.test} tz={tz} />
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => {
                setTestOpen(false)
                setName('')
                setPattern(testPattern.trim())
                setCategory('')
                setNote('')
                setAddOpen(true)
              }}
            >
              用此正则新建规则
            </Button>
          </>
        )}
      </FormDrawer>

      <FormDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="手动新增规则"
        pending={addMut.isPending}
        submitText="保存"
        submitDisabled={name.trim() === '' || pattern.trim() === ''}
        onSubmit={submitAdd}
      >
        <Label htmlFor="rule-name">名称</Label>
        <Input
          id="rule-name"
          className="mt-1"
          maxLength={60}
          placeholder="如 兼职押金话术"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Label htmlFor="rule-pattern" className="mt-3 block">
          正则（RE2）
        </Label>
        <Textarea
          id="rule-pattern"
          className="mt-1 font-mono text-[13px]"
          rows={2}
          placeholder="如 兼职.{0,6}(日结|垫付|押金)"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
        />
        <Label htmlFor="rule-category" className="mt-3 block">
          分类（可选）
        </Label>
        <Input
          id="rule-category"
          className="mt-1"
          maxLength={20}
          placeholder="如 scam"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
        <Label htmlFor="rule-note" className="mt-3 block">
          备注（可选）
        </Label>
        <Textarea
          id="rule-note"
          className="mt-1"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          保存时服务端会自动跑一次全库测试；不能编译或会匹配空文本的正则会被拒绝。
        </p>
      </FormDrawer>
    </div>
  )
}

/** TestStat 是全库测试结果里的一个数字格。 */
function TestStat({
  label,
  value,
  tone = 'plain',
  testId,
}: {
  label: string
  value: number | string
  tone?: 'plain' | 'ok' | 'no'
  testId: string
}) {
  const color =
    tone === 'ok' ? 'text-success' : tone === 'no' ? 'text-destructive' : 'text-foreground'
  return (
    <div className="rounded-lg bg-accent px-2 py-1.5">
      <p className="text-[11px] leading-normal text-muted-foreground">{label}</p>
      <p data-testid={testId} className={`text-lg leading-snug font-semibold ${color}`}>
        {value}
      </p>
    </div>
  )
}

/** SampleRow 是一条命中样本：verdict/action 徽标 + 时间 + chat/user + 正文摘要。 */
function SampleRow({
  sample,
  flag,
  testId,
  tz,
}: {
  sample: RuleSample
  /** 非空时是误封类样本（红框 + 前置标记徽标）。 */
  flag: string
  testId: string
  tz?: string
}) {
  const flagged = flag !== ''
  return (
    <div
      data-testid={testId}
      className={
        flagged
          ? 'mt-1.5 rounded-lg border-l-[3px] border-destructive bg-destructive/7 p-2'
          : 'mt-1.5 rounded-lg border-l-[3px] border-transparent bg-accent p-2'
      }
    >
      <div className="flex flex-wrap items-center gap-1">
        {flagged && <Badge tone="no">{flag}</Badge>}
        <Badge tone={sample.verdict === 'ad' ? 'ok' : 'neutral'}>
          {verdictLabel(sample.verdict)}
        </Badge>
        <Badge tone="neutral">{actionLabel(sample.action)}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtTS(sample.created_at, tz)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        chat <ChatRef name={sample.chat} url={sample.chat_url} fallback={sample.chat_id} /> · uid{' '}
        {sample.user_id}
      </p>
      <p className="mt-0.5 text-[13px] leading-relaxed break-words">
        {sample.text || '（空文本）'}
      </p>
    </div>
  )
}

/** SampleList 是一组样本：误封类红标题，正文逐条渲染。 */
function SampleList({
  title,
  samples,
  flag,
  testId,
  tz,
}: {
  title: string
  samples: RuleSample[]
  flag: string
  testId: string
  tz?: string
}) {
  return (
    <div className="mt-3">
      <p
        className={
          flag === ''
            ? 'text-[13px] font-semibold text-muted-foreground'
            : 'text-[13px] font-semibold text-destructive'
        }
      >
        {title}
      </p>
      {samples.map((sample) => (
        <SampleRow key={sample.id} sample={sample} flag={flag} testId={testId} tz={tz} />
      ))}
    </div>
  )
}

/** RuleTestPanel 渲染一轮全库测试：七个数字 + FP/已撤销红色样本 + 可折叠 TP 样本。 */
function RuleTestPanel({ test, tz }: { test: RuleTest; tz?: string }) {
  const [tpOpen, setTpOpen] = useState(false)
  return (
    <div data-testid="rule-test-result" className="border-t border-border px-4 py-3">
      <div className="grid grid-cols-3 gap-2">
        <TestStat testId="rule-test-scanned" label="扫描" value={test.scanned} />
        <TestStat testId="rule-test-matched" label="命中" value={test.matched} />
        <TestStat
          testId="rule-test-coverage"
          label="覆盖率"
          value={pct(test.tp, test.ads_total) ?? '—'}
        />
        <TestStat
          testId="rule-test-tp"
          label="TP 确认广告"
          value={test.tp}
          tone={test.tp > 0 ? 'ok' : 'plain'}
        />
        <TestStat
          testId="rule-test-fp"
          label="FP 疑似误封"
          value={test.fp}
          tone={test.fp > 0 ? 'no' : 'plain'}
        />
        <TestStat
          testId="rule-test-undone"
          label="已撤销"
          value={test.undone}
          tone={test.undone > 0 ? 'no' : 'plain'}
        />
        <TestStat testId="rule-test-neutral" label="中性" value={test.neutral} />
      </div>

      <KindCoverageList kinds={test.kinds} />

      {test.fp_samples.length > 0 && (
        <SampleList
          title={`误封样本（${test.fp_samples.length}）`}
          samples={test.fp_samples}
          flag="误封"
          testId="rule-sample-fp"
          tz={tz}
        />
      )}
      {test.undone_samples.length > 0 && (
        <SampleList
          title={`已撤销样本（${test.undone_samples.length}）`}
          samples={test.undone_samples}
          flag="已撤销"
          testId="rule-sample-undone"
          tz={tz}
        />
      )}
      {test.tp_samples.length > 0 && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => setTpOpen((open) => !open)}
          >
            {tpOpen ? '收起 TP 样本' : `展开 TP 样本（${test.tp_samples.length}）`}
          </Button>
          {tpOpen && (
            <SampleList
              title="TP 样本"
              samples={test.tp_samples}
              flag=""
              testId="rule-sample-tp"
              tz={tz}
            />
          )}
        </>
      )}
      {test.matched === 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          这次测试没有命中任何历史记录。
        </p>
      )}
    </div>
  )
}

export function RuleDetailPage({ id }: { id: number }) {
  const nav = useNav()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useMiniState(true)
  const main = state.data?.me.main === true
  const rulesQuery = useRules(main)

  const toggleMut = useOptimisticRulesMutation()
  const enforceMut = useOptimisticRulesMutation()
  const testMut = useRulesMutation<{ test: RuleTest }>()
  const removeMut = useRulesMutation()

  const [test, setTest] = useState<RuleTest | null>(null)

  if (state.isPending) return <Skeletons rows={4} />
  if (state.isError) {
    return <ErrorState status={errorStatus(state.error)} onRetry={() => void state.refetch()} />
  }
  if (!main) return <ErrorState status={403} />
  if (rulesQuery.isPending) return <Skeletons rows={4} />
  if (rulesQuery.isError) {
    return (
      <ErrorState status={errorStatus(rulesQuery.error)} onRetry={() => void rulesQuery.refetch()} />
    )
  }

  const rule = (rulesQuery.data.rules ?? []).find((r) => r.id === id)
  if (!rule) {
    return <EmptyState title="规则不存在" description="它可能已被删除。" />
  }

  const tz = displayTz(state.data)
  // 防误封门与服务端一致：未启用 / 从未测试 / fp 或 undone>0 时禁止开启强制；
  // 已开启的强制始终允许关闭（关闭不受门限制）。
  const enforceBlocked = !rule.enabled || rule.last_tested_at === 0 || rule.last_fp > 0 || rule.last_undone > 0
  const enforceDisabled = enforceMut.isPending || (!rule.enforce && enforceBlocked)

  function toggleEnabled(next: boolean) {
    toggleMut.mutate(
      {
        body: { action: 'toggle', id, enabled: next },
        // 停用时服务端会一并清掉 enforce，乐观结果保持同一不变式。
        apply: (data) => ({
          ...data,
          rules: data.rules.map((r) =>
            r.id === id ? { ...r, enabled: next, enforce: next ? r.enforce : false } : r,
          ),
        }),
      },
      {
        onSuccess: () =>
          toast(next ? '已启用：命中即删除+临时禁言，交 AI 复判（开启强制则直接最高档）' : '已停用（强制一并关闭）'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggleEnforce(next: boolean) {
    enforceMut.mutate(
      {
        body: { action: 'enforce', id, enforce: next },
        apply: (data) => ({
          ...data,
          rules: data.rules.map((r) => (r.id === id ? { ...r, enforce: next } : r)),
        }),
      },
      {
        onSuccess: () => toast(next ? '已开启强制：命中即最高档处置' : '已关闭强制'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function runTest() {
    testMut.mutate(
      { action: 'test', id },
      {
        onSuccess: (resp) => {
          setTest(resp.test)
          toast(
            resp.test.fp > 0 || resp.test.undone > 0
              ? `测试完成：发现 ${resp.test.fp} 条疑似误封，先别开强制`
              : `测试完成：命中 ${resp.test.matched} 条，无误封`,
          )
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  async function removeRule() {
    const ok = await confirm({
      title: '删除该规则？',
      description: `将删除规则「${rule?.name}」并立即从判定快照移除，之后不再参与证据或强制处置。此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    removeMut.mutate(
      { action: 'remove', id },
      {
        onSuccess: (resp) => {
          toast(resp.note ?? '已删除')
          nav.pop()
        },
        onError: (err) => toast(err.message),
      },
    )
  }

  return (
    <div data-testid="rule-detail-page">
      <SectionCard>
        <ListRow primary={rule.name} secondary={sourceText(rule, tz)} badge={<RuleBadges rule={rule} />} />
        <InfoRow label="正则">
          <code className="font-mono text-[13px] break-all whitespace-pre-wrap">{rule.pattern}</code>
        </InfoRow>
        {rule.note !== '' && <InfoRow label="备注">{rule.note}</InfoRow>}
        {rule.category !== '' && <InfoRow label="分类">{rule.category}</InfoRow>}
        <InfoRow label="命中">
          {rule.hits} 次
          {rule.last_matched > 0 ? ` · 最近 ${fmtTS(rule.last_matched, tz)}` : ''}
        </InfoRow>
        <InfoRow label="最近测试">
          {rule.last_tested_at > 0
            ? `${fmtTS(rule.last_tested_at, tz)} · 扫描 ${rule.last_scanned} · TP ${rule.last_tp} · FP ${rule.last_fp}${
                rule.last_undone > 0 ? ` · 已撤销 ${rule.last_undone}` : ''
              } · 覆盖率 ${pct(rule.last_tp, rule.last_ads_total) ?? '—'}`
            : '从未测试'}
        </InfoRow>
        <KindCoverageList kinds={rule.last_kinds} />
      </SectionCard>

      <SectionCard>
        <SwitchRow
          primary="启用"
          secondary={
            rule.enabled
              ? '命中会作为证据注入判定 prompt；关闭时强制也一并关闭'
              : '候选规则不参与判定；启用后才可测试与开启强制'
          }
          checked={rule.enabled}
          disabled={toggleMut.isPending}
          onChange={toggleEnabled}
        />
        <SwitchRow
          primary="强制"
          secondary={rule.enforce ? '命中即最高档处置（零 AI 成本）' : enforceHint(rule)}
          checked={rule.enforce}
          disabled={enforceDisabled}
          onChange={toggleEnforce}
        />
      </SectionCard>

      <SectionCard title="全库误封测试">
        <div className="px-4 py-3">
          <Button
            variant="outline"
            className="w-full"
            disabled={testMut.isPending}
            onClick={runTest}
          >
            {testMut.isPending && <Spinner size={14} />}
            重新跑全库测试
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            在全部判定历史上试跑这条正则：FP（正常消息或已撤销的处罚）为 0
            且测试过，服务端才允许开启强制。
          </p>
        </div>
        {test !== null && <RuleTestPanel test={test} tz={tz} />}
      </SectionCard>

      <SectionCard title="危险区">
        <ListRow
          primary="删除该规则"
          secondary="删除后立即从判定快照移除；此操作不可恢复"
          disabled={removeMut.isPending}
          onClick={() => void removeRule()}
          className="text-destructive"
        />
      </SectionCard>
    </div>
  )
}
