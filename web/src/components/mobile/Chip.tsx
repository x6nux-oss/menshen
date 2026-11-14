import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface ChipProps extends Omit<ComponentProps<'button'>, 'className' | 'children'> {
  label: ReactNode
  /** 选中态（仅可点胶囊有意义）。 */
  selected?: boolean
  className?: string
}

export function Chip({ label, selected = false, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-md border px-2.5 py-1 text-[13px] leading-[1.4] whitespace-normal wrap-anywhere',
        'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary bg-primary font-medium text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {label}
    </button>
  )
}

/** 只读胶囊：纯展示，不可点。 */
export function ChipStatic({ label, className }: { label: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] leading-[1.4] whitespace-normal wrap-anywhere text-muted-foreground',
        className,
      )}
    >
      {label}
    </span>
  )
}
