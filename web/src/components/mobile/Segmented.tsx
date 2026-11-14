import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface SegmentedOption {
  value: string
  label: ReactNode
}

export interface SegmentedProps {
  value: string
  onChange: (value: string) => void
  options: SegmentedOption[]
  ariaLabel?: string
  className?: string
}

/** 单选分段：浅灰槽 + 实底选中项，适合表单分段与筛选。 */
export function Segmented({ value, onChange, options, ariaLabel, className }: SegmentedProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex flex-wrap gap-1 rounded-lg border border-border bg-muted/60 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (!selected) onChange(option.value)
            }}
            className={cn(
              'min-h-9 flex-1 rounded-md px-2.5 py-1.5 text-[13px] leading-[1.4] outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring/50',
              selected
                ? 'bg-card font-semibold text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
