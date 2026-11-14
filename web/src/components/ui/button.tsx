import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { isValidElement } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'tap-44 inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,border-color,box-shadow] duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-card hover:border-primary/40 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-muted text-foreground hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-2.5 text-[0.8rem]',
        default: 'h-10 px-4',
        lg: 'h-11 px-4 text-base',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends Omit<ComponentProps<typeof BaseButton>, 'className' | 'render'>,
    VariantProps<typeof buttonVariants> {
  className?: string
  /** 把样式与行为套到子元素上（包 <a> 做链接按钮）。 */
  asChild?: boolean
}

/**
 * 按钮。交互原语用 Base UI Button（键盘、焦点、disabled 语义），样式用 cva。
 *
 * asChild 走 Base UI 的 `render` prop：把按钮的行为与样式合并到子元素上，
 * 而不是嵌一层 button（嵌 button 会产出非法的 <button><a> 结构）。
 */
export function Button({ className, variant, size, asChild, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className)
  if (asChild && isValidElement(children)) {
    return (
      <BaseButton
        render={children}
        // Base UI 把 className 合并到被 render 的元素上（merge-props 语义）
        className={classes}
        {...props}
      />
    )
  }
  return (
    <BaseButton className={classes} {...props}>
      {children}
    </BaseButton>
  )
}
