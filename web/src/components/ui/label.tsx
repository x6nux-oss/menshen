import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 表单标签。用原生 <label htmlFor> —— 点击聚焦、屏幕阅读器关联都靠它，
 * 不要用 span + onClick 模拟。
 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-[13px] font-medium leading-5 text-foreground select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
