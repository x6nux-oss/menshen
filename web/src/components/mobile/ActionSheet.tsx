// ActionSheet 是底部操作面板：不可逆操作用底部弹层确认。
// confirm() 返回 Promise<boolean>：点确认 → true；点取消/遮罩/Esc → false。
// danger 时确认行用错误色，否则用主色；取消行始终灰色。
//
// **props 与旧 src/ui/ActionSheet 完全对齐**（含 `danger` 字段名 —— 计划文本
// 曾写 `destructive`，但旧实现与实际调用点（AppealDetailPage 等 6 处）用的是
// `danger`，以旧实现为准）。
//
// 弹层用 GlassSheet（浮起元素 ✓，设计文档 §4.4）。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { GlassSheet } from '../glass'

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
    resolver.current?.(false)
    restoreFocusTo.current = document.activeElement as HTMLElement | null
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

  // 打开时把焦点移到确认按钮；关闭后还给触发元素。
  useEffect(() => {
    if (!sheet.open) return
    confirmButtonRef.current?.focus()
    return () => {
      const target = restoreFocusTo.current
      restoreFocusTo.current = null
      target?.focus?.()
    }
  }, [sheet.open])

  // Esc 关闭（= 取消）。遮罩点击也走 settle(false)。
  useEffect(() => {
    if (!sheet.open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet.open, settle])

  const value = useMemo(() => confirm, [confirm])
  const shown = sheet.options

  if (!sheet.open) {
    return <ConfirmContext.Provider value={value}>{children}</ConfirmContext.Provider>
  }

  const titleId = 'action-sheet-title'

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {/* 遮罩：点击即取消 */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs"
        onClick={() => settle(false)}
        aria-hidden
      />
      {/* role/aria 挂在定位容器上：Glass 的 props 只允许 className 与 data-*，
          不含 ARIA 属性（玻璃层是纯视觉容器）。语义与视觉分两层，各自负责。 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-50"
      >
        <GlassSheet className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="px-1 pt-1 pb-0.5 text-center">
            <p id={titleId} className="text-[16px] font-semibold">
              {shown?.title}
            </p>
            {shown?.description !== undefined && (
              <p className="mt-1 text-[13px] leading-[1.6] text-muted-foreground">
                {shown.description}
              </p>
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
        </GlassSheet>
      </div>
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
