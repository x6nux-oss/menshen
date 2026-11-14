import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface SectionCardProps {
  /** 组标题；不传则只渲染卡片本体。 */
  title?: ReactNode
  /** 标题右侧补充信息，如计数或状态。 */
  meta?: ReactNode
  children: ReactNode
  /** 卡片底部区域（如 `添加` 这类整行操作）。 */
  footer?: ReactNode
  className?: string
}

/**
 * 不透明分组面板：白/浅灰卡片、细边界、无阴影。
 * 标题独立于卡片，便于长页面快速扫读层级。
 */
export function SectionCard({ title, meta, children, footer, className }: SectionCardProps) {
  return (
    <section className="mb-3">
      {title !== undefined && (
        <div className="mb-1.5 flex min-h-5 items-baseline gap-2 px-0.5">
          <h2 className="min-w-0 flex-1 text-sm leading-[1.4] font-semibold text-foreground">
            {title}
          </h2>
          {meta !== undefined && (
            <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
          )}
        </div>
      )}
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-card text-card-foreground',
          className,
        )}
      >
        {children}
        {footer !== undefined && <div className="border-t border-border">{footer}</div>}
      </div>
    </section>
  )
}
