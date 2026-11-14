// 顶部导航栏：居中标题 17px/600，可选副标题 13px 灰；左侧返回、右侧动作。
//
// **受控组件，不依赖 nav 模块**（与旧 src/ui/TopBar 的关键差异）：旧实现直接
// import `../nav` 读导航栈，只能服务 Mini App 的旧外壳。新组件只接收
// `onBack` —— 是否显示返回、点它做什么，都由调用方决定，因此 Phase 2 的新外壳
// 与别处都能用。
//
// 玻璃底（GlassToolbar）：内容从下方滚过时用它（设计文档 §4.4）。
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { GlassToolbar } from '../glass'

export interface TopBarProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 右侧动作（图标按钮等）。 */
  actions?: ReactNode
  /** 传了即显示返回按钮并回调。 */
  onBack?: () => void
  className?: string
}

/** 返回与动作槽的宽度：标题绝对居中时用它留安全边，避免被两侧挤压。 */
const SLOT_WIDTH = 40

export function TopBar({ title, subtitle, actions, onBack, className }: TopBarProps) {
  return (
    <GlassToolbar
      className={cn('relative flex min-h-[44px] items-center rounded-b-none px-1 py-0.5', className)}
    >
      {onBack !== undefined && (
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className={cn(
            'grid shrink-0 place-items-center rounded-full text-foreground outline-none',
            'transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
          style={{ width: SLOT_WIDTH, height: SLOT_WIDTH }}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      )}
      {/* 标题绝对居中：右侧动作数量/宽度变化不影响中线。 */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-14">
        <span className="max-w-full truncate text-[17px] leading-[1.3] font-semibold">{title}</span>
        {subtitle !== undefined && (
          <span className="max-w-full truncate text-[13px] leading-[1.3] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </div>
      <div
        data-testid="topbar-actions"
        className="relative z-1 ml-auto flex shrink-0 items-center justify-end gap-0.5"
        style={{ minWidth: SLOT_WIDTH }}
      >
        {actions}
      </div>
    </GlassToolbar>
  )
}
