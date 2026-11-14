// ActionSheet 是底部操作面板：不可逆操作用底部弹层确认。
// confirm() 返回 Promise<boolean>：点确认 → true；点取消/遮罩/Esc → false。
// danger 时确认行用错误色，否则用主色；取消行始终灰色。
//
// **props 与旧 src/ui/ActionSheet 完全对齐**（含 `danger` 字段名 —— 计划文本
// 曾写 `destructive`，但旧实现与实际调用点（AppealDetailPage 等 6 处）用的是
// `danger`，以旧实现为准）。
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui'

export interface ConfirmOptions {
  /** 动作标题，如 `移除该群？`。 */
  title: ReactNode
  /** 对象与后果说明。 */
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  /** 不可逆操作用红色确认行。 */
  danger?: boolean
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export interface ActionSheetProviderProps {
  children: ReactNode
}

/** open 与 options 一起存 state：关闭后 options 保留到退场结束再清，避免文案闪空。 */
interface SheetState {
  open: boolean
  options: ConfirmOptions | null
}

export function ActionSheetProvider({ children }: ActionSheetProviderProps) {
  const [sheet, setSheet] = useState<SheetState>({ open: false, options: null })
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  // 打开前的焦点元素：关闭后还给它（焦点管理是无障碍硬要求）。
  const restoreFocusTo = useRef<HTMLElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    // 极端情况（连点）下上一个确认还没结算：按取消处理，避免 Promise 悬空。
    const hasPending = resolver.current !== null
    resolver.current?.(false)
    if (!hasPending) {
      restoreFocusTo.current = document.activeElement as HTMLElement | null
    }
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setSheet({ open: true, options })
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setSheet((prev) => ({ open: false, options: prev.options }))
    resolve?.(ok)
  }, [])

  const value = useMemo(() => confirm, [confirm])
  const shown = sheet.options

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Sheet
        open={sheet.open}
        onOpenChange={(next) => {
          if (!next) settle(false)
        }}
      >
        <SheetContent
          side="bottom"
          hideClose
          aria-modal="true"
          initialFocus={() => confirmButtonRef.current}
          finalFocus={restoreFocusTo}
          className="rounded-t-2xl p-0"
        >
          <div className="px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="px-1 pt-1 pb-0.5 text-center">
              <SheetTitle className="text-center text-[16px] font-semibold">
                {shown?.title}
              </SheetTitle>
              {shown?.description !== undefined && (
                <SheetDescription className="mt-1 text-center text-[13px] leading-[1.6] text-muted-foreground">
                  {shown.description}
                </SheetDescription>
              )}
            </div>
            <div className="px-1 pt-1.5">
              <button
                ref={confirmButtonRef}
                type="button"
                onClick={() => settle(true)}
                className={cn(
                  'h-11 w-full rounded-md text-[16px] font-semibold transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring/50',
                  shown?.danger
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {shown?.confirmText ?? '确定'}
              </button>
              <button
                type="button"
                onClick={() => settle(false)}
                className="mt-1.5 h-11 w-full rounded-md text-[16px] text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {shown?.cancelText ?? '取消'}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </ConfirmContext.Provider>
  )
}

/** useConfirm 拿到命令式 confirm()；必须在 ActionSheetProvider 内使用。 */
// oxlint-disable-next-line react/only-export-components -- Provider 与 hook 必须共享同一个 context，拆分反而绕。
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm 必须在 ActionSheetProvider 内使用')
  return ctx
}
