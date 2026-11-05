// 亮/暗模式解析与订阅。三个前端面共用：
//   - Mini App：由 Telegram colorScheme 决定（App 把结果写成 .dark 类）
//   - 桌面面板 / 公开页：用户手动选择存 localStorage，缺省跟随系统
// 本模块只管「解析与订阅」，不直接操作 DOM（由各 app 的入口应用结果）。
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'menshen-theme'

/** systemTheme 读系统偏好；无 matchMedia（测试）时按亮色。 */
export function systemTheme(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** storedTheme 读用户显式选择；没存过或值非法时返回 null（= 跟随系统）。 */
export function storedTheme(): ThemeMode | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

/** resolveThemeMode 按优先级解析：用户显式选择 > 系统偏好。 */
export function resolveThemeMode(): ThemeMode {
  return storedTheme() ?? systemTheme()
}

/** setStoredTheme 持久化用户选择；传 null 表示恢复跟随系统。 */
export function setStoredTheme(mode: ThemeMode | null): void {
  if (typeof localStorage === 'undefined') return
  if (mode === null) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, mode)
}

/**
 * subscribeSystemTheme 订阅系统偏好变化。返回值变化时回调；
 * 用户已显式选择时回调值仍会给出系统值，由调用方决定是否采用。
 * 无 matchMedia 时返回空取消函数。
 */
export function subscribeSystemTheme(cb: (mode: ThemeMode) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light')
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

/**
 * applyThemeMode 把模式写进 <html> 的 class 与 color-scheme。
 * 这是唯一直接操作 DOM 的函数，各 app 入口调用。
 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}
