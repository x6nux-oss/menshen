// AI 调用流水页的契约测试：表头、行渲染、状态筛选、非主管理员不可见。
// api 用 spy 替身，数据取 mocks/fixtures（与 Mini App 的 AI 流水页共用同一份）。
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { mockAILogs, mockState } from '../../mocks/fixtures'
import { AILogView } from './AILogView'

vi.mock('../../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AILogView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockApi.mockReset()
  mockApi.mockImplementation((async (op: string, body?: { status?: string }) => {
    if (op === 'state') return mockState
    if (op === 'ailog') {
      const status = body?.status ?? ''
      const logs = status === '' ? mockAILogs : mockAILogs.filter((l) => (status === 'ok' ? l.status === 'ok' : l.status !== 'ok'))
      return { logs, page: 1, total: logs.length }
    }
    return { ok: true }
  }) as never)
})

describe('AILogView', () => {
  it('渲染表头与流水行', async () => {
    renderView()
    expect(await screen.findByRole('heading', { name: 'AI 调用流水' })).toBeInTheDocument()
    // 等数据到齐（loading 期间表格不渲染）
    expect(await screen.findByText(mockAILogs[0].model)).toBeInTheDocument()
    // 表头
    for (const h of ['时间', '模型', '上游', '状态', '耗时', '用量（入→出）', '开销']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(h) })).toBeInTheDocument()
    }
  })

  it('成功与失败两态都显示为徽标', async () => {
    renderView()
    await screen.findByText(mockAILogs[0].model)
    expect(screen.getAllByText('成功').length).toBeGreaterThanOrEqual(1)
    // 失败行的 status 是后端给的阶段名（如「首字超时」），原样展示
    expect(screen.getAllByText(mockAILogs[1].status).length).toBeGreaterThanOrEqual(1)
  })

  it('耗时按接口的毫秒数值降序和升序排列', async () => {
    renderView()
    await screen.findByText(mockAILogs[0].model)
    const latencyColumn = screen.getByRole('columnheader', { name: /耗时/ })
    const latencyButton = within(latencyColumn).getByRole('button')
    const latencies = () => screen.getAllByRole('row').slice(1).map((row) =>
      within(row).getAllByRole('cell')[4].textContent,
    )

    await userEvent.click(latencyButton)
    expect(latencyColumn).toHaveAttribute('aria-sort', 'descending')
    expect(latencies()).toEqual(['15003 ms', '812 ms'])

    await userEvent.click(latencyButton)
    expect(latencyColumn).toHaveAttribute('aria-sort', 'ascending')
    expect(latencies()).toEqual(['812 ms', '15003 ms'])
  })

  it('切换结果为「失败」时请求带 status=err', async () => {
    renderView()
    await screen.findByText(mockAILogs[0].model)

    await userEvent.click(screen.getByRole('combobox', { name: '结果' }))
    await userEvent.click(await screen.findByRole('option', { name: '失败' }))

    await waitFor(() => {
      const calls = mockApi.mock.calls.filter((c) => c[0] === 'ailog')
      expect(calls.some((c) => (c[1] as { status?: string })?.status === 'err')).toBe(true)
    })
  })

  it('非主管理员看不到流水内容', async () => {
    mockApi.mockImplementation((async (op: string) => {
      if (op === 'state') return { ...mockState, me: { ...mockState.me, main: false } }
      return { ok: true }
    }) as never)

    renderView()
    expect(await screen.findByText(/只对主管理员开放/)).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /模型/ })).not.toBeInTheDocument()
  })
})
