import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { Children, isValidElement } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type BaseSelectRootProps = ComponentProps<typeof BaseSelect.Root>
type SelectItems = BaseSelectRootProps['items']

interface DerivedSelectItem {
  label: ReactNode
  value: unknown
}

export interface SelectProps
  extends Omit<BaseSelectRootProps, 'onValueChange' | 'children'> {
  children?: ComponentProps<typeof BaseSelect.Root>['children']
  /** 同 Switch：只回调选中的值，隐去 Base UI 的 eventDetails。 */
  onValueChange?: (value: string) => void
}

/**
 * 下拉选择。原语用 Base UI Select（键盘导航、typeahead、无障碍 role 都归它管）。
 * 组合式 API：`Select` + `SelectTrigger` + `SelectValue` + `SelectContent` + `SelectItem`。
 * 无可见标签时给 `SelectTrigger` 传 `aria-label`。
 */
export function Select({ onValueChange, children, items, ...props }: SelectProps) {
  const derivedItems = items === undefined ? selectItemsFrom(children) : []

  return (
    <BaseSelect.Root
      onValueChange={
        onValueChange === undefined
          ? undefined
          : (value) => onValueChange(String(value ?? ''))
      }
      items={items ?? (derivedItems.length > 0 ? (derivedItems as SelectItems) : undefined)}
      {...(props as ComponentProps<typeof BaseSelect.Root>)}
    >
      {children}
    </BaseSelect.Root>
  )
}

function selectItemsFrom(children: SelectProps['children']): DerivedSelectItem[] {
  if (typeof children === 'function') return []
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return []
    const childProps = child.props as { value?: unknown; children?: ReactNode }
    if (child.type === SelectItem) {
      return childProps.value === undefined || childProps.value === null
        ? []
        : [{ label: childProps.children, value: childProps.value }]
    }
    return selectItemsFrom(childProps.children)
  })
}

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        'inline-flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-card px-3 text-sm outline-none',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="shrink-0 text-muted-foreground">
        <ChevronDown className="size-4" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

export function SelectValue({ className, ...props }: ComponentProps<typeof BaseSelect.Value>) {
  return (
    <BaseSelect.Value
      className={cn('truncate data-[placeholder]:text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * 下拉面板。**用玻璃底** —— 它是「浮起」的元素（设计文档 §4.4），
 * 底下压着页面内容，毛玻璃让它与背景产生层次。
 */
export function SelectContent({ className, children, ...props }: ComponentProps<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} className="z-50">
        <BaseSelect.Popup
          className={cn(
            'glass max-h-[min(18rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg p-1',
            className,
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        'relative flex cursor-pointer items-center rounded-md py-1.5 pl-2 pr-7 text-sm outline-none select-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-3.5" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}

export function SelectGroup({ className, ...props }: ComponentProps<typeof BaseSelect.Group>) {
  return <BaseSelect.Group className={cn('p-1', className)} {...props} />
}
