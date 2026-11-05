import type { ElementType, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface GlassProps {
  /** 渲染的元素类型；默认 div（玻璃是容器语义）。 */
  as?: ElementType
  /**
   * 启用 Layer 3 边缘折射（设计文档 §4.5）。**显式 opt-in**：
   * 只用在静态装饰元素（概览大卡、公开页顶部、空状态），
   * 列表与表格区域不要开 —— 滚动时每帧重算位移会掉帧。
   */
  refract?: boolean
  /** 立即显示镜面扫光（默认只在 hover 时显现）。用于入场动效。 */
  sheen?: boolean
  className?: string
  children?: ReactNode
  [key: `data-${string}`]: string | undefined
}

/**
 * 玻璃容器。三层渐进的第一步（设计文档 §4.2）：
 * 本组件给出 Layer 1（毛玻璃底 + 描边 + 内外高光）与 Layer 2（噪点/扫光，走 CSS 伪元素）。
 * Layer 3 由 `refract` 开关；支持它的浏览器才渲染出折射。
 */
export function Glass({ as, refract, sheen, className, children, ...rest }: GlassProps) {
  const Tag = (as ?? 'div') as ElementType
  return (
    <Tag
      className={cn('glass', refract && 'glass--refract', className)}
      data-sheen={sheen ? 'in' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** GlassCard：内容卡片形态（圆角 lg，内边距 4）。列表外的段落卡片用这个。 */
export function GlassCard({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-lg p-4', className)} {...rest} />
}

/** GlassPanel：大面板形态（圆角 xl）。侧栏、抽屉、概览大卡用这个。 */
export function GlassPanel({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-xl p-5', className)} {...rest} />
}

/** GlassSheet：底部弹层形态（只上圆角）。配合 ActionSheet 使用。 */
export function GlassSheet({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-t-2xl px-4 pt-3 pb-6', className)} {...rest} />
}

/** GlassToolbar：顶栏/工具栏形态（只下圆角，底部描边）。内容从下面滚过时用它。 */
export function GlassToolbar({ className, ...rest }: GlassProps) {
  return (
    <Glass
      className={cn('rounded-b-xl border-b border-glass-border px-4 py-2.5', className)}
      {...rest}
    />
  )
}
