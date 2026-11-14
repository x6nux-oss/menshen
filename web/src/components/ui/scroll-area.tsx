import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 滚动容器。用**原生 overflow** 而不是 Base UI ScrollArea —— 后者会自绘
 * 滚动条（需要额外的 Thumb/Scrollbar 元素与定位），而移动端浏览器本来就有
 * 动量滚动与原生滚动条，自绘反而更差。这里只负责「撑出一个可滚动的区域」
 * 并保证焦点可达（`tabIndex` 让键盘用户能用方向键滚动）。
 */
export function ScrollArea({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('overflow-auto overscroll-contain', className)} {...props}>
      {children}
    </div>
  )
}
