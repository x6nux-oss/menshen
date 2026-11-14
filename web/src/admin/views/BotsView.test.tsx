import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { mockState } from '../../mocks/fixtures'
import { renderPage } from '../../test/renderPage'
import { AdminNavProvider } from '../nav'
import { BotsView } from './BotsView'

vi.mock('../../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

beforeEach(() => {
  mockApi.mockReset()
  mockApi.mockImplementation((async (op: string) => {
    if (op === 'state') return mockState
    return { ok: true }
  }) as never)
})

describe('BotsView', () => {
  function render() {
    return renderPage(
      <AdminNavProvider>
        <BotsView />
      </AdminNavProvider>,
    )
  }

  it('运行状态快捷筛选与搜索写入 URL，刷新可还原', async () => {
    render()
    expect(await screen.findByText('门神小助手')).toBeInTheDocument()
    expect(screen.getByText('演示机器人', { exact: false })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /已停用/ }))
    await waitFor(() => expect(screen.queryByText('门神小助手')).not.toBeInTheDocument())
    expect(new URLSearchParams(location.search).get('status')).toBe('disabled')

    await userEvent.type(
      screen.getByRole('searchbox', { name: '搜索名称 / @用户名 / bot id' }),
      '不存在',
    )
    await waitFor(() => expect(screen.getByText(/没有匹配的机器人/)).toBeInTheDocument())
    expect(new URLSearchParams(location.search).get('q')).toBe('不存在')
  })

  it('展示群组数与是否跟随全局模型', async () => {
    render()
    await screen.findByText('门神小助手')
    expect(screen.getByText('跟随全局')).toBeInTheDocument()
    expect(screen.getByText('初判 1 · 复判 全局')).toBeInTheDocument()
    const mainBotRow = screen.getByRole('row', { name: /门神小助手/ })
    expect(within(mainBotRow).getByText('2')).toBeInTheDocument()
  })
})
