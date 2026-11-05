// 分段控件：横向胶囊 chips，受控；用于记录[判定|申诉]、名单分段。
//
// props 与旧 src/ui/Segmented 对齐。用 role="group" + aria-pressed 表达选中态：
// 旧实现用 MUI ToggleButtonGroup（内部也是这个语义），保持一致以便迁移。
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

export function Segmented({ value, onChange, options, ariaLabel, className }: SegmentedProps) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex gap-1.5', className)}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              // 再点当前项时保持原值，避免出现没有分段的空态（旧实现同此处理）。
              if (!selected) onChange(option.value)
            }}
            className={cn(
              'rounded-full px-3 py-1 text-[13px] leading-[1.4] transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/50',
              selected
                ? 'bg-primary font-medium text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
