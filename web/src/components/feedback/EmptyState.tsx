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
      className={cn('flex flex-col items-center px-5 py-10 text-center', className)}
    >
      <div aria-hidden className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-muted text-muted-foreground [&_svg]:size-6">
        {icon ?? <Inbox />}
      </div>
      <p className="text-[15px] font-medium">{title}</p>
      {description !== undefined && (
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  )
}
