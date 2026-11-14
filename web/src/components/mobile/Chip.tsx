// 可点胶囊：多选/单选的选择器，也用于只读标签。
//
// 为什么需要它（而不是都用 Segmented）：`Segmented` 是**单选分段控件**
// （`role="group"` + 一次只有一个 `aria-pressed`），而 SettingsPage 的模型
// 多选、分钟预设、验证提供方是「一组可点胶囊，其中若干被选中」。用 Segmented
// 表达多选会告诉屏幕阅读器「这是单选框」，语义错位。
//
// 视觉与 `Segmented` 的未选中/选中态保持一致（rounded-full + 13px），
// 这样同一个 App 里的胶囊长相统一。
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface ChipProps extends Omit<ComponentProps<'button'>, 'className' | 'children'> {
  label: ReactNode
  /** 选中态（仅可点胶囊有意义）。 */
  selected?: boolean
  className?: string
}

/**
 * 可点胶囊。`aria-pressed` 表达选中态 —— 对多选组，每个胶囊都是独立的
 * toggle button，这是 WAI-ARIA 认可的多选表达方式。
 */
export function Chip({ label, selected = false, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[13px] leading-[1.4] whitespace-nowrap',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'bg-primary font-medium text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    >
      {label}
    </button>
  )
}

/** 只读胶囊：纯展示（BotDetailPage 的模型名列表这类），不可点。 */
export function ChipStatic({ label, className }: { label: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-muted px-3 py-1 text-[13px] leading-[1.4] whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  )
}
