import { Search, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { cn } from '../../lib/utils'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 输入框的无障碍名称；缺省用 placeholder。 */
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  /** 有内容时显示清空按钮，默认显示。 */
  clearable?: boolean
  /** 按回车时立即触发（服务端搜索用；本地过滤不需要）。 */
  onSubmit?: () => void
  className?: string
}

export function SearchField({
  value,
  onChange,
  placeholder = '搜索',
  ariaLabel,
  autoFocus = false,
  disabled = false,
  clearable = true,
  onSubmit,
  className,
}: SearchFieldProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') onSubmit?.()
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(
          'h-11 w-full rounded-md border border-input bg-card pr-10 pl-9 text-sm text-foreground outline-none',
          'placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {clearable && value !== '' && (
        <button
          type="button"
          aria-label="清空"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}
