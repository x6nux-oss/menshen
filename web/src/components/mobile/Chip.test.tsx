import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Chip, ChipStatic } from './Chip'

describe('Chip', () => {
  it('可点胶囊：点击触发 onClick，selected 写进 aria-pressed 与 data-selected', () => {
    const onClick = vi.fn()
    render(<Chip label="claude-sonnet-5" onClick={onClick} />)
    const chip = screen.getByRole('button', { name: 'claude-sonnet-5' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip).not.toHaveAttribute('data-selected')

    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('选中态：aria-pressed=true 且带 data-selected', () => {
    render(<Chip label="60" selected />)
    const chip = screen.getByRole('button', { name: '60' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveAttribute('data-selected', 'true')
  })

  it('多选组里每个胶囊各自独立 toggle（不是单选组）', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    render(
      <>
        <Chip label="a" selected onClick={onA} />
        <Chip label="b" selected onClick={onB} />
      </>,
    )
    // 两个都处于按下态 —— Segmented（单选）不可能同时成立
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ChipStatic', () => {
  it('只读胶囊不是按钮', () => {
    render(<ChipStatic label="gpt-5" />)
    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
