// 桌面端管理面板的外壳测试：会话有效时渲染侧栏与内容，401 时给登录指引。
// api 替换为 spy，其余（ApiError）保真。
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { mockLogs, mockState } from '../mocks/fixtures'
import { AdminApp } from './AdminApp'

vi.mock('../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

function mockSystemTheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark'
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
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
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    set(next: 'light' | 'dark') {
      dark = next === 'dark'
      for (const listener of listeners) {
        listener({ matches: dark, media: media.media } as MediaQueryListEvent)
      }
    },
  }
}

function mockApiByOp() {
  mockApi.mockImplementation((async (op: string) => {
    if (op === 'state') return mockState
    if (op === 'logs') return { logs: mockLogs, page: 1, total: mockLogs.length }
    return { ok: true }
  }) as never)
}

beforeEach(() => {
  mockApi.mockReset()
  window.history.replaceState(null, '', '/admin/?bot=42')
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
})

describe('AdminApp', () => {
  it('会话有效：侧栏列出入口，内容区渲染概览', async () => {
    mockApiByOp()
    render(<AdminApp />)

    expect(await screen.findByText('🛡 门神')).toBeInTheDocument()
    expect(screen.getAllByText('机器人').length).toBeGreaterThan(0)
    expect(screen.getAllByText('群组').length).toBeGreaterThan(0)
    expect(screen.getAllByText('记录').length).toBeGreaterThan(0)
    expect(screen.getByText('退出登录')).toBeInTheDocument()
    // 概览的指标卡。
    expect((await screen.findAllByText('近 24 小时')).length).toBeGreaterThan(0)
  })

  it('会话过期（state 401）：显示获取登录链接的指引', async () => {
    mockApi.mockImplementation((async (op: string) => {
      if (op === 'state') throw new ApiError(401, '网页版登录已过期')
      return { ok: true }
    }) as never)
    render(<AdminApp />)

    expect(await screen.findByText('需要登录')).toBeInTheDocument()
    expect(screen.getByText(/🖥 网页版（浏览器打开）/)).toBeInTheDocument()
  })

  it('系统主题变化不覆盖用户显式选择', async () => {
    const system = mockSystemTheme('light')
    localStorage.setItem('menshen-theme', 'dark')
    mockApiByOp()
    render(<AdminApp />)

    await screen.findByText('🛡 门神')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => system.set('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('回到跟随系统后与当前系统主题保持一致', async () => {
    const system = mockSystemTheme('dark')
    mockApiByOp()
    render(<AdminApp />)

    await screen.findByText('🛡 门神')
    const toggle = screen.getByRole('button', { name: '主题：跟随系统' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(localStorage.getItem('menshen-theme')).toBe('dark')

    fireEvent.click(toggle)
    expect(localStorage.getItem('menshen-theme')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => system.set('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
