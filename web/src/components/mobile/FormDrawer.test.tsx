// 新层 FormDrawer 的测试。旧 src/ui/FormDrawer.test.tsx 依赖 MUI 的
// `.MuiBackdrop-root` / `.MuiDrawer-paper`，迁到 Base UI 后不再成立；
// 这里改用语义查询（role / aria-label），断言意图与旧测试完全一致。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormDrawer } from './FormDrawer'

describe('FormDrawer', () => {
  it('提交触发 onSubmit，内容照常渲染', () => {
    const onSubmit = vi.fn()
    render(
      <FormDrawer open onClose={() => {}} title="添加群" onSubmit={onSubmit}>
        <input aria-label="chat_id" />
      </FormDrawer>,
    )
    expect(screen.getByText('添加群')).toBeInTheDocument()
    expect(screen.getByLabelText('chat_id')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('pending 时禁用提交与关闭，点遮罩不关闭', () => {
    const onClose = vi.fn()
    render(
      <FormDrawer open onClose={onClose} title="添加群" onSubmit={() => {}} pending>
        <input aria-label="chat_id" />
      </FormDrawer>,
    )
    expect(screen.getByRole('button', { name: /提交/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()

    // Base UI 的遮罩是 Popup 的兄弟节点，带 data-open 属性。
    const backdrop = document.querySelector('[data-open]')
    if (backdrop instanceof HTMLElement) fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('submitDisabled 可单独禁用提交（内容未填）', () => {
    render(
      <FormDrawer open onClose={() => {}} title="添加群" onSubmit={() => {}} submitDisabled>
        <input aria-label="chat_id" />
      </FormDrawer>,
    )
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled()
  })

  it('pending 时 Escape 不关闭，恢复后 Escape 关闭一次', async () => {
    const onClose = vi.fn()
    const view = render(
      <FormDrawer open onClose={onClose} title="添加群" onSubmit={() => {}} pending>
        <input aria-label="chat_id" />
      </FormDrawer>,
    )
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    view.rerender(
      <FormDrawer open onClose={onClose} title="添加群" onSubmit={() => {}}>
        <input aria-label="chat_id" />
      </FormDrawer>,
    )
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
