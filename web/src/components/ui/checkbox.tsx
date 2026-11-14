import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

type BaseCheckboxRootProps = ComponentProps<typeof BaseCheckbox.Root>

export interface CheckboxProps
  extends Omit<BaseCheckboxRootProps, 'className' | 'onCheckedChange' | 'render'> {
  className?: string
  /** 同 Switch：只回调布尔值，隐去 Base UI 的 eventDetails 第二参数。 */
  onCheckedChange?: (checked: boolean) => void
}

/**
 * 复选框。勾选态用 primary 底 + 对勾图标；`aria-invalid` 转 destructive。
 * 无可见标签时**必须**传 `aria-label`。
 */
export function Checkbox({ className, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={cn(
        'inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-input bg-card transition-colors outline-none',
        'data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      onCheckedChange={
        onCheckedChange === undefined ? undefined : (checked) => onCheckedChange(checked)
      }
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center">
        <Check className="size-3.5" strokeWidth={3} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}
