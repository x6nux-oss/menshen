// 公开网页外壳：按 _w 路径分发到申诉验证 / 原文查看 / 申诉详情。
//
// 主题跟随系统深浅色（Phase 4 起用户可手动覆盖）；不依赖 Telegram SDK，
// 供浏览器直接访问。
//
// 展示层已换到新设计系统：`<html class="dark">` + oklch token + Tailwind，
// 不再需要 MUI 的 ThemeProvider / CssBaseline。
import { useEffect, useMemo, useState } from 'react'
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
  apv: 'max-w-[1100px]',
  v: 'max-w-[900px]',
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

  // 不要给这个容器铺 bg-background：会盖住 body::before 的景深光晕，
  // 玻璃（卡片/弹层）立刻退化成白板（设计文档 §4.6）。
  return (
    <div className={`mx-auto w-full ${width} px-4 py-6 sm:px-6`}>
      <div className="mb-4 flex items-baseline gap-2">
        <h1 className="text-[22px] leading-tight font-bold">门神</h1>
        <span className="text-[13px] text-muted-foreground">反广告申诉与记录查看</span>
        {/* 主题切换推到最右：标题保持左对齐，按钮不参与基线对齐。 */}
        <ThemeToggle className="ml-auto self-center" />
      </div>
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
    </div>
  )
}
