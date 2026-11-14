import type { ReactNode } from 'react'
import { ArrowUpRight, Inbox } from 'lucide-react'
import { cn } from '../lib/utils'
import type { StatusInfo } from '../lib/status'
import { Badge } from '../components/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '../components/ui'

/** PageHeader 页面标题 + 说明 + 右侧操作区。 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-7 flex flex-wrap items-start gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/** Toolbar 一行筛选控件（搜索框、分段、按钮），自动换行。 */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3', className)}>{children}</div>
}

/** StatCard 指标卡；onClick 存在时整卡可点。 */
export function StatCard({
  label,
  value,
  hint,
  onClick,
  icon,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  onClick?: () => void
  icon?: ReactNode
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {label}
        {icon && <span aria-hidden className="ml-auto [&_svg]:size-4">{icon}</span>}
        {onClick && <ArrowUpRight className="ml-auto size-4" aria-hidden />}
      </div>
      <div className="mt-4 text-[30px] font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      {hint !== undefined && (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</div>
      )}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full rounded-lg border border-border bg-card p-5 text-left outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </button>
    )
  }
  return <div className="block w-full rounded-lg border border-border bg-card p-5">{body}</div>
}

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  width?: number | string
  align?: 'left' | 'center' | 'right'
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  loading?: boolean
  /** 空态节点；缺省是一句「暂无数据」。 */
  empty?: ReactNode
}

/** align 取值 → Tailwind 的文本对齐类。 */
const ALIGN_CLASS: Record<NonNullable<Column<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * DataTable 桌面表格：表头、行可点、加载与空态内置。
 *
 * **不用玻璃**（§4.4：表格与长列表不做玻璃 —— 行数多时每帧重算模糊会掉帧）。
 * 加载中只在**首屏无数据**时占位；已有数据时继续渲染旧行，避免刷新闪烁。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
}: DataTableProps<T>) {
  if (loading && rows.length === 0) {
    return (
      <div data-testid="table-loading" className="flex justify-center py-12">
        <Spinner size={26} className="text-muted-foreground" />
      </div>
    )
  }
  if (rows.length === 0) {
    if (empty !== undefined) return <>{empty}</>
    return <EmptyRow text="暂无数据" />
  }
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/70">
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'h-11 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
                  ALIGN_CLASS[col.align ?? 'left'],
                )}
                style={{ width: col.width }}
              >
                {col.header === '' ? <span className="sr-only">操作</span> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? (event) => {
                if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"], [role="checkbox"]')) return
                onRowClick(row)
              } : undefined}
              onKeyDown={onRowClick ? (event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onRowClick(row)
                }
              } : undefined}
              className={cn(
                'border-b border-border transition-colors last:border-0 hover:bg-muted/50 focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  data-align={col.align ?? 'left'}
                  className={cn(
                    'max-w-[420px] px-4 py-3.5 align-middle',
                    ALIGN_CLASS[col.align ?? 'left'],
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** EmptyRow 表格内的空态。 */
export function EmptyRow({ text }: { text: ReactNode }) {
  return (
    <div
      data-testid="table-empty"
      className="rounded-lg border border-border bg-card px-6 py-12 text-center"
    >
      <Inbox className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

/** StatusBadge 把 lib/status 的 StatusInfo 渲染成彩色徽标。 */
export function StatusBadge({ info }: { info: StatusInfo }) {
  return <Badge tone={info.tone}>{info.label}</Badge>
}

/** MUI ButtonProps 里调用方仍在传的取值（视图未迁完期间必须翻译）。 */
type LegacyVariant = 'contained' | 'outlined' | 'text'
type LegacyColor = 'primary' | 'error' | 'inherit' | 'secondary' | 'success' | 'warning'
type LegacySize = 'small' | 'medium' | 'large'

export interface ConfirmButtonProps {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** 危险操作：确认按钮用错误色。 */
  danger?: boolean
  disabled?: boolean
  onConfirm: () => void
  children: ReactNode
  /** 旧调用方的 MUI 变体名；本组件翻译成新变体。 */
  variant?: LegacyVariant
  /** 旧调用方的 MUI 颜色名。 */
  color?: LegacyColor
  /** 旧调用方的 MUI 尺寸名。 */
  size?: LegacySize
  className?: string
}

/** 把旧调用方的 MUI variant/color 翻译成新组件的 variant。 */
function translateVariant(variant?: LegacyVariant, color?: LegacyColor) {
  if (kindOf(variant, color) === 'destructive') return 'destructive' as const
  switch (variant) {
    case 'outlined':
      return 'outline' as const
    case 'text':
      return 'ghost' as const
    default:
      return 'default' as const
  }
}

function kindOf(variant?: LegacyVariant, color?: LegacyColor) {
  if (color === 'error') return 'destructive'
  if (variant === 'contained') return 'primary'
  return 'neutral'
}

/** 把旧 size 名翻译成新 size。 */
function translateSize(size?: LegacySize) {
  if (size === 'small') return 'sm' as const
  if (size === 'large') return 'lg' as const
  return 'default' as const
}

/**
 * ConfirmButton 需要二次确认的危险操作：点击先弹确认框，确认后才执行。
 *
 * 用 AlertDialog 而非 Dialog —— 危险操作不能点遮罩/Esc 顺手关掉，
 * 必须明确选「确认」或「取消」。
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  disabled = false,
  onConfirm,
  children,
  variant,
  color,
  size,
  className,
}: ConfirmButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant={danger ? 'destructive' : translateVariant(variant, color)}
            size={translateSize(size)}
            disabled={disabled}
            className={className}
          >
            {children}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description !== undefined && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size={translateSize(size)}>
                {cancelLabel}
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button
                variant={danger ? 'destructive' : 'default'}
                size={translateSize(size)}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** InfoList 键值信息块（详情页通用）。 */
export function InfoList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[minmax(96px,auto)_1fr] sm:items-baseline">
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-[13px] whitespace-nowrap text-muted-foreground">{item.label}</dt>
          <dd className="text-[13.5px] break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** CardBlock 一块带标题的内容卡片。 */
export function CardBlock({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** 覆盖卡片样式（旧实现叫 sx，改名为 className；旧调用方无 sx 用法）。 */
  className?: string
  /** @deprecated 旧 MUI 写法，迁移期接受并忽略。 */
  sx?: unknown
}) {
  return (
    <Card className={cn('mb-5 min-w-0 gap-0 p-5', className)}>
      {(title !== undefined || actions !== undefined) && (
        <CardHeader className="mb-4 flex-row flex-wrap items-center gap-3 p-0">
          {title !== undefined && <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>}
          {actions !== undefined && <div className="ml-auto">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}

/** MonoText 正文/正则等等宽展示，长文可换行。 */
export function MonoText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono text-[12.5px] break-all',
        className,
      )}
    >
      {children}
    </span>
  )
}
