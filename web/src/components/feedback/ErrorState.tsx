// 错误态：按 ApiError.status 分流文案。
//
// **文案表逐字照抄旧 src/ui/ErrorState.tsx 的 copyFor()** —— 两个前端面在迁移
// 期间并存，若这里另写一套，同一个 401 在两处会给出不同提示，用户会以为遇到了
// 不同的问题。改动文案时两处要一起改（Phase 2/3 迁完删掉旧的那份）。
//
// status 语义：0 = 网络层失败、401 = 身份失效、403 = 无权限、其余 = 网络异常兜底。
import { Ban, CloudOff, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui'

export interface ErrorStateProps {
  /** ApiError.status：0 表示网络层失败。 */
  status: number
  onRetry?: () => void
  className?: string
}

interface ErrorCopy {
  icon: ReactNode
  title: string
  description: string
}

function copyFor(status: number): ErrorCopy {
  if (status === 401) {
    return {
      icon: <Lock />,
      title: '请通过 Telegram 菜单按钮打开',
      description: '当前身份已失效。请在 Telegram 内通过 bot 菜单按钮重新打开本页。',
    }
  }
  if (status === 403) {
    return {
      icon: <Ban />,
      title: '没有权限',
      description: '当前账号无权访问该数据。请确认你已被设置为管理员，或改用有权限的账号。',
    }
  }
  return {
    icon: <CloudOff />,
    title: '网络异常',
    description: '请检查网络后重试；如果一直失败，可能是服务暂时不可用。',
  }
}

export function ErrorState({ status, onRetry, className }: ErrorStateProps) {
  const { icon, title, description } = copyFor(status)
  return (
    <div
      data-testid="error-state"
      className={cn('flex flex-col items-center px-3 py-6 text-center', className)}
    >
      <div className="mb-1 text-muted-foreground/50 [&_svg]:size-12">{icon}</div>
      <p className="text-[15px]">{title}</p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      {onRetry !== undefined && (
        <Button variant="outline" onClick={onRetry} className="mt-2 px-3">
          重试
        </Button>
      )}
    </div>
  )
}
