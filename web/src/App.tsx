// App 外壳：Telegram Mini App（只在 Telegram 内使用）。
//
// 浏览器的桌面端管理面板是独立入口与独立应用（web/src/admin，挂在 /admin），
// 不走这里，也不加载 Telegram SDK。
//
//   1) 初始化中：整页骨架；
//   2) SDK 不可用（不在 Telegram / 拉不到 SDK）：渲染引导页；
//   3) Telegram 里：initData 鉴权，就绪后挂载数据查询。
//
// 契约：鉴权信息就绪前不得发请求（api 鉴权头为空会 401）——桥注入之后才挂载。
//
// 主题（设计文档 §6）：**只跟随 Telegram 的 colorScheme（亮/暗），忽略主题色**。
// 玻璃效果依赖可控的底色；Telegram 允许任意自定义主色，白玻璃叠在自选深蓝上
// 会发脏，且每套自定义主题都要单独调玻璃参数 —— 那是无法收敛的维护路径。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Bot, LayoutDashboard, ReceiptText, ShieldCheck, User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, setApiBridge } from './api/client'
import { useMiniState } from './api/hooks'
import { ErrorBoundary, ErrorState, Skeletons, ToastProvider } from './components/feedback'
import { ActionSheetProvider, TabBar, TopBar } from './components/mobile'
import type { TabBarItem } from './components/mobile'
import { Skeleton } from './components/ui'
import { meLabel } from './lib/format'
import { applyThemeMode } from './lib/theme-mode'
import { NavProvider, PageScope, useNav } from './nav'
import type { Page, TabKey } from './nav'
import { routeSlug } from './route'
import { detailTitle, renderStackPage, renderTabPage, TAB_NAMES } from './shellPages'
import { initTelegram } from './telegram'
import type { TelegramBridge, TelegramTheme } from './telegram'

type Boot =
  | { phase: 'booting' }
  | { phase: 'unavailable' }
  | { phase: 'ready'; bridge: TelegramBridge }

export default function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'booting' })

  useEffect(() => {
    let alive = true
    void initTelegram()
      .then((bridge) => {
        if (!alive) return
        // 查询发出前注入鉴权头；不可用时 initData 为空串，也不会走到查询。
        setApiBridge(bridge)
        setBoot(bridge.available ? { phase: 'ready', bridge } : { phase: 'unavailable' })
      })
      .catch(() => {
        // initTelegram 自身不抛（超时返回不可用桥）；这里兜底注入实现的异常，
        // 让界面落到引导页而不是一直卡在骨架屏。
        if (alive) setBoot({ phase: 'unavailable' })
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="mini-app">
      {boot.phase === 'booting' ? (
        <BootSkeleton />
      ) : boot.phase === 'unavailable' ? (
        <UnavailableGuide />
      ) : (
        <ReadyApp bridge={boot.bridge} />
      )}
    </div>
  )
}

/** colorScheme → 主题模式。缺省（空串/未知）按亮色。 */
function toThemeMode(colorScheme: string): 'dark' | 'light' {
  return colorScheme === 'dark' ? 'dark' : 'light'
}

/**
 * useLiveTheme 订阅 Telegram 的 colorScheme 并把亮/暗写进 <html>。
 * **只读 colorScheme**：themeParams 里的主题色一律忽略（设计文档 §6）。
 */
function useLiveTheme(bridge: TelegramBridge): void {
  useEffect(() => {
    const apply = (theme: TelegramTheme) => applyThemeMode(toThemeMode(theme.colorScheme))
    apply(bridge.getTheme())
    return bridge.onThemeChanged(apply)
  }, [bridge])
}

function ReadyApp({ bridge }: { bridge: TelegramBridge }) {
  useLiveTheme(bridge)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 4xx（身份/权限/参数）重试无意义；网络失败与 5xx 重试一次后交给错误态。
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false
              }
              return failureCount < 1
            },
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <NavProvider backButton={bridge.backButton}>
        <ActionSheetProvider>
          <ToastProvider>
            <ErrorBoundary>
              <Shell />
            </ErrorBoundary>
          </ToastProvider>
        </ActionSheetProvider>
      </NavProvider>
    </QueryClientProvider>
  )
}

/** TABS 是五个一级 Tab。key 用 nav 的 TabKey，图标用 lucide。 */
const TABS: TabBarItem[] = [
  { key: 'overview', label: '概览', icon: <LayoutDashboard /> },
  { key: 'bots', label: '机器人', icon: <Bot /> },
  { key: 'chats', label: '群组', icon: <Users /> },
  { key: 'records', label: '记录', icon: <ReceiptText /> },
  { key: 'mine', label: '我的', icon: <User /> },
]

