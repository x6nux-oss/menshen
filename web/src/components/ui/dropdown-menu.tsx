import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 下拉菜单。原语用 Base UI Menu（键盘导航、Esc、焦点归还都归它管）。
 * 组合式 API：`DropdownMenu` + `DropdownMenuTrigger` + `DropdownMenuContent` + `DropdownMenuItem`。
 */
export function DropdownMenu(props: ComponentProps<typeof BaseMenu.Root>) {
  return <BaseMenu.Root {...props} />
}

export function DropdownMenuTrigger(props: ComponentProps<typeof BaseMenu.Trigger>) {
  return <BaseMenu.Trigger {...props} />
}

/** 菜单面板。**用玻璃底**（浮起元素，§4.4）。 */
export function DropdownMenuContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseMenu.Popup>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={4} className="z-50">
        <BaseMenu.Popup
          className={cn('glass min-w-40 rounded-lg p-1', className)}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuGroup(props: ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group {...props} />
}

export function DropdownMenuGroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      className={cn('px-2 py-1 text-[11px] font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export function DropdownMenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem
      className={cn(
        'relative flex cursor-pointer items-center rounded-md py-1.5 pl-7 pr-2 text-sm outline-none select-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
