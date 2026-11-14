import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface TabBarItem {
  key: string
  label: ReactNode
  icon?: ReactNode
}

export interface TabBarProps {
  tabs: TabBarItem[]
  active: string
  onChange: (key: string) => void
  ariaLabel?: string
  className?: string
}

/**
 * 一级导航。固定在安全区上方，实底卡片；不再做玻璃透镜拖拽。
 * 方向键仍可切换，保证键盘用户不因视觉简化丢失导航能力。
 */
export function TabBar({ tabs, active, onChange, ariaLabel, className }: TabBarProps) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const index = tabs.findIndex((tab) => tab.key === active)
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1
    if (next < 0 || !tabs[next]) return
    event.preventDefault()
    onChange(tabs[next].key)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  return (
    <nav
      aria-label={ariaLabel ?? '主导航'}
      onKeyDown={onKeyDown}
      className={cn(
        'mini-navigation fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card',
        'pb-[env(safe-area-inset-bottom)]',
        'lg:overflow-y-auto lg:border-t-0 lg:border-r lg:border-sidebar-border lg:bg-sidebar lg:text-sidebar-foreground',
        className,
      )}
    >
      <p className="hidden px-5 pt-7 pb-5 text-xs font-medium tracking-wider text-sidebar-muted lg:block">工作空间</p>
      <div className="mx-auto flex h-17 max-w-lg items-stretch lg:h-auto lg:flex-col lg:gap-2 lg:px-3">
        {tabs.map((tab) => {
          const selected = tab.key === active
          return (
            <button
              key={tab.key}
              type="button"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onChange(tab.key)}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] outline-none',
                'transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                'lg:min-h-12 lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:text-sm lg:focus-visible:ring-sidebar-foreground',
                selected
                  ? 'font-semibold text-primary lg:bg-sidebar-accent lg:text-sidebar-foreground'
                  : 'text-muted-foreground hover:text-foreground lg:text-sidebar-muted lg:hover:bg-sidebar-accent lg:hover:text-sidebar-foreground',
              )}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute top-0 h-0.5 w-7 rounded-full bg-primary lg:hidden"
                />
              )}
              {tab.icon !== undefined && (
                <span className="[&_svg]:size-5" aria-hidden>
                  {tab.icon}
                </span>
              )}
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
