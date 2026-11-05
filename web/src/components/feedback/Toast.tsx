// 全局轻提示。底层用 sonner，但对外**保持旧 src/ui/Toast 的签名**：`useToast()`
// 直接返回一个 `show(message)` 函数（10+ 个页面调用点写成 `const toast = useToast()`
// 然后 `toast('已保存')`），所以这里不改成 `{ show }` 对象 —— 那样每个调用点都要改。
//
// sonner 自带样式表（17.6KB），必须显式 import：不引入的话 toast 渲染出来没有
// 任何样式，而构建成功、无告警（与 token.css 未进产物是同一类静默失效）。
import 'sonner/dist/styles.css'
import { createContext, useCallback, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Toaster, toast as sonnerToast } from 'sonner'

/** show(message) —— 与旧实现一致，直接可调用。 */
type ShowToast = (message: string) => void

const ToastContext = createContext<ShowToast | null>(null)

export interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  // 每次 show 先关掉上一条：旧实现是「单例替换」语义（连续 show 只显示最新一条），
  // sonner 默认会堆叠，这里保持行为一致。
  const show = useCallback<ShowToast>((message) => {
    sonnerToast.dismiss()
    sonnerToast(message)
  }, [])

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        position="bottom-center"
        // 移动端在底部 TabBar 之上，避免被遮住。
        offset={{ bottom: '18%' }}
        duration={2200}
      />
    </ToastContext.Provider>
  )
}

/**
 * useToast 返回全局 show(message)；必须在 ToastProvider 内使用。
 * 签名与旧 src/ui/Toast 完全一致（直接返回函数，不是 { show } 对象）。
 */
// oxlint-disable-next-line react/only-export-components -- Provider 与 hook 共享同一 context，故同文件导出。
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
