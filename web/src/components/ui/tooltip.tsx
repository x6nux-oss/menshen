import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'
import { cn } from '../../lib/utils'

/**
 * 提示气泡。**Base UI 没有 tooltip 原语**（其子路径清单里没有），所以这里用
 * 原生实现：CSS 负责显隐（hover / focus-visible），JS 只做 ARIA 关联。
 *
 * 设计取舍：不做运行时定位（跟随光标 / 自动翻转方向）—— 这需要 Floating UI
 * 那样的定位库，而本项目里的 tooltip 只用于给图标按钮补文字说明，靠 CSS
 * 居中定位足够。真需要跟随定位的场合应该用 Popover 或 DropdownMenu。
 *
 * 无障碍：气泡是 `role="tooltip"`，触发元素用 `aria-describedby` 关联；
 * 键盘 Tab 到触发元素时也要显示（`group-focus-visible`），只做 hover 的话
 * 键盘用户看不到提示。
 *
 * 用法：`<Tooltip label="删除"><Button …/></Tooltip>`
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  // 无需全局状态（每个 Tooltip 自己管自己的显隐），保留这个组件是为了
  // 与 shadcn 的调用习惯一致，后续若要加统一延迟/禁用配置有落点。
  return <>{children}</>
}

export interface TooltipProps {
  /** 提示文字。必填 —— 空的 tooltip 只是给屏幕阅读器添噪声。 */
  label: ReactNode
  /** 触发元素（通常是图标按钮）。 */
  children: ReactNode
  className?: string
}

export function Tooltip({ label, children, className }: TooltipProps) {
  const id = useId()
  return (
    <span className={cn('group relative inline-flex', className)}>
      {/* 触发元素包一层以便挂 aria-describedby；用 cloneElement 会丢 ref 语义，故包 span */}
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={cn(
          'glass pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2',
          'rounded-md px-2 py-1 text-[12px] whitespace-nowrap text-foreground opacity-0 transition-opacity',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          // reduced-motion：不要过渡（无障碍基线）
          'motion-reduce:transition-none',
        )}
      >
        {label}
      </span>
    </span>
  )
}

/** 触发元素别名 —— 与 shadcn 的 `TooltipTrigger` 命名对齐，实际就是 children 本身。 */
export function TooltipTrigger({ children }: ComponentProps<'span'>) {
  return <>{children}</>
}
