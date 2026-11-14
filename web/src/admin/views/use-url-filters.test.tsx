import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { choiceParam, intParam, textParam, useUrlFilter } from './use-url-filters'

const STATES = ['all', 'open', 'closed'] as const
const STATE_PARAM = choiceParam(STATES)
const TEXT_PARAM = textParam()
const PAGE_PARAM = intParam(1)

function Harness() {
  const [state, setState] = useUrlFilter('tab', 'all', STATE_PARAM)
  const [q, setQ] = useUrlFilter('q', '', TEXT_PARAM)
  const [page, setPage] = useUrlFilter('page', 1, PAGE_PARAM)
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="q">{q}</span>
      <span data-testid="page">{page}</span>
      <button onClick={() => setState('open')}>open</button>
      <button onClick={() => setQ('广告')}>search</button>
      <button onClick={() => setPage(3)}>page</button>
      <button onClick={() => setState('all')}>reset</button>
    </div>
  )
}

describe('useUrlFilter', () => {
  it('初值来自 URL，非法枚举/页码回退默认值', () => {
    window.history.replaceState(null, '', '/admin/records?tab=open&page=oops&q=x')
    render(<Harness />)
    expect(screen.getByTestId('state')).toHaveTextContent('open')
    expect(screen.getByTestId('page')).toHaveTextContent('1')
    expect(screen.getByTestId('q')).toHaveTextContent('x')
  })

  it('写入 URL 时保留 ?bot=，默认值删除参数', async () => {
    window.history.replaceState(null, '', '/admin/bots?bot=2')
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('button', { name: 'search' }))
    await userEvent.click(screen.getByRole('button', { name: 'page' }))

    const params = new URLSearchParams(location.search)
    expect(params.get('tab')).toBe('open')
    expect(params.get('q')).toBe('广告')
    expect(params.get('page')).toBe('3')
    expect(params.get('bot')).toBe('2')

    await userEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(new URLSearchParams(location.search).has('tab')).toBe(false)
    expect(new URLSearchParams(location.search).get('bot')).toBe('2')
  })

  it('popstate 从 URL 回填，卸载后不再监听', async () => {
    window.history.replaceState(null, '', '/admin/records?tab=all')
    const { unmount } = render(<Harness />)

    act(() => {
      window.history.replaceState(null, '', '/admin/records?tab=closed')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'))

    unmount()
    expect(() => {
      window.history.replaceState(null, '', '/admin/records?tab=open')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }).not.toThrow()
  })
})
