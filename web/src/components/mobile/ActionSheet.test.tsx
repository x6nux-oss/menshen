import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ActionSheetProvider, useConfirm } from './ActionSheet'

function Harness() {
  const confirm = useConfirm()
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          void confirm({
            title: '删除该模型？',
            description: '此操作不可恢复。',
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
          })
        }
      >
        打开删除确认
      </button>
      <button type="button">背景操作</button>
    </div>
  )
}

describe('ActionSheet modal behavior', () => {
  it('routes focus-guard Tab boundaries back into the confirmation', async () => {
    const user = userEvent.setup()
    render(
      <ActionSheetProvider>
        <Harness />
      </ActionSheetProvider>,
    )

    const trigger = screen.getByRole('button', { name: '打开删除确认' })
    const background = screen.getByRole('button', { name: '背景操作' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除' })).toHaveFocus(),
    )
    const confirm = screen.getByRole('button', { name: '删除' })
    const cancel = screen.getByRole('button', { name: '取消' })
    expect(background.closest('[aria-hidden="true"]')).not.toBeNull()

    const guards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-base-ui-focus-guard][data-type="inside"]',
      ),
    )
    expect(guards).toHaveLength(2)
    guards[0].focus()
    await waitFor(() => expect(cancel).toHaveFocus())
    guards[1].focus()
    await waitFor(() => expect(confirm).toHaveFocus())
    expect(dialog).toContainElement(confirm)
  })

  it('restores focus to the trigger after cancellation', async () => {
    const user = userEvent.setup()
    render(
      <ActionSheetProvider>
        <Harness />
      </ActionSheetProvider>,
    )

    const trigger = screen.getByRole('button', { name: '打开删除确认' })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
