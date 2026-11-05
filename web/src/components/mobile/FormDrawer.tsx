// 底部表单抽屉：标题 + children + 全宽提交按钮。
//
// props 与旧 `src/ui/FormDrawer` **完全一致**（7 个页面在用），只换底层：
// MUI Drawer → Base UI Dialog（Sheet 的 bottom 形态）。
//
// pending 由调用方从 mutation.isPending 传入：提交中禁用关闭（关闭按钮/遮罩/Esc）
// 与提交按钮；错误时不自动关闭 —— 失败由调用方 toast，抽屉保持打开、输入不丢。
//
// 不用 `SheetContent` 自带的关闭按钮（它不受 pending 控制），这里自己渲染一个。
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../ui/button'
import { Sheet, SheetClose, SheetContent } from '../ui/sheet'

export interface FormDrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** 点提交按钮触发；pending 时不会触发。 */
  onSubmit?: () => void
  submitText?: ReactNode
  /** 提交中：禁用一切关闭途径与提交按钮。 */
  pending?: boolean
  /** 额外的提交禁用条件（如内容未填），与 pending 独立。 */
  submitDisabled?: boolean
}

export function FormDrawer({
  open,
  onClose,
  title,
  children,
  onSubmit,
  submitText = '提交',
  pending = false,
  submitDisabled = false,
}: FormDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // pending 时连遮罩点击与 Esc 都不放行（旧实现的 disableEscapeKeyDown）。
        if (!next && !pending) onClose()
      }}
    >
      <SheetContent side="bottom" hideClose className="p-0 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center px-4 pt-4 pb-4">
          <h2 className="flex-1 text-[17px] leading-tight font-semibold">{title}</h2>
          <SheetClose
            render={
              <button
                type="button"
                aria-label="关闭"
                disabled={pending}
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="size-4" aria-hidden />
              </button>
            }
          />
        </div>
        <div className="px-4">{children}</div>
        {onSubmit !== undefined && (
          <div className="px-4 pb-4">
            <Button
              className="mt-4 h-11 w-full"
              disabled={pending || submitDisabled}
              onClick={onSubmit}
            >
              {submitText}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
