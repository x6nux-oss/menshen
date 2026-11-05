import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 骨架占位。`motion-reduce:animate-none` 是硬要求：前庭功能敏感的用户
 * 开了「减少动效」后，持续脉动会让人不适（无障碍基线）。
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  )
}
