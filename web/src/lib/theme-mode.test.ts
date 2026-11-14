import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeMode,
  resolveThemeMode,
  setStoredTheme,
  storedTheme,
  subscribeResolvedTheme,
  subscribeThemeChoice,
  systemTheme,
} from './theme-mode'

/** stubMatchMedia 让 systemTheme 读到指定偏好。 */
function stubSystem(dark: boolean) {
  let current = dark
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  window.matchMedia = ((q: string) => ({
    get matches() {
      return current
    },
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      current = next
      for (const listener of listeners) {
        listener({
          matches: current,
          media: '(prefers-color-scheme: dark)',
        } as MediaQueryListEvent)
      }
    },
  }
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

  it('subscribeResolvedTheme：显式选择优先，恢复系统后重新跟随', () => {
    const system = stubSystem(false)
    const seen: Array<'light' | 'dark'> = []
    const off = subscribeResolvedTheme((mode) => seen.push(mode))

    setStoredTheme('dark')
    system.set(true)
    system.set(false)
    setStoredTheme(null)
    system.set(true)

    expect(seen).toEqual(['dark', 'dark', 'dark', 'light', 'dark'])
    off()
  })
})
