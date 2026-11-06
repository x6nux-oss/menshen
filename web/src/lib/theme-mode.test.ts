import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeMode,
  resolveThemeMode,
  setStoredTheme,
  storedTheme,
  subscribeThemeChoice,
  systemTheme,
} from './theme-mode'

/** stubMatchMedia 让 systemTheme 读到指定偏好。 */
function stubSystem(dark: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: dark,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('theme-mode', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.restoreAllMocks()
  })

  it('storedTheme 缺省为 null；写入后可读回', () => {
    expect(storedTheme()).toBeNull()
    setStoredTheme('dark')
    expect(storedTheme()).toBe('dark')
    setStoredTheme(null)
    expect(storedTheme()).toBeNull()
  })

  it('storedTheme 忽略非法值（防止手改 localStorage 后卡在无效态）', () => {
    localStorage.setItem('menshen-theme', 'purple')
    expect(storedTheme()).toBeNull()
  })

  it('resolveThemeMode：显式选择压过系统偏好', () => {
    stubSystem(false)
    expect(resolveThemeMode()).toBe('light')
    setStoredTheme('dark')
    expect(resolveThemeMode()).toBe('dark')
  })

  it('systemTheme 无 matchMedia 时按亮色', () => {
    // @ts-expect-error 故意删掉，模拟 jsdom 的默认状态
    delete window.matchMedia
    expect(systemTheme()).toBe('light')
  })

  it('applyThemeMode 写 <html> 的 class 与 color-scheme', () => {
    applyThemeMode('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyThemeMode('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('setStoredTheme 通知同页订阅者（外壳据此同步自己的 dark 状态）', () => {
    const seen: Array<'light' | 'dark' | null> = []
    const off = subscribeThemeChoice((mode) => seen.push(mode))

    setStoredTheme('dark')
    setStoredTheme(null)

    expect(seen).toEqual(['dark', null])
    off()
    setStoredTheme('light')
    // 取消订阅后不再收到
    expect(seen).toEqual(['dark', null])
  })
})
