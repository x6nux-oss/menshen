// 公开页共用的布局原语。公开页是外部用户的操作界面，不是营销页：
// 用不透明 surface、清晰边界和明确步骤，正文保持 16px 优先。
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function PageHeader({
  title,
  description,
  badge,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      {description && (
        <p className="mt-2 max-w-[68ch] text-[16px] leading-7 text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  )
}

export function SectionCard({
  title,
  icon,
  aside,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode
  icon?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      {title && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {icon && (
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4"
              >
                {icon}
              </span>
            )}
            <h2 className="text-[16px] leading-6 font-semibold">{title}</h2>
          </div>
          {aside}
        </div>
      )}
      <div className={cn('p-4 sm:p-5', contentClassName)}>{children}</div>
    </section>
  )
}

type CalloutTone = 'info' | 'warning' | 'danger' | 'success'

const CALLOUT: Record<CalloutTone, { box: string; icon: string; text: string }> = {
  info: {
    box: 'border-border bg-card',
    icon: 'bg-accent text-primary',
    text: 'text-muted-foreground',
  },
  warning: {
    box: 'border-warning/40 bg-card',
    icon: 'bg-warning/15 text-warning',
    text: 'text-foreground',
  },
  danger: {
    box: 'border-destructive/35 bg-card',
    icon: 'bg-destructive/10 text-destructive',
    text: 'text-foreground',
  },
  success: {
    box: 'border-success/40 bg-card',
    icon: 'bg-success/15 text-success',
    text: 'text-foreground',
  },
}

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  role,
}: {
  tone?: CalloutTone
  icon: ReactNode
  title?: ReactNode
  children: ReactNode
  role?: 'alert' | 'status' | 'note'
}) {
  const styles = CALLOUT[tone]
  return (
    <div role={role} className={cn('flex gap-3 rounded-lg border p-3.5 sm:p-4', styles.box)}>
      <span
        aria-hidden
        className={cn('grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4', styles.icon)}
      >
        {icon}
      </span>
      <div className="min-w-0">
        {title && <p className="text-[14px] leading-5 font-semibold">{title}</p>}
        <div
          className={cn(
            'text-[14px] leading-6 break-words',
            styles.text,
            title !== undefined && 'mt-1',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export interface StepItem {
  title: string
  description?: string
}

export function Steps({
  steps,
  current,
  label = '处理进度',
}: {
  steps: StepItem[]
  current: number
  label?: string
}) {
  return (
    <ol aria-label={label} className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <li
            key={step.title}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5',
              active
                ? 'border-primary/40 bg-accent'
                : done
                  ? 'border-border bg-card'
                  : 'border-border bg-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold',
                done || active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block text-[13.5px] leading-5 font-medium',
                  !done && !active && 'text-muted-foreground',
                )}
              >
                {step.title}
              </span>
              {step.description && (
                <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">
                  {step.description}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function MetaGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>{children}</dl>
  )
}

export function Meta({
  label,
  children,
  wide,
}: {
  label: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[12px] font-medium tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[15px] leading-6 break-words">{children}</dd>
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono tabular-nums', className)}>{children}</span>
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-6 text-muted-foreground">{children}</p>
}
