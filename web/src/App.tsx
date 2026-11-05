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
import { Bot, LayoutDashboard, ReceiptText, User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, setApiBridge } from './api/client'
import { useMiniState } from './api/hooks'
import { ErrorBoundary } from './components/feedback'
import { ErrorState, Skeletons } from './components/feedback'
import { TabBar, TopBar } from './components/mobile'
import type { TabBarItem } from './components/mobile'
import { Skeleton } from './components/ui'
import { meLabel } from './lib/format'
import { applyThemeMode } from './lib/theme-mode'
import { NavProvider, PageScope, useNav } from './nav'
import type { TabKey } from './nav'
import { routeSlug } from './route'
import { detailTitle, renderStackPage, renderTabPage, TAB_NAMES } from './shellPages'
import { initTelegram } from './telegram'
import type { TelegramBridge, TelegramTheme } from './telegram'
// ponytail: 19 个页面还 import 旧 src/ui 的 useToast/useConfirm，Provider 暂时用旧版；
// Task 9 删 src/ui 时一并换成 components/feedback + components/mobile 的同名件。
import { ActionSheetProvider, ToastProvider } from './ui'

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

  if (boot.phase === 'booting') return <BootSkeleton />
  if (boot.phase === 'unavailable') return <UnavailableGuide />
  return <ReadyApp bridge={boot.bridge} />
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
      <div className="px-4 pt-2">
        <Skeleton className="mx-auto mb-2 h-7 w-24" />
        <Skeleton className="mb-3 h-22 rounded-xl" />
        <Skeletons rows={3} />
      </div>
    )
  }

  if (state.isError) {
    const status = state.error instanceof ApiError ? state.error.status : 0
    return (
      <>
        <TopBar title="门神" />
        <ErrorState status={status} onRetry={() => void state.refetch()} />
      </>
    )
  }

  const me = state.data.me
  const role = me.main ? '主管理员' : '次级管理员'
  const currentName = top ? detailTitle(top, state.data) : TAB_NAMES[nav.tab]

  return (
    <>
      {/* 顶栏 sticky：旧实现用 MUI AppBar position="sticky"，内容从下方滚过时
          玻璃才有东西可模糊（设计文档 §4.4）。z 低于 TabBar 的 30。 */}
      <TopBar
        className="sticky top-0 z-20"
        title={top ? currentName : '门神'}
        subtitle={top ? undefined : `${role} · ${meLabel(me)}`}
        onBack={top ? nav.pop : undefined}
      />
      {/* 不要给这个 main 铺不透明底色：会盖住 body::before 的景深光晕，
          玻璃（顶栏/底栏/弹层）立刻退化成白板（设计文档 §4.6）。
          根页给固定 Tab 栏留位；二级页 Tab 栏隐藏，留常规底部间距。 */}
      <main
        className="px-4 pt-1"
        style={{ paddingBottom: top ? '1rem' : 'calc(72px + env(safe-area-inset-bottom))' }}
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
      {/* 二级页有自己的底部操作栏；Tab 栏只在 tab 根页出现（与旧实现一致）。 */}
      {top === null && (
        <TabBar
          tabs={TABS}
          active={nav.tab}
          onChange={(key) => nav.switchTab(key as TabKey)}
        />
      )}
    </>
  )
}

/** BootSkeleton 初始化阶段的整页骨架（此时还没有主题与导航）。 */
function BootSkeleton() {
  return (
    <div data-testid="boot-skeleton" className="min-h-dvh px-4 pt-6">
      <Skeleton className="mx-auto h-7 w-20" />
      <Skeleton className="mx-auto mt-1 mb-4 h-5 w-36" />
      <Skeleton className="mb-3 h-22 rounded-xl" />
      <Skeletons rows={3} />
    </div>
  )
}

/** UnavailableGuide 在 SDK 未加载出来时给出可操作提示。 */
function UnavailableGuide() {
  return (
    <div data-testid="unavailable-guide" className="min-h-dvh p-4 pt-12">
      <div className="rounded-xl bg-card p-4 text-card-foreground shadow-sm">
        <p className="text-[15px] leading-relaxed">
          请通过 Telegram 里的菜单按钮「配置」打开本页。
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          如果你已经在 Telegram 里打开，请关闭后重新打开本页；仍不行请更新 Telegram
          客户端或换网络重试。
        </p>
      </div>
    </div>
  )
}
