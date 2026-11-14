import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 单行文本输入框。样式由 token 驱动；`aria-invalid` 时描边与焦点环转
 * destructive —— 校验失败必须靠视觉 + 无障碍属性同时表达，只变色的话
 * 屏幕阅读器读不出。
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-none transition-colors outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}
