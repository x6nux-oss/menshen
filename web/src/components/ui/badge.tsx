import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 语义徽标。**tone 取值必须与 `src/lib/status.ts` 的 StatusTone 完全一致**
 * （ok / no / warn / neutral）—— 这是跨阶段契约：`lib/` 产出的 tone 直接喂给本组件，
 * Phase 2/3 迁移时不该改动任何调用点的取值。
 *
 * 底色用语义色的 16% 淡底；文字色在亮暗中分别取值，沿用旧 `src/ui/Badge.tsx`
 * 的 TONE_TEXT 实测值（在 16% 同色淡底上 ≥4.5:1，11px 小字 AA）。
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        ok: 'bg-success/16 text-[#067A3E] dark:text-[#4ADE80]',
        no: 'bg-destructive/16 text-[#C62828] dark:text-[#FF8A80]',
        warn: 'bg-warning/16 text-[#7A5B00] dark:text-[#FFD54F]',
        neutral: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>

export interface BadgeProps extends Omit<ComponentProps<'span'>, 'className'> {
  /** 语义色调；缺省 neutral。取值集与 lib/status.ts 的 StatusTone 一致。 */
  tone?: BadgeTone
  className?: string
}

/**
 * 语义徽标。tone 同时写进 `data-tone` —— 那是稳定的语义钩子
 * （测试与将来的样式覆盖都据此判断，不必去解析 cva 生成的类名）。
 */
export function Badge({ className, tone, children, ...props }: BadgeProps) {
  const resolved = tone ?? 'neutral'
  return (
    <span
      data-tone={resolved}
      className={cn(badgeVariants({ tone: resolved }), className)}
      {...props}
    >
      {children}
    </span>
  )
}
