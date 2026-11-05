// 桌面外壳的导航与权限测试。
//
// 覆盖三件在旧壳里就存在、迁移时必须保住的行为：
//   1. 主管理员看到全部侧栏项（含 6 个管理项）；
//   2. 次级管理员只看得到 non-mainOnly 的管理项（上游/模型/规则/运行日志/全局设置不出现）；
//   3. 当前项标 aria-current="page"（无障碍；旧壳用 MUI selected，新壳没有那个类名）。
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { mockState } from '../mocks/fixtures'
import type { State } from '../api/types'
import { AdminNavProvider } from './nav'
import { AdminShell } from './shell'

vi.mock('../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

/** stateOf 返回一份把 me.main 改掉的 state（其余字段沿用 fixture）。 */
function stateOf(main: boolean): State {
  return { ...mockState, me: { ...mockState.me, main } }
}

function renderShell(main: boolean) {
  mockApi.mockImplementation((async (op: string) => {
    if (op === 'state') return stateOf(main)
    return mockState
  }) as never)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminNavProvider>
        <AdminShell />
      </AdminNavProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApi.mockReset()
  window.history.replaceState(null, '', '/admin/?bot=42')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('AdminShell 侧栏', () => {
  it('主管理员：四组主项 + 全 6 个管理项都在', async () => {
    renderShell(true)
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    for (const label of ['概览', '机器人', '群组', '记录']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument()
    }
    const manage = screen.getByRole('navigation', { name: '管理导航' })
    for (const label of ['名单管理', '上游渠道', '模型定价', 'AI 必封规则', '运行日志', '全局设置']) {
      expect(within(manage).getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('次级管理员：只看到 non-mainOnly 的管理项', async () => {
    renderShell(false)
    const manage = await screen.findByRole('navigation', { name: '管理导航' })
    expect(within(manage).getByRole('button', { name: '名单管理' })).toBeInTheDocument()
    for (const label of ['上游渠道', '模型定价', 'AI 必封规则', '运行日志', '全局设置']) {
      expect(within(manage).queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('当前 section 标 aria-current="page"（其余项没有）', async () => {
    renderShell(true)
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    const overview = within(nav).getByRole('button', { name: '概览' })
    expect(overview).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: '机器人' })).not.toHaveAttribute('aria-current')
  })

  it('退出登录是链接到 /admin/logout', async () => {
    renderShell(true)
    const logout = await screen.findByRole('link', { name: '退出登录' })
    expect(logout).toHaveAttribute('href', '/admin/logout')
  })
})
