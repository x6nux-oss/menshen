// 桌面端管理面板的应用外壳：主题、数据查询、全局提示与错误边界。
//
// 与 Mini App 的 App.tsx 是两套独立应用：这里不加载 Telegram SDK，鉴权走
// 会话 cookie（main.tsx 在挂载前注入 X-Web 与目标 bot）。
//
// 主题：新设计系统（Tailwind + oklch token）走 `<html class="dark">`；
// 旧 MUI 组件（视图尚未迁移完）仍需要 ThemeProvider，两者并存到 Phase 2 结束。
import { CssBaseline } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import { ErrorBoundary, ToastProvider } from '../ui'
import { applyThemeMode } from '../lib/theme-mode'
import { AdminNavProvider } from './nav'
import { AdminShell } from './shell'
import { buildAdminTheme, prefersDark, subscribeSystemTheme } from './theme'

export function AdminApp() {
  const [dark, setDark] = useState(prefersDark)

  // 同步两套主题：MUI 的 ThemeProvider（旧组件）+ <html class="dark">（新组件）。
  // 两者由同一个 dark 状态驱动，不会分叉。
  useEffect(() => {
    applyThemeMode(dark ? 'dark' : 'light')
  }, [dark])

  // 订阅系统偏好只建一次；重复订阅会在每次主题变化时重建监听。
  useEffect(() => subscribeSystemTheme(setDark), [])

  const theme = useMemo(() => buildAdminTheme(dark), [dark])

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
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        {/* ToastProvider 暂时仍用旧版（src/ui）：视图与 admin/feedback.ts 还在用
            旧的 useToast，换成本层实现会让它们拿到新 Context 而抛错。
            Phase 2 的视图迁移完成后与本文件一起切换。 */}
        <ToastProvider>
          <ErrorBoundary>
            <AdminNavProvider>
              <AdminShell />
            </AdminNavProvider>
          </ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
