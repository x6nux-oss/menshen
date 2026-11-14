import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { mockAppeals, mockLogs, mockState } from '../../mocks/fixtures'
import { renderPage } from '../../test/renderPage'
import { AdminNavProvider } from '../nav'
import { RecordsView } from './RecordsView'

vi.mock('../../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

beforeEach(() => {
  mockApi.mockReset()
  mockApi.mockImplementation((async (op: string, body?: Record<string, unknown>) => {
    if (op === 'state') return mockState
    if (op === 'logs') {
      const verdict = String(body?.verdict ?? '')
      const logs = verdict ? mockLogs.filter((l) => l.verdict === verdict) : mockLogs
      return { logs, page: Number(body?.page ?? 1), total: logs.length }
    }
    if (op === 'appeals') return { appeals: mockAppeals, page: 1, total: mockAppeals.length }
    return { ok: true }
  }) as never)
})

describe('RecordsView', () => {
  function render() {
    return renderPage(
      <AdminNavProvider>
        <RecordsView />
      </AdminNavProvider>,
    )
  }

  it('?tab=appeals 深链直接落申诉并请求申诉接口', async () => {
    window.history.replaceState(null, '', '/admin/records?tab=appeals')
    render()
    expect(await screen.findByText('（mock）与命中记录一致，维持原判。')).toBeInTheDocument()
    expect(mockApi.mock.calls.some(([op]) => op === 'appeals')).toBe(true)
  })

  it('切到申诉写 URL，切回判定保留映射', async () => {
    window.history.replaceState(null, '', '/admin/records?verdict=all')
    render()
    await screen.findByText('（mock）加我兼职日结，先交押金。')
    await userEvent.click(screen.getByRole('tab', { name: /申诉/ }))
    await waitFor(() => expect(new URLSearchParams(location.search).get('tab')).toBe('appeals'))
    await userEvent.click(screen.getByRole('tab', { name: '判定记录' }))
    await waitFor(() => expect(new URLSearchParams(location.search).has('tab')).toBe(false))
  })

  it('判定筛选与分页写入 URL，并携带服务端参数', async () => {
    window.history.replaceState(null, '', '/admin/records?page=2&verdict=ad')
    render()
    await screen.findByText('（mock）加我兼职日结，先交押金。')

    await waitFor(() => {
      const call = mockApi.mock.calls.find(([op]) => op === 'logs')
      expect(call?.[1]).toMatchObject({ verdict: 'ad', page: 2 })
    })
    expect(screen.getByRole('button', { name: '广告', pressed: true })).toBeInTheDocument()
  })
})
