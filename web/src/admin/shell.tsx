// 管理面板的桌面外壳：左侧侧栏 + 顶部标题栏 + 内容区。
//
// 这是给桌面端单独写的一套外壳，不复用 Mini App 的 TabBar/TopBar/导航栈。
// 路由是简单的一层：一个 section（侧栏项）或它的一个详情页。
//
// 侧栏与顶栏用玻璃（设计文档 §4.4：玻璃只给「浮起」的元素 —— 内容从下面滚过、
// 背后有东西可透的面板）；表格与长列表不用玻璃。
import { useMiniState } from '../api/hooks'
import { ApiError } from '../api/client'
import { ErrorState } from '../components/feedback'
import { GlassPanel, GlassToolbar } from '../components/glass'
import { Button, Skeleton } from '../components/ui'
import { cn } from '../lib/utils'
import { meLabel } from '../lib/format'
import { PageHeader } from './components'
import { useAdminNav } from './nav'
import { sectionOf } from './route'
import type { AdminRoute, Section } from './route'
import { AppealDetailView } from './views/AppealDetailView'
import { BotDetailView } from './views/BotDetailView'
import { BotsView } from './views/BotsView'
import { ChatDetailView } from './views/ChatDetailView'
import { ChatsView } from './views/ChatsView'
import { ListsView } from './views/ListsView'
import { LogDetailView } from './views/LogDetailView'
import { ModelsView, ModelDetailView } from './views/ModelsView'
import { OverviewView } from './views/OverviewView'
import { RecordsView } from './views/RecordsView'
import { RuleDetailView, RulesView } from './views/RulesView'
import { SettingsView } from './views/SettingsView'
import { SysLogView } from './views/SysLogView'
import { UpstreamDetailView } from './views/UpstreamDetailView'
import { UpstreamsView } from './views/UpstreamsView'
import { UserView } from './views/UserView'

/** 侧栏宽度：与旧实现的 224px 对齐（`w-56` = 14rem = 224px）。 */
const SIDEBAR_CLASS = 'w-56'

const PRIMARY: { section: Section; label: string }[] = [
  { section: 'overview', label: '概览' },
  { section: 'bots', label: '机器人' },
  { section: 'chats', label: '群组' },
  { section: 'records', label: '记录' },
]

/** 管理类入口；主管理员全见，次级管理员只看名单（联合封禁）。 */
const MANAGE: { section: Section; label: string; mainOnly: boolean }[] = [
  { section: 'lists', label: '名单管理', mainOnly: false },
  { section: 'upstreams', label: '上游渠道', mainOnly: true },
  { section: 'models', label: '模型定价', mainOnly: true },
  { section: 'rules', label: 'AI 必封规则', mainOnly: true },
  { section: 'syslog', label: '运行日志', mainOnly: true },
  { section: 'settings', label: '全局设置', mainOnly: true },
]

const SECTION_TITLES: Record<Section, string> = {
  overview: '概览',
  bots: '机器人',
  chats: '群组',
  records: '记录',
  lists: '名单管理',
  upstreams: '上游渠道',
  models: '模型定价',
  rules: 'AI 必封规则',
  settings: '全局设置',
  syslog: '运行日志',
}

/** MAIN_ONLY_ROUTES 是主管理员专属路由集合；DETAIL_TITLES 是二级页标题（具体名称由各详情视图补全）。 */
const MAIN_ONLY_ROUTES = new Set<AdminRoute['k']>([
  'upstreams',
  'upstream',
  'models',
  'model',
  'rules',
  'rule',
  'settings',
  'syslog',
])
const DETAIL_TITLES: Partial<Record<AdminRoute['k'], string>> = {
  bot: '机器人详情',
  chat: '群组详情',
  log: '判定记录',
  user: '用户资料',
  appeal: '申诉详情',
  upstream: '上游详情',
  model: '模型详情',
  rule: '规则详情',
}

export function AdminShell() {
  const state = useMiniState(true)

  if (state.isPending) return <ShellSkeleton />
  if (state.isError) {
    const status = state.error instanceof ApiError ? state.error.status : 0
    if (status === 401) return <LoginRequired onRetry={() => void state.refetch()} />
    return (
      <div className="mx-auto max-w-[720px] p-8">
        <ErrorState status={status} onRetry={() => void state.refetch()} />
      </div>
    )
  }

  const me = state.data.me
  return <Layout main={me.main} identityLabel={`${me.main ? '主管理员' : '次级管理员'} · ${meLabel(me)}`} />
}

