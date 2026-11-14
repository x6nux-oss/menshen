import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export interface SeparatorProps extends Omit<ComponentProps<'div'>, 'role'> {
  orientation?: 'horizontal' | 'vertical'
}

/**
 * 分隔线。用 `role="separator"` + `aria-orientation` 让辅助技术识别
 * （水平分隔线在语义上等价于 <hr>，但这里要能放进 flex 布局里控制尺寸）。
 */
export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
