// 开关行：列表行的 Switch 形态，整行与开关都可点，但一次点击
// 只触发一次 onChange —— 开关自己的 click 阻止冒泡，避免行与开关各翻一次。
//
// **props 与旧 src/ui/SwitchRow 对齐**（注意是 `primary`/`secondary`，不是 `label`）：
// 计划文本曾写 `label`，但旧实现与 coordinator 确认的真实契约都是 primary。
// 以旧实现为准，Phase 2/3 迁移时调用点不用改。
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Switch } from '../ui'

export interface SwitchRowProps {
  primary: ReactNode
  secondary?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  badge?: ReactNode
  /** 开关的无障碍名；primary 不是纯文本时（如群名带链接）必须显式给。 */
  ariaLabel?: string
  className?: string
}

export function SwitchRow({
  primary,
  secondary,
  checked,
  onChange,
  disabled = false,
  badge,
  ariaLabel,
  className,
}: SwitchRowProps) {
  return (
    <div
      className={cn(
        'flex min-h-[52px] w-full items-center gap-2 px-4 py-1',
        !disabled && 'cursor-pointer transition-colors hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-[1.4]">{primary}</span>
        {secondary !== undefined && (
          <span className="block text-[13px] leading-[1.4] text-muted-foreground">
            {secondary}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 pl-1">
        {badge}
        {/* stopPropagation：否则开关点击会冒泡到外层 div，翻两次 */}
        <span onClick={(event) => event.stopPropagation()}>
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => {
              if (!disabled) onChange(next)
            }}
            aria-label={ariaLabel ?? (typeof primary === 'string' ? primary : '开关')}
          />
        </span>
      </span>
    </div>
  )
}
