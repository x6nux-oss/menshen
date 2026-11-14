// 分组卡片：13px 灰色组标题（左缩进）+ 圆角卡片，无边框无阴影。
// footer 区域自带顶部分割线，用于 `＋ 添加` 这类整行操作。
//
// props 与旧 src/ui/SectionCard 对齐。底色用 --card 而非玻璃：段落卡片背后
// 没有内容可透（设计文档 §4.4 —— 玻璃只给浮起元素）。
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface SectionCardProps {
  /** 组标题；不传则只渲染卡片本体。 */
  title?: ReactNode
  children: ReactNode
  /** 卡片底部区域（如 `添加参数覆盖`）。 */
  footer?: ReactNode
  className?: string
}

export function SectionCard({ title, children, footer, className }: SectionCardProps) {
  return (
    <div className="mb-1.5">
      {title !== undefined && (
        <h2 className="mb-0.75 pl-1 text-[13px] font-medium text-muted-foreground">{title}</h2>
      )}
      <div className={cn('overflow-hidden rounded-lg bg-card', className)}>
        {children}
        {footer !== undefined && <div className="border-t border-border">{footer}</div>}
      </div>
    </div>
  )
}
