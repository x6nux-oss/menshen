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
    if (typeof location !== 'undefined' && location.pathname.startsWith('/admin')) {
      return {
        icon: <Lock />,
        title: '登录已过期',
        description: '请回到 Telegram 与机器人的私聊，重新获取网页版登录链接，再回来重试。',
      }
    }
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
      role="alert"
      className={cn('flex flex-col items-center rounded-lg border border-border bg-card px-5 py-10 text-center', className)}
    >
      <div aria-hidden className="mb-4 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-6">{icon}</div>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      {onRetry !== undefined && (
        <Button variant="outline" onClick={onRetry} className="mt-4 px-4">
          重试
        </Button>
      )}
    </div>
  )
}