function Shell() {
  const nav = useNav()
  // 外壳只在桥就绪后挂载，这里 enabled 恒为 true 是安全的。
  const state = useMiniState(true)
  const top = nav.stack.length > 0 ? nav.stack[nav.stack.length - 1] : null

  if (state.isPending) {
    return (
      <div className="mx-auto max-w-7xl px-4 pt-2 lg:px-6">
        <Skeleton className="mb-3 h-7 w-24" />
        <Skeleton className="mb-3 h-22 rounded-lg" />
        <Skeletons rows={3} />
      </div>
    )
  }

  if (state.isError) {
    const status = state.error instanceof ApiError ? state.error.status : 0
    return (
      <>
        <TopBar title="门神" />
        <div className="mx-auto max-w-lg">
          <ErrorState status={status} onRetry={() => void state.refetch()} />
        </div>
      </>
    )
  }

  const me = state.data.me
  const role = me.main ? '主管理员' : '次级管理员'
  const currentName = top ? detailTitle(top, state.data) : TAB_NAMES[nav.tab]
  const section = top ? sectionOf(top) : tabSection(nav.tab)

  return (
    <div className="mini-shell">
      <TopBar
        className="sticky top-0 z-20 lg:px-6"
        brand={top === null}
        title={top ? currentName : TAB_NAMES[nav.tab]}
        subtitle={top ? `${section} · 返回${TAB_NAMES[nav.tab]}` : `${role} · ${meLabel(me)}`}
        onBack={top ? nav.pop : undefined}
      />
      <main
        className="mx-auto w-full max-w-lg px-4 pt-3 lg:max-w-7xl lg:px-6 lg:pt-6"
        style={{ paddingBottom: top ? '1rem' : 'calc(var(--mini-nav-clearance) + 24px)' }}
      >
        {/* Tab 根页常驻：push 二级页时只隐藏不卸载，返回后搜索词/批量选择等内存状态不丢。
            页面级筛选/搜索由 PageScope 写进 URL；被盖住时 active=false，只留内存不写 URL。 */}
        <div className={top ? 'hidden' : 'block'}>
          <PageScope
            key={routeSlug(nav.tab, [])}
            scope={routeSlug(nav.tab, [])}
            active={top === null}
          >
            {renderTabPage(nav.tab)}
          </PageScope>
        </div>
        {top && (
          <PageScope key={routeSlug(nav.tab, nav.stack)} scope={routeSlug(nav.tab, nav.stack)} active>
            {renderStackPage(top)}
          </PageScope>
        )}
      </main>
      <TabBar
        tabs={TABS}
        active={nav.tab}
        onChange={(key) => nav.switchTab(key as TabKey)}
        className={top ? 'hidden lg:block' : undefined}
      />
    </div>
  )
}

/** BootSkeleton 初始化阶段的整页骨架（此时还没有主题与导航）。 */
function BootSkeleton() {
  return (
    <div data-testid="boot-skeleton" className="mx-auto max-w-lg px-4 pt-6 lg:max-w-7xl lg:px-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-24" />
        </div>
      </div>
      <Skeleton className="mb-3 h-22 rounded-lg" />
      <Skeletons rows={3} />
    </div>
  )
}

/** UnavailableGuide 在 SDK 未加载出来时给出可操作提示。 */
function UnavailableGuide() {
  return (
    <div data-testid="unavailable-guide" className="mx-auto max-w-lg p-4 pt-12">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary">门神</p>
          <h1 className="text-[26px] leading-[1.2] font-semibold">需要在 Telegram 中打开</h1>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <p className="text-sm leading-relaxed">
          请通过 Telegram 里的菜单按钮「配置」打开本页。
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          如果你已经在 Telegram 里打开，请关闭后重新打开本页；仍不行请更新 Telegram
          客户端或换网络重试。
        </p>
      </div>
    </div>
  )
}

/** sectionOf 给二级页一个稳定的业务归属，顶部副标题展示当前位置。 */
function sectionOf(page: Page): string {
  switch (page.k) {
    case 'bot':
      return '机器人'
    case 'chat':
      return '群组'
    case 'log':
    case 'user':
    case 'appeal':
      return '记录'
    case 'lists':
      return '名单管理'
    case 'upstreams':
    case 'upstream':
    case 'models':
    case 'model':
    case 'rules':
    case 'rule':
    case 'settings':
    case 'syslog':
    case 'ailog':
    case 'ailogitem':
      return '我的'
  }
}

function tabSection(tab: TabKey): string {
  return TAB_NAMES[tab]
}
