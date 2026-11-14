// 空态：图标 + 一句文案 + 可选说明 + 可选主按钮。
// props 与旧 src/ui/EmptyState 一致（Phase 2/3 迁移时调用点只改 import 路径）。
// 保留 data-testid="empty-state"，旧测试依赖它（EmptyState.test.tsx 断言其中含 svg）。
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn('flex flex-col items-center px-3 py-6 text-center', className)}
    >
      {/* 图标默认用 lucide Inbox；[&_svg]:size-12 让调用方传任意图标都统一尺寸 */}
      <div className="mb-1 text-muted-foreground/50 [&_svg]:size-12">
        {icon ?? <Inbox />}
      </div>
      <p className="text-[15px]">{title}</p>
      {description !== undefined && (
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  )
}
