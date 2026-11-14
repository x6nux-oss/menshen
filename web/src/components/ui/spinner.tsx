import { cn } from '../../lib/utils'

export interface SpinnerProps {
  className?: string
  /** 直径（px）。默认 16。 */
  size?: number
}

/**
 * 载入指示器（MUI CircularProgress 的对应件）。
 *
 * 用 border 画环 + `animate-spin` 旋转：比 SVG 轻，且能跟着字色走。
 * `motion-reduce:animate-none` 是硬要求 —— 用户要求减少动效时停下，
 * 但**不能只留一个静止的空环**（那看起来像坏了），所以此时改用文字色
 * 的两个半透明档位让人看出这是「等待中」的形状。
 */
export function Spinner({ className, size = 16 }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none motion-reduce:border-t-current motion-reduce:opacity-60',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}
