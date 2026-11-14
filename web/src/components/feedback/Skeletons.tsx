// 列表骨架：首屏加载时的占位行，行数可调。
//
// props 与旧 src/ui/Skeletons 一致（**默认 rows = 3**），并保留
// data-testid="skeletons" 与每行的 data-testid="skeleton-row" —— 旧测试按这两个
// testid 断言行数，Phase 2/3 迁移时不该改测试。
import { Skeleton } from '../ui'

export interface SkeletonsProps {
  /** 占位行数，默认 3。 */
  rows?: number
  className?: string
}

export function Skeletons({ rows = 3, className }: SkeletonsProps) {
  return (
    <div data-testid="skeletons" className={className}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          data-testid="skeleton-row"
          className="flex items-center gap-1.5 py-1.5"
        >
          {/* 圆形头像占位 + 两行文字占位，与旧实现的视觉结构一致 */}
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-[55%]" />
            <Skeleton className="h-4 w-[30%]" />
          </div>
        </div>
      ))}
    </div>
  )
}
