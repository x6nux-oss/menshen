import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 卡片族。**不透明卡片，不用玻璃** —— 玻璃只给「浮起」的元素
 * （顶栏/底栏/侧栏/弹层/统计卡，见设计文档 §4.4）；列表内部的段落卡片
 * 背后没有内容可透，做玻璃只会白耗合成开销。
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-[15px] font-semibold leading-6', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[13px] leading-5 text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...props} />
}
