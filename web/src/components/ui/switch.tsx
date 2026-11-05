import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

type BaseSwitchRootProps = ComponentProps<typeof BaseSwitch.Root>

export interface SwitchProps
  extends Omit<BaseSwitchRootProps, 'className' | 'onCheckedChange' | 'render'> {
  className?: string
  /**
   * 开关状态变化。**只回调布尔值** —— Base UI 原生签名是
   * `(checked, eventDetails)`，这里把第二个参数隐去，让调用方拿到稳定契约
   * （Phase 2/3 从旧组件迁移过来时不必改签名）。
   */
  onCheckedChange?: (checked: boolean) => void
}

/**
 * 开关。交互原语用 Base UI Switch（键盘、无障碍 role=switch 都归它管）。
 * 视觉是轨道 + 滑块两段；关闭态用 muted 底，开启态用 primary 底。
 *
 * 无可见文字标签时**必须**传 `aria-label`，否则屏幕阅读器读不出这个开关是干什么的。
 */
export function Switch({ className, onCheckedChange, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none',
        'bg-muted data-[checked]:bg-primary',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      onCheckedChange={
        onCheckedChange === undefined ? undefined : (checked) => onCheckedChange(checked)
      }
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-card shadow-sm transition-transform',
          'translate-x-0.5 data-[checked]:translate-x-[1.375rem]',
        )}
      />
    </BaseSwitch.Root>
  )
}
