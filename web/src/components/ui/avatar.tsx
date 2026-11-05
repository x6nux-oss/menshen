import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 头像。原语用 Base UI Avatar（负责图片加载失败时切到 fallback）。
 * 用法：`<Avatar><AvatarImage src="…" alt="…" /><AvatarFallback>AB</AvatarFallback></Avatar>`。
 * 无图时（本项目多数情况只显示 uid/昵称首字）直接给 Fallback 即可。
 */
export function Avatar({ className, ...props }: ComponentProps<typeof BaseAvatar.Root>) {
  return (
    <BaseAvatar.Root
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
        className,
      )}
      {...props}
    />
  )
}

export function AvatarImage({ className, ...props }: ComponentProps<typeof BaseAvatar.Image>) {
  return <BaseAvatar.Image className={cn('size-full object-cover', className)} {...props} />
}

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof BaseAvatar.Fallback>) {
  return (
    <BaseAvatar.Fallback
      className={cn(
        'flex size-full items-center justify-center text-[12px] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
