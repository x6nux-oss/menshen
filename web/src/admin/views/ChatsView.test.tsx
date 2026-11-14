import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { mockState } from '../../mocks/fixtures'
import { renderPage } from '../../test/renderPage'
import { AdminNavProvider } from '../nav'
import { ChatsView } from './ChatsView'

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

function chatBodies() {
  return mockApi.mock.calls.filter(([op]) => op === 'chat').map(([, body]) => body)
}

describe('ChatsView', () => {
  function render() {
    return renderPage(
      <AdminNavProvider>
        <ChatsView />
      </AdminNavProvider>,
    )
  }

  it('状态筛选按机器人收窄计数，并写入 URL', async () => {
    render()
    await screen.findByText('测试群')

    await userEvent.click(screen.getByRole('button', { name: /^演练/ }))
    await waitFor(() => expect(screen.getByText('演练群')).toBeInTheDocument())
    expect(screen.queryByText('测试群')).not.toBeInTheDocument()
    expect(new URLSearchParams(location.search).get('state')).toBe('dryrun')
  })

  it('判定中与群内展示可同时成立（不互斥）', async () => {
    const state = structuredClone(mockState)
    state.chats[0] = { ...state.chats[0], enabled: true, dryrun: false, group_alert: true }
    mockApi.mockImplementation((async (op: string) => {
      if (op === 'state') return state
      return { ok: true }
    }) as never)
    render()
    await screen.findByText('测试群')

    const filter = screen.getByRole('group', { name: '按群组状态筛选' })
    expect(within(filter).getByRole('button', { name: /判定中/ })).toHaveTextContent('1')
    expect(within(filter).getByRole('button', { name: /群内展示/ })).toHaveTextContent('1')

    await userEvent.click(within(filter).getByRole('button', { name: /判定中/ }))
    expect(screen.getByText('测试群')).toBeInTheDocument()
  })

  it('批量选择只允许同一机器人，全选跳过锁定行', async () => {
    render()
    await screen.findByText('测试群')
    await userEvent.click(screen.getByRole('button', { name: '批量操作' }))

    await userEvent.click(screen.getByRole('checkbox', { name: '选择 测试群' }))
    expect(screen.getByRole('checkbox', { name: '选择 演练群' })).toHaveAttribute(
      'data-disabled',
      '',
    )
    expect(screen.getByText(/已选 1 个/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: '全选当前结果' }))
    expect(screen.queryByText('已选 2 个')).not.toBeInTheDocument()
    expect(screen.getByText(/已选 1 个/)).toBeInTheDocument()
  })

  it('批量启用只提交同 bot 的 chat_ids', async () => {
    render()
    await screen.findByText('测试群')
    await userEvent.click(screen.getByRole('button', { name: '批量操作' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 测试群' }))
    await userEvent.click(screen.getByRole('button', { name: '启用' }))

    await waitFor(() => expect(chatBodies()).toHaveLength(1))
    expect(chatBodies()[0]).toEqual({
      action: 'bulk_update',
      bot_id: 1,
      chat_ids: [-1001234567890],
      fields: { enabled: true },
    })
    expect(await screen.findByText('已启用')).toBeInTheDocument()
  })

  it('批量失败保留选择并提示部分更新可能有生效', async () => {
    mockApi.mockImplementation((async (op: string) => {
      if (op === 'state') return mockState
      if (op === 'chat') throw new Error('保存失败')
      return { ok: true }
    }) as never)
    render()
    await screen.findByText('测试群')
    await userEvent.click(screen.getByRole('button', { name: '批量操作' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '选择 测试群' }))
    await userEvent.click(screen.getByRole('button', { name: '启用' }))

    expect(
      await screen.findByText(/部分更新可能已生效，请核对后重试/),
    ).toBeInTheDocument()
    expect(screen.getByText(/已选 1 个/)).toBeInTheDocument()
  })

  it('机器人筛选保存到 URL 并在重新进入时恢复', async () => {
    history.replaceState(null, '', '/admin/chats?bot=42')
    const view = render()
    await screen.findByText('测试群')
    await userEvent.click(screen.getByRole('combobox', { name: '机器人' }))
    await userEvent.click(await screen.findByRole('option', { name: '演示机器人' }))

    const filter = screen.getByRole('group', { name: '按群组状态筛选' })
    await waitFor(() =>
      expect(within(filter).getByRole('button', { name: /全部/ })).toHaveTextContent('1'),
    )
    expect(screen.getByText('演练群')).toBeInTheDocument()
    expect(screen.queryByText('测试群')).not.toBeInTheDocument()
    expect(new URLSearchParams(location.search).get('bot_filter')).toBe('2')
    expect(new URLSearchParams(location.search).get('bot')).toBe('42')

    view.unmount()
    render()
    await screen.findByText('演练群')
    expect(screen.queryByText('测试群')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('combobox', { name: '机器人' }))
    await userEvent.click(await screen.findByRole('option', { name: '全部机器人' }))
    expect(await screen.findByText('测试群')).toBeInTheDocument()
    expect(new URLSearchParams(location.search).has('bot_filter')).toBe(false)
    expect(new URLSearchParams(location.search).get('bot')).toBe('42')
  })
})
