import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 模态对话框。原语用 Base UI Dialog（焦点陷阱、Esc 关闭、滚动锁定、
 * aria-modal 都归它管）。组合式 API。
 *
 * **无障碍硬要求**：每个 Dialog 必须有 `DialogTitle`（屏幕阅读器靠它报出
 * 这个弹层是什么）；有说明文字时再加 `DialogDescription`。缺标题时
 * 屏幕阅读器只会读出「对话框」，用户不知道自己在确认什么。
 */
export function Dialog(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />
}

export function DialogTrigger(props: ComponentProps<typeof BaseDialog.Trigger>) {
  return <BaseDialog.Trigger {...props} />
}

export function DialogClose(props: ComponentProps<typeof BaseDialog.Close>) {
  return <BaseDialog.Close {...props} />
}

export function DialogPortal(props: ComponentProps<typeof BaseDialog.Portal>) {
  return <BaseDialog.Portal {...props} />
}

/** 遮罩层：半透明 + 轻模糊，让下层内容退到背景里（并压住视觉噪声）。 */
export function DialogBackdrop({ className, ...props }: ComponentProps<typeof BaseDialog.Backdrop>) {
  return (
    <BaseDialog.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-xs',
        'transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * 对话框主体。**用玻璃底** —— 弹层是「浮起」的元素（设计文档 §4.4）。
 * 右上角自带关闭按钮（图标 + aria-label，供键盘与屏幕阅读器使用）。
 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <DialogBackdrop />
      <BaseDialog.Popup
        className={cn(
          'glass fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-5',
          'transition-[opacity,transform] data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
          'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
        <BaseDialog.Close
          aria-label="关闭"
          className={cn(
            'absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none',
            'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <X className="size-4" />
        </BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-3 flex flex-col gap-1 pr-6', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn('text-base font-semibold leading-6', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn('text-[13px] leading-5 text-muted-foreground', className)}
      {...props}
    />
  )
}
