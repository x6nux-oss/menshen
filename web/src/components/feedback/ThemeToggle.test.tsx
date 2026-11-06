import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyThemeMode, storedTheme } from '../../lib/theme-mode'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('缺省是「跟随系统」，点一次切到亮色并持久化', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: '主题：跟随系统' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(storedTheme()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByRole('button', { name: '主题：亮色' })).toBeInTheDocument()
  })

  it('亮 → 暗 → 跟随系统，三态循环', () => {
    render(<ThemeToggle />)
    const btn = () => screen.getByRole('button')

    fireEvent.click(btn()) // system → light
    fireEvent.click(btn()) // light → dark
    expect(storedTheme()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button', { name: '主题：暗色' })).toBeInTheDocument()

    fireEvent.click(btn()) // dark → system
    // 跟随系统时 localStorage 里不留值 —— 这是「恢复跟随系统」的唯一判据。
    expect(storedTheme()).toBeNull()
    expect(screen.getByRole('button', { name: '主题：跟随系统' })).toBeInTheDocument()
  })

  it('已有显式选择时，初始状态反映它而不是 system', () => {
    localStorage.setItem('menshen-theme', 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: '主题：暗色' })).toBeInTheDocument()
  })

  it('applyThemeMode 与按钮状态一致', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    applyThemeMode('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
