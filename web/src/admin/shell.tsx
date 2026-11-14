import { Activity, ArrowLeft, ArrowUpRight, Bot, ChevronRight, CircleUserRound, Coins, Command, FileClock, LayoutDashboard, ListFilter, LogOut, Menu, Network, Search, Settings2, ShieldCheck, ShieldX, Users, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useMiniState } from '../api/hooks'
import { ApiError } from '../api/client'
import { ErrorState, ThemeToggle } from '../components/feedback'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Sheet, SheetContent, SheetTitle, SheetTrigger, Skeleton } from '../components/ui'
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
import { AILogView } from './views/AILogView'
import { UpstreamDetailView } from './views/UpstreamDetailView'
import { UpstreamsView } from './views/UpstreamsView'
import { UserView } from './views/UserView'

const SIDEBAR_CLASS = 'w-60'

interface NavEntry {
  section: Section
  label: string
  icon: LucideIcon
  mainOnly?: boolean
}

const PRIMARY: NavEntry[] = [
  { section: 'overview', label: '概览', icon: LayoutDashboard },
  { section: 'bots', label: '机器人', icon: Bot },
  { section: 'chats', label: '群组', icon: Users },
  { section: 'records', label: '记录', icon: FileClock },
]

const MANAGE: NavEntry[] = [
  { section: 'lists', label: '名单管理', icon: ListFilter },
  { section: 'rules', label: 'AI 必封规则', icon: ShieldX, mainOnly: true },
  { section: 'upstreams', label: '上游渠道', icon: Network, mainOnly: true },
  { section: 'models', label: '模型定价', icon: Coins, mainOnly: true },
  { section: 'ailog', label: 'AI 调用流水', icon: Workflow, mainOnly: true },
  { section: 'syslog', label: '运行日志', icon: Activity, mainOnly: true },
  { section: 'settings', label: '全局设置', icon: Settings2, mainOnly: true },
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
  ailog: 'AI 调用流水',
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
  'ailog',
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

function NavItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: LucideIcon
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-sidebar-muted',
        active ? 'bg-sidebar-accent font-semibold text-sidebar-foreground' : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.7} aria-hidden />
      {label}
      {active && <span aria-hidden className="ml-auto size-1.5 rounded-full bg-sidebar-foreground" />}
    </button>
  )
}

