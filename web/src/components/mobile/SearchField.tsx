// 搜索框：圆角灰底、Search 图标、受控 value/onChange、可清空、可回车提交。
//
// props 与旧 src/ui/SearchField 对齐（含 autoFocus/disabled/clearable/onSubmit/
// ariaLabel —— 这些在旧实现的多个调用点用到，不能省）。
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
        // placeholder 只作视觉提示，读屏更依赖 aria-label（沿用旧实现的处理）。
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={cn(
          'h-10 w-full rounded-md bg-muted pr-9 pl-9 text-[15px] text-foreground outline-none',
          'placeholder:text-muted-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // 去掉 type=search 的原生清除按钮，用我们自己的（样式可控）
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {clearable && value !== '' && (
        <button
          type="button"
          aria-label="清空"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}
