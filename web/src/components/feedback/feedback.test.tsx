// 反馈层组件的契约测试。
//
// 两处与 brief 的差异（以旧实现为准）：`useToast()` 直接返回函数（不是 { show }
// 对象）；`Skeletons` 默认 3 行（不是 1 行）。
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  EmptyState,
  ErrorBoundary,
  ErrorState,
  Skeletons,
  ToastProvider,
  useToast,
} from './index'

describe('ToastProvider / useToast', () => {
  // 旧实现与 10+ 个调用点都用 `const toast = useToast(); toast('…')` 的形式，
  // 所以这里断言它返回可直接调用的函数（回归保护：别改成 { show } 对象）。
  function Probe() {
    const toast = useToast()
    return <button onClick={() => toast('已保存')}>触发</button>
  }

  it('useToast 返回可直接调用的函数（不是 { show } 对象）', async () => {
    // 旧实现与 10+ 个调用点都用 `const toast = useToast(); toast('…')`。
    // 这里用「直接调用」来证明签名：若是 { show } 对象，`toast('…')` 会抛
    // TypeError（不是函数），消息也就不会出现。
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '触发' }))
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })

  it('调用后消息出现在文档里', async () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '触发' }))
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('渲染标题与说明', () => {
    render(<EmptyState title="暂无记录" description="换个筛选试试" />)
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
    expect(screen.getByText('换个筛选试试')).toBeInTheDocument()
  })

  it('保留 data-testid="empty-state" 且默认带图标', () => {
    render(<EmptyState title="空" />)
    const el = screen.getByTestId('empty-state')
    expect(el.querySelector('svg')).not.toBeNull()
  })

  it('有 action 时渲染操作按钮', () => {
    render(<EmptyState title="空" action={<button>去添加</button>} />)
    expect(screen.getByRole('button', { name: '去添加' })).toBeInTheDocument()
  })

  it('可传自定义图标', () => {
    render(<EmptyState title="空" icon={<span data-testid="my-icon" />} />)
    expect(screen.getByTestId('my-icon')).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  // 文案逐字来自旧 src/ui/ErrorState.tsx 的 copyFor()，两处必须一致。
  it('401 提示身份失效', () => {
    render(<ErrorState status={401} />)
    expect(screen.getByText('请通过 Telegram 菜单按钮打开')).toBeInTheDocument()
  })

  it('403 提示无权限', () => {
    render(<ErrorState status={403} />)
    expect(screen.getByText('没有权限')).toBeInTheDocument()
  })

  it('其余状态（含 0 网络失败）提示网络异常', () => {
    render(<ErrorState status={0} />)
    expect(screen.getByText('网络异常')).toBeInTheDocument()
  })

  it('有 onRetry 时渲染重试按钮并回调', async () => {
    const onRetry = vi.fn()
    render(<ErrorState status={500} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('无 onRetry 时不渲染重试按钮', () => {
    render(<ErrorState status={0} />)
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })
})

describe('Skeletons', () => {
  it('渲染指定行数', () => {
    render(<Skeletons rows={5} />)
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5)
  })

  it('默认 3 行（与旧实现一致）', () => {
    render(<Skeletons />)
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(3)
  })

  it('保留 data-testid="skeletons"', () => {
    render(<Skeletons />)
    expect(screen.getByTestId('skeletons')).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('boom')
  }

  it('子组件抛错时渲染兜底而非整页崩', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('可自定义标题', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary title="出错了">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('出错了')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('正常子树原样渲染', () => {
    render(
      <ErrorBoundary>
        <div>正常</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常')).toBeInTheDocument()
  })
})
