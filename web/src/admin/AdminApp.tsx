// 桌面端管理面板的应用外壳：主题、数据查询、全局提示与错误边界。
//
// 与 Mini App 的 App.tsx 是两套独立应用：这里不加载 Telegram SDK，鉴权走
// 会话 cookie（main.tsx 在挂载前注入 X-Web 与目标 bot）。
//
// 主题：全部走新设计系统 —— `<html class="dark">` + oklch token，
// 不再需要 MUI 的 ThemeProvider / CssBaseline（视图已全部迁移完）。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { ErrorBoundary, ToastProvider } from '../components/feedback'
import { applyThemeMode, resolveThemeMode, subscribeSystemTheme } from '../lib/theme-mode'
import { AdminNavProvider } from './nav'
import { AdminShell } from './shell'

export function AdminApp() {
  // 初值读用户显式选择 > 系统偏好（theme-mode 统一了这条规则）。
  const [dark, setDark] = useState(() => resolveThemeMode() === 'dark')

  useEffect(() => {
    applyThemeMode(dark ? 'dark' : 'light')
  }, [dark])

  // 订阅系统偏好只建一次；重复订阅会在每次主题变化时重建监听。
  useEffect(() => subscribeSystemTheme((mode) => setDark(mode === 'dark')), [])

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
      <ToastProvider>
        <ErrorBoundary>
          <AdminNavProvider>
            <AdminShell />
          </AdminNavProvider>
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  )
}