function Layout({ main, identityLabel }: { main: boolean; identityLabel: string }) {
  const { route, go } = useAdminNav()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const section = sectionOf(route)
  const isDetail = route.k !== section
  const destinations = [...PRIMARY, ...MANAGE].filter((item) => main || !item.mainOnly)
  const results = destinations.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function navigate(next: AdminRoute) {
    go(next)
    setMenuOpen(false)
    setSearchOpen(false)
  }

  const navigation = (
    <>
      <div className="flex items-center gap-3 px-6 pb-8 pt-7">
        <span className="grid size-10 place-items-center rounded-xl border border-sidebar-border bg-sidebar-accent">
          <ShieldCheck className="size-6" strokeWidth={1.6} aria-hidden />
        </span>
        <div>
          <p className="text-xl font-semibold tracking-[0.1em]">门神</p>
          <p className="mt-0.5 text-[10px] tracking-[0.2em] text-sidebar-muted">MENSHEN</p>
        </div>
      </div>

      <p className="px-6 pb-2 text-[11px] tracking-wider text-sidebar-muted">工作空间</p>
      <nav className="flex flex-col gap-1 px-3" aria-label="主导航">
        {PRIMARY.map((item) => (
          <NavItem
            key={item.section}
            label={item.label}
            icon={item.icon}
            active={section === item.section}
            onClick={() => navigate(sectionRoute(item.section))}
          />
        ))}
      </nav>

      <p className="px-6 pb-2 pt-7 text-[11px] tracking-wider text-sidebar-muted">配置与审计</p>
      <nav className="flex flex-col gap-1 px-3" aria-label="管理导航">
        {MANAGE.filter((item) => main || !item.mainOnly).map((item) => (
          <NavItem
            key={item.section}
            label={item.label}
            icon={item.icon}
            active={section === item.section}
            onClick={() => navigate(sectionRoute(item.section))}
          />
        ))}
      </nav>

      <div className="mt-auto px-5 pb-5 pt-8">
        <div className="flex items-center gap-2.5 border-t border-sidebar-border pt-4">
          <CircleUserRound className="size-8 shrink-0 text-sidebar-muted" strokeWidth={1.3} aria-hidden />
          <p className="min-w-0 flex-1 text-xs leading-5 text-sidebar-muted">{identityLabel}</p>
          <a href="/admin/logout" aria-label="退出登录" title="退出登录" className="grid size-9 shrink-0 place-items-center rounded-md text-sidebar-muted outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-muted">
            <LogOut className="size-4" aria-hidden />
          </a>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-dvh text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">跳到主要内容</a>
      <aside className={cn(SIDEBAR_CLASS, 'hidden shrink-0 bg-sidebar text-sidebar-foreground lg:block')}>
        <div className="sticky top-0 flex h-dvh flex-col overflow-y-auto">
          {navigation}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b border-border bg-card px-4 sm:px-8">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger render={
                <Button variant="ghost" size="icon" aria-label="打开导航" className="lg:hidden">
                  <Menu className="size-5" aria-hidden />
                </Button>
              } />
              <SheetContent side="left" aria-modal="true" className="flex w-72 flex-col rounded-none border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">导航</SheetTitle>
                {navigation}
              </SheetContent>
            </Sheet>
            {isDetail && (
              <Button variant="ghost" size="icon" aria-label="返回列表" onClick={() => go(sectionRoute(section), true)}>
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
            )}
            <nav aria-label="当前位置" className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
              <span className="hidden text-muted-foreground sm:inline">工作空间</span>
              <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden />
              <span className="truncate font-medium">{DETAIL_TITLES[route.k] ?? SECTION_TITLES[section]}</span>
            </nav>
            <Button variant="outline" onClick={() => { setSearch(''); setSearchOpen(true) }} aria-label="前往页面" className="h-9 gap-2 px-2.5 text-muted-foreground sm:w-56 sm:justify-start">
              <Search className="size-4" aria-hidden />
              <span className="hidden sm:inline">前往页面…</span>
              <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border px-1 text-[10px] sm:flex"><Command className="size-2.5" aria-hidden />K</kbd>
            </Button>
            <ThemeToggle />
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1440px]">{renderRoute(route, main)}</div>
        </main>
      </div>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogTitle>前往页面</DialogTitle>
          <DialogDescription className="mt-1">搜索功能名称，快速进入工作区。</DialogDescription>
          <Input autoFocus aria-label="搜索页面" placeholder="例如：群组、模型、记录" value={search} onChange={(event) => setSearch(event.target.value)} className="my-4" />
          <div className="max-h-[45dvh] overflow-y-auto">
            {results.map((item) => (
              <button type="button" key={item.section} onClick={() => navigate(sectionRoute(item.section))} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                {item.label}
                <ArrowUpRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </button>
            ))}
            {results.length === 0 && <p role="status" className="py-8 text-center text-sm text-muted-foreground">没有匹配的页面，试试其他关键词。</p>}
          </div>
        </DialogContent>
      </Dialog>
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
    case 'ailog':
      return <AILogView />
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
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center px-5 py-12">
      <div className="mb-8 flex items-center gap-3 text-primary"><ShieldCheck className="size-8" aria-hidden /><span className="text-xl font-semibold">门神</span></div>
      <div className="rounded-xl border border-border bg-card p-8">
      <h1 className="mb-3 text-2xl font-semibold">需要登录</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        请在 Telegram 打开与机器人的私聊，点击「网页版（浏览器打开）」获取登录链接。
        链接 10 分钟内有效，打开即登录。
      </p>
      <Button onClick={onRetry} className="mt-6 w-full">
        已重新获取，重试
      </Button>
      </div>
      <p className="mt-5 text-center text-xs text-muted-foreground">会话有效期为 12 小时 · 使用 Telegram 身份安全登录</p>
    </main>
  )
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className={cn(SIDEBAR_CLASS, 'hidden shrink-0 border-r border-border bg-card p-6 lg:block')}>
        <Skeleton className="mb-10 h-10 w-28" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="mb-3 h-9 w-full" />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="h-[68px] border-b border-border bg-card" />
        <div className="p-4 sm:p-8">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mb-8 mt-3 h-4 w-60" />
          <Skeleton className="mb-6 h-20 w-full" />
          <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-36" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  )
}
