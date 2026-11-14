import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
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
  const labelId = useId()
  const content = (
    <>
      <span className="relative min-w-0 flex-1 text-left">
        <span id={labelId} className="block text-sm leading-[1.45] font-medium wrap-anywhere">{primary}</span>
        {secondary !== undefined && (
          <span
            id={`${labelId}-secondary`}
            className={cn(
              'mt-0.5 block text-xs leading-[1.45] break-all text-muted-foreground',
              secondaryMono && 'font-mono',
            )}
          >
            {secondary}
          </span>
        )}
      </span>
      <span id={`${labelId}-meta`} className="relative flex min-w-0 max-w-1/2 shrink-0 items-center gap-1.5 pl-2">
        {badge}
        {value !== undefined && (
          <span className="min-w-0 text-right text-xs leading-[1.4] text-muted-foreground wrap-anywhere">
            {value}
          </span>
        )}
        {trailing}
        {chevron && (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        )}
      </span>
    </>
  )

  const rowClass = cn(
    'flex min-h-13 w-full items-center gap-2 border-b border-border px-4 py-2.5 text-foreground last:border-b-0',
    className,
  )

  if (!onClick) {
    return <div className={rowClass}>{content}</div>
  }

  return (
    <div
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"]')
        ) return
        if (!disabled) onClick()
      }}
      className={cn(
        rowClass,
        'relative transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent active:bg-accent',
      )}
    >
      <button
        type="button"
        aria-labelledby={labelId}
        aria-describedby={`${secondary !== undefined ? `${labelId}-secondary ` : ''}${labelId}-meta`}
        disabled={disabled}
        onClick={onClick}
        className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      />
      {content}
    </div>
  )
}
