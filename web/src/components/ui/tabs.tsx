import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

type BaseTabsRootProps = ComponentProps<typeof BaseTabs.Root>

export interface TabsProps
  extends Omit<BaseTabsRootProps, 'onValueChange'> {
  /** 同其他组件：只回调选中的值，隐去 Base UI 的 eventDetails。 */
  onValueChange?: (value: string) => void
}

/** 标签页。组合式 API：`Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`。 */
export function Tabs({ onValueChange, ...props }: TabsProps) {
  return (
    <BaseTabs.Root
      onValueChange={
        onValueChange === undefined ? undefined : (value) => onValueChange(String(value ?? ''))
      }
      {...(props as BaseTabsRootProps)}
    />
  )
}

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn('inline-flex items-center gap-1 rounded-lg bg-muted p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground outline-none transition-colors select-none',
        'hover:text-foreground',
        'data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn('mt-3 outline-none', className)} {...props} />
}
