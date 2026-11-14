import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, api } from '../../api/client'
import { mockState } from '../../mocks/fixtures'
import { AdminNavProvider } from '../nav'
import { OverviewView } from './OverviewView'

vi.mock('../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  api: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(api).mockReset()
  history.replaceState(null, '', '/admin/?bot=42')
})

it('最近命中加载失败显示重试，不误报没有命中', async () => {
  vi.mocked(api).mockImplementation((async (operation: string) => {
    if (operation === 'state') return mockState
    throw new ApiError(503, '服务暂不可用')
  }) as never)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminNavProvider><OverviewView /></AdminNavProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByTestId('error-state')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  expect(screen.queryByText('暂无命中记录')).not.toBeInTheDocument()
})
