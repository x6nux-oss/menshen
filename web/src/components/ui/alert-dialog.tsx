import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 危险操作确认框。与 Dialog 的区别在语义：AlertDialog **不能点遮罩关闭、
 * 不能 Esc 关闭** —— 必须明确选择「确认」或「取消」。这是给它不可逆操作
 * （删除、封禁、撤销）用的，避免误触背景就顺手关掉而漏掉确认。
 *
 * **无障碍硬要求**：必须有 `AlertDialogTitle`。
 */
export function AlertDialog(props: ComponentProps<typeof BaseAlertDialog.Root>) {
  return <BaseAlertDialog.Root {...props} />
}

export function AlertDialogTrigger(props: ComponentProps<typeof BaseAlertDialog.Trigger>) {
  return <BaseAlertDialog.Trigger {...props} />
}

export function AlertDialogBackdrop({
  className,
  ...props
}: ComponentProps<typeof BaseAlertDialog.Backdrop>) {
  return (
    <BaseAlertDialog.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-xs',
        'transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

/** 确认框主体。**用玻璃底**（浮起元素，§4.4）。 */
export function AlertDialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <AlertDialogBackdrop />
      <BaseAlertDialog.Popup
        className={cn(
          'glass fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5',
          'transition-[opacity,transform] data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
          'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-3 flex flex-col gap-1', className)} {...props} />
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof BaseAlertDialog.Title>) {
  return (
    <BaseAlertDialog.Title
      className={cn('text-base font-semibold leading-6', className)}
      {...props}
    />
  )
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof BaseAlertDialog.Description>) {
  return (
    <BaseAlertDialog.Description
      className={cn('text-[13px] leading-5 text-muted-foreground', className)}
      {...props}
    />
  )
}

export function AlertDialogAction(props: ComponentProps<typeof BaseAlertDialog.Close>) {
  return <BaseAlertDialog.Close {...props} />
}

export function AlertDialogCancel(props: ComponentProps<typeof BaseAlertDialog.Close>) {
  return <BaseAlertDialog.Close {...props} />
}
