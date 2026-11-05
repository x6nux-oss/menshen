import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export type SheetSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * 侧边/底部抽屉。复用 Base UI Dialog 的行为（焦点陷阱、Esc、滚动锁定），
 * 只换定位与进入方向 —— 它本质上就是「从某一边滑出的对话框」。
 *
 * 与 `@/components/mobile` 的 ActionSheet 的分工：Sheet 是通用抽屉，
 * 可放任意内容；ActionSheet 是「确认/选择」专用，API 是 Promise 式的。
 */

const SIDE_CLASS: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 rounded-b-xl border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full',
  bottom:
    'inset-x-0 bottom-0 rounded-t-xl border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full',
  left: 'inset-y-0 left-0 h-full w-80 max-w-[85vw] rounded-r-xl border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full',
  right:
    'inset-y-0 right-0 h-full w-80 max-w-[85vw] rounded-l-xl border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full',
}

export function Sheet(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />
}

export function SheetTrigger(props: ComponentProps<typeof BaseDialog.Trigger>) {
  return <BaseDialog.Trigger {...props} />
}

export function SheetClose(props: ComponentProps<typeof BaseDialog.Close>) {
  return <BaseDialog.Close {...props} />
}

export function SheetBackdrop({ className, ...props }: ComponentProps<typeof BaseDialog.Backdrop>) {
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

export interface SheetContentProps extends ComponentProps<typeof BaseDialog.Popup> {
  side?: SheetSide
}

/**
 * 抽屉主体。**用玻璃底**（浮起元素，§4.4）。
 * 垂直方向的两侧（left/right）内容通常较多，所以自带纵向滚动。
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: SheetContentProps) {
  return (
    <BaseDialog.Portal>
      <SheetBackdrop />
      <BaseDialog.Popup
        className={cn(
          'glass fixed z-50 border-glass-border p-5 transition-transform',
          side === 'left' || side === 'right' ? 'overflow-y-auto' : 'overflow-y-auto max-h-[85dvh]',
          SIDE_CLASS[side],
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

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-3 flex flex-col gap-1 pr-6', className)} {...props} />
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex flex-col gap-2', className)} {...props} />
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title className={cn('text-base font-semibold leading-6', className)} {...props} />
  )
}

export function SheetDescription({
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
