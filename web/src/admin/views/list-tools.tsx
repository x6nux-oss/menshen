// 列表页共用的小工具：快捷筛选胶囊与筛选字段外壳。
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface FilterOption<T extends string = string> {
  value: T
  label: ReactNode
  count?: number
}

/** FilterChips 是列表的快捷筛选；选中项用主色实底，其余保持白面。 */
export function FilterChips<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: FilterOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-wrap gap-1', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/40',
              active
                ? 'border-primary bg-primary font-medium text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="text-[11px] tabular-nums">
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** FilterField 给工具栏里的下拉/输入加一致的窄标签。 */
export function FilterField({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-[150px] flex-col gap-1', className)}>
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

