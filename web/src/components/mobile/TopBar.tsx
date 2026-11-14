import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface TopBarProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧动作（图标按钮等）。 */
  actions?: ReactNode
  /** 传了即显示返回按钮并回调。 */
  onBack?: () => void
  className?: string
}

const SLOT_WIDTH = 44

export function TopBar({ title, subtitle, actions, onBack, className }: TopBarProps) {
  return (
    <header
      className={cn('mini-topbar relative flex min-h-16 items-center gap-2 px-4 py-2', className)}
    >
      {onBack !== undefined && (
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className={cn(
            'grid shrink-0 place-items-center rounded-full bg-muted/75 text-foreground outline-none',
            'transition-[background-color,transform] hover:bg-accent active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
          style={{ width: SLOT_WIDTH, height: SLOT_WIDTH }}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      <div className={cn('min-w-0 flex-1', onBack && 'text-center')}>
        <span className={cn('block truncate leading-[1.3] font-semibold tracking-tight', onBack ? 'text-[17px]' : 'text-[22px]')}>{title}</span>
        {subtitle !== undefined && (
          <span className="mt-0.5 block truncate text-[12px] leading-[1.4] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>
      <div
        data-testid="topbar-actions"
        className="relative z-1 ml-auto flex shrink-0 items-center justify-end gap-0.5"
        style={{ minWidth: SLOT_WIDTH }}
      >
        {actions}
      </div>
    </header>
  )
}
