// 底部 Tab 栏：一级 Tab 的受控展示组件。
//
// **受控，不依赖 nav 模块**（与旧 src/ui/TabBar 的关键差异）：旧实现直接读
// `useNav()` 并内置五个固定 tab，只能服务旧外壳。新组件由调用方给
// `tabs` / `active` / `onChange`，因此可复用于任何外壳与任何 tab 集合。
//
// 玻璃底（Glass）：内容从下方滚过时用它（设计文档 §4.4）。
// 触控项高 ≥56px + 底部安全区（env(safe-area-inset-bottom)）—— 移动端底线。
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Glass } from '../glass'

export interface TabBarItem {
  /** tab 标识。Mini App 的五个一级 Tab 沿用旧值（overview/bots/chats/records/mine）。 */
  key: string
  label: ReactNode
  icon?: ReactNode
}

export interface TabBarProps {
  tabs: TabBarItem[]
  active: string
  onChange: (key: string) => void
  /** 无障碍名。 */
  ariaLabel?: string
  className?: string
}

export function TabBar({ tabs, active, onChange, ariaLabel, className }: TabBarProps) {
  return (
    <Glass
      as="nav"
      aria-label={ariaLabel ?? '主导航'}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 flex items-stretch rounded-none rounded-t-xl border-x-0 border-b-0',
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 outline-none',
              'transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
              selected ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon !== undefined && (
              <span className="[&_svg]:size-5" aria-hidden>
                {tab.icon}
              </span>
            )}
            <span className="text-[11px] leading-[1.2]">{tab.label}</span>
          </button>
        )
      })}
    </Glass>
  )
}
