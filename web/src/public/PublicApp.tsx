// 公开网页外壳：按 _w 路径分发到申诉验证 / 原文查看 / 申诉详情。
//
// 主题跟随系统深浅色（Phase 4 起用户可手动覆盖）；不依赖 Telegram SDK，
// 供浏览器直接访问。
//
// 公开页是外部用户的门户：顶部只保留品牌与主题切换，正文按任务分节，
// 不用营销 hero，也不引入玻璃/渐变。下列容器宽度分别服务于「表单」
// 与「需要横向对照的资料页」。
import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ErrorBoundary, ThemeToggle } from '../components/feedback'
import { applyThemeMode, resolveThemeMode, subscribeResolvedTheme } from '../lib/theme-mode'
import { parseRoute } from './api'
import { InvalidState } from './InvalidState'
import { AppealDemoPage } from './pages/AppealDemoPage'
import { AppealVerifyPage } from './pages/AppealVerifyPage'
import { AppealViewPage } from './pages/AppealViewPage'
import { CaptchaDemoPage } from './pages/CaptchaDemoPage'
import { JoinVerifyPage } from './pages/JoinVerifyPage'
import { LogViewPage } from './pages/LogViewPage'

/** 容器宽度按页面性质选：验证页是表单（窄）；查看页有表格（中）；申诉详情要两/三列（宽）。 */
const CONTAINER_WIDTH: Record<string, string> = {
  apv: 'max-w-[1200px]',
  v: 'max-w-[960px]',
  ap: 'max-w-[760px]',
  jv: 'max-w-[720px]',
}

export function PublicApp() {
  const route = useMemo(() => parseRoute(location.pathname), [])
  // 初值读用户显式选择 > 系统偏好（theme-mode 统一了这条规则）。
  const [dark, setDark] = useState(() => resolveThemeMode() === 'dark')

  useEffect(() => {
    applyThemeMode(dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => subscribeResolvedTheme((mode) => setDark(mode === 'dark')), [])

  const width = (route !== null && CONTAINER_WIDTH[route.kind]) || 'max-w-[640px]'

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-4 py-3 sm:px-6">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground [&_svg]:size-[18px]"
          >
            <ShieldCheck />
          </span>
          <div className="min-w-0">
            <p className="text-[16px] leading-5 font-semibold">门神</p>
            <p className="text-[12px] leading-4 text-muted-foreground">安全验证与申诉</p>
          </div>
          <ThemeToggle className="ml-auto" />
        </div>
      </header>
      <main className={`mx-auto w-full ${width} px-4 py-6 sm:px-6 sm:py-8`}>
        {route === null ? (
          <InvalidState message="链接无效或已被替换。" />
        ) : route.kind === 'ap' ? (
          <ErrorBoundary>
            <AppealVerifyPage route={route} />
          </ErrorBoundary>
        ) : route.kind === 'jv' ? (
          <ErrorBoundary>
            <JoinVerifyPage route={route} />
          </ErrorBoundary>
        ) : route.kind === 'demo' ? (
          <ErrorBoundary>
            <CaptchaDemoPage route={route} />
          </ErrorBoundary>
        ) : route.kind === 'apdemo' ? (
          <ErrorBoundary>
            <AppealDemoPage route={route} />
          </ErrorBoundary>
        ) : route.kind === 'v' ? (
          <ErrorBoundary>
            <LogViewPage route={route} />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <AppealViewPage route={route} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}
