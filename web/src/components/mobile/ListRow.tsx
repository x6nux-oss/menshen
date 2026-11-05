// 通用列表行：左主文案 16px + 可选灰色副行 13px（可等宽），
// 右侧徽标/值/自定义 trailing 与可选 › 箭头；有 onClick 时整行可点。
//
// props 与旧 src/ui/ListRow 完全对齐（Phase 2/3 迁移时调用点不用改）。
// 触控高度 ≥52px 是移动端可点性底线（iOS HIG 建议 44px，列表行取更宽松的 52）。
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface ListRowProps {
  primary: ReactNode
  secondary?: ReactNode
  /** 副行用等宽字体（chat_id、模型名这类标识）。 */
  secondaryMono?: boolean
  /** 右侧徽标（Badge 等）。 */
  badge?: ReactNode
  /** 右侧值文案。 */
  value?: ReactNode
  /** 右侧自定义内容（开关等），排在 value/badge 之后。 */
  trailing?: ReactNode
  chevron?: boolean
  onClick?: () => void
  disabled?: boolean
  className?: string
}

export function ListRow({
  primary,
  secondary,
  secondaryMono = false,
  badge,
  value,
  trailing,
  chevron = false,
  onClick,
  disabled = false,
  className,
}: ListRowProps) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[16px] leading-[1.4]">{primary}</span>
        {secondary !== undefined && (
          <span
            className={cn(
              'block text-[13px] leading-[1.4] break-all text-muted-foreground',
              secondaryMono && 'font-mono',
            )}
          >
            {secondary}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 pl-1">
        {badge}
        {value !== undefined && <span className="text-[14px] text-muted-foreground">{value}</span>}
        {trailing}
        {chevron && <ChevronRight className="size-5 text-muted-foreground/60" aria-hidden />}
      </span>
    </>
  )

  const rowClass = cn(
    'flex min-h-[52px] w-full items-center gap-2 px-4 py-1 text-foreground',
    className,
  )

  if (!onClick) {
    return <div className={rowClass}>{content}</div>
  }

  return (
    <button
      type="button"
      disabled={disabled}
      // 双保险：disabled 属性已拦截原生点击，但键盘路径（Enter/Space 触发 click）
      // 在某些浏览器仍需显式守卫 —— 旧实现踩过这个坑，沿用同样的做法。
      onClick={() => {
        if (!disabled) onClick()
      }}
      className={cn(
        rowClass,
        'transition-colors outline-none hover:bg-accent active:bg-accent',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {content}
    </button>
  )
}