/** NavItem 是侧栏的一项。当前项标 aria-current="page"（无障碍），并高亮。 */
function NavItem({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'w-full rounded-md px-3 py-2 text-left text-sm transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}

function Layout({ main, identityLabel }: { main: boolean; identityLabel: string }) {
  const { route, go } = useAdminNav()
  const section = sectionOf(route)
  const isDetail = route.k !== section

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* 侧栏：玻璃面板 + 粘在视口高度，独立于内容区滚动。 */}
      <aside className={cn(SIDEBAR_CLASS, 'shrink-0 p-2')}>
        <GlassPanel className="sticky top-2 flex h-[calc(100dvh-1rem)] flex-col rounded-xl p-0">
          <div className="px-4 py-5">
            <p className="text-lg font-bold leading-6">🛡 门神</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{identityLabel}</p>
          </div>

          <nav className="flex flex-col gap-0.5 px-2" aria-label="主导航">
            {PRIMARY.map((item) => (
              <NavItem
                key={item.section}
                label={item.label}
                active={section === item.section && !isDetail}
                onClick={() => go(sectionRoute(item.section))}
              />
            ))}
          </nav>

          <p className="px-4 pb-1 pt-4 text-xs text-muted-foreground">管理</p>
          <nav className="flex flex-col gap-0.5 px-2" aria-label="管理导航">
            {MANAGE.filter((item) => main || !item.mainOnly).map((item) => (
              <NavItem
                key={item.section}
                label={item.label}
                active={section === item.section}
                onClick={() => go(sectionRoute(item.section))}
              />
            ))}
          </nav>

          <div className="mt-auto px-4 py-4">
            <Button variant="outline" size="sm" asChild className="w-full">
              <a href="/admin/logout">退出登录</a>
            </Button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              会话 12 小时有效，过期请回 Telegram 重新获取链接。
            </p>
          </div>
        </GlassPanel>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-10">
          <GlassToolbar className="flex items-center gap-3 rounded-none px-6 py-2.5">
            {isDetail && (
              <Button variant="ghost" size="sm" onClick={() => go(sectionRoute(section), true)}>
                ← 返回
              </Button>
            )}
            <h1 className="text-[17px] font-bold">
              {DETAIL_TITLES[route.k] ?? SECTION_TITLES[section]}
            </h1>
            <span className="ml-auto text-[13px] text-muted-foreground">
              {SECTION_TITLES[section]}
            </span>
          </GlassToolbar>
        </div>
        <div className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-[1360px]">{renderRoute(route, main)}</div>
        </div>
      </main>
    </div>
  )
}

/** sectionRoute 返回侧栏项对应的根路由。 */
function sectionRoute(section: Section): AdminRoute {
  switch (section) {
    case 'lists':
      return { k: 'lists' }
    case 'overview':
      return { k: 'overview' }
    default:
      return { k: section } as AdminRoute
  }
}

/** renderRoute 把路由映射到对应视图。主管理员专属页对次级管理员给一句说明，
 *  也挡住侧栏之外的手改地址直达（服务端权限仍是最终裁决）。 */
function renderRoute(route: AdminRoute, main: boolean) {
  if (!main && MAIN_ONLY_ROUTES.has(route.k)) return <MainOnly />
  switch (route.k) {
    case 'overview':
      return <OverviewView />
    case 'bots':
      return <BotsView />
    case 'bot':
      return <BotDetailView botId={route.id} />
    case 'chats':
      return <ChatsView />
    case 'chat':
      return <ChatDetailView botId={route.botId} chatId={route.chatId} />
    case 'records':
      return <RecordsView />
    case 'log':
      return <LogDetailView id={route.id} />
    case 'user':
      return <UserView id={route.id} />
    case 'appeal':
      return <AppealDetailView id={route.id} />
    case 'lists':
      return <ListsView section={route.section} main={main} />
    case 'upstreams':
      return <UpstreamsView />
    case 'upstream':
      return <UpstreamDetailView id={route.id} />
    case 'models':
      return <ModelsView />
    case 'model':
      return <ModelDetailView name={route.name} />
    case 'rules':
      return <RulesView />
    case 'rule':
      return <RuleDetailView id={route.id} />
    case 'settings':
      return <SettingsView />
    case 'syslog':
      return <SysLogView />
  }
}

/** MainOnly 次级管理员访问主管理员专属页时的说明。 */
export function MainOnly() {
  return (
    <div>
      <PageHeader title="仅主管理员" />
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        该功能由主管理员统一配置。你是次级管理员，可以管理自己名下的机器人与群组。
      </p>
    </div>
  )
}

/** LoginRequired 会话缺失/过期时的指引：回 Telegram 重新拿链接。 */
function LoginRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-[520px] rounded-lg border border-border bg-card p-6">
      <h2 className="mb-2 text-lg font-bold">需要登录</h2>
      <p className="text-sm leading-relaxed">
        请在 Telegram 里打开与 bot 的私聊，点击菜单里的「🖥 网页版（浏览器打开）」获取登录链接；
        链接 10 分钟内有效，打开即登录。
      </p>
      <Button onClick={onRetry} className="mt-4">
        已重新获取，重试
      </Button>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className={cn(SIDEBAR_CLASS, 'shrink-0 border-r border-border p-4')}>
        <Skeleton className="mb-3 h-7 w-24" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="mb-1 h-7 w-full" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="mb-4 h-16 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    </div>
  )
}
