import { ChevronLeft, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface TopBarProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧动作（图标按钮等）。 */
  actions?: ReactNode
  /** 传了即显示返回按钮并回调。 */
  onBack?: () => void
  /** 一级页显示品牌与产品名，详情页只显示返回与标题。 */
  brand?: boolean
  className?: string
}

export function TopBar({ title, subtitle, actions, onBack, brand = false, className }: TopBarProps) {
  return (
    <header
      className={cn(
        'mini-topbar relative z-20 flex min-h-16 items-center gap-2 border-b border-border bg-card px-4 py-2',
        className,
      )}
    >
      {onBack !== undefined ? (
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="grid size-11 shrink-0 place-items-center rounded-md text-foreground outline-none transition-colors hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      ) : brand ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {brand && (
          <span className="mb-0.5 block text-[11px] font-semibold tracking-[0.16em] text-primary">
            门神
          </span>
        )}
        <h1
          className={cn(
            'truncate font-semibold tracking-tight',
            onBack ? 'text-[22px] leading-[1.25]' : 'text-[26px] leading-[1.2]',
          )}
        >
          {title}
        </h1>
        {subtitle !== undefined && (
          <span className="mt-0.5 block truncate text-xs leading-[1.4] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>
      <div
        data-testid="topbar-actions"
        className="relative z-1 ml-auto flex shrink-0 items-center justify-end gap-1"
      >
        {actions}
      </div>
    </header>
  )
}
