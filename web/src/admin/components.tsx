// 桌面端专用展示组件：页面头、工具条、数据表、指标卡、确认按钮、键值列表。
//
// Phase 2 起改用新的设计系统（Tailwind + shadcn 风格的 components/ui + 玻璃层），
// 不再依赖 MUI。**props 与旧实现保持兼容** —— 16 个视图的调用点不因这次迁移而改。
//
// 几处必须知道的历史包袱：
//   1. `ConfirmButton` 的调用方仍传 MUI 风格的 `variant`/`color`/`size`
//      （`contained`/`outlined`/`text`、`error`/`primary`、`small`），本组件负责翻译；
//      等视图逐个迁完后（Phase 2 的 Task 4-19）可以收紧这层翻译。
//   2. `StatusBadge` 收的是 `info: StatusInfo`（不是散开的 label/tone），
//      `EmptyRow` 收的是 `text`（不是 children）—— 都照旧实现来。
//   3. `CardBlock` 曾经接受 MUI 的 `sx`；迁移后改为 `className`，但为兼容仍接受
//      并忽略 `sx`（当前无调用方使用，见 Phase 2 的扫描）。
import type { ReactNode } from 'react'
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
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-4">
      <div className="min-w-0">
        <h1 className="text-xl leading-tight font-bold">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/** Toolbar 一行筛选控件（搜索框、分段、按钮），自动换行。 */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-3">{children}</div>
}

/** StatCard 指标卡；onClick 存在时整卡可点。 */
export function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl leading-tight font-bold">{value}</div>
      {hint !== undefined && (
        <div className="mt-1 text-[12.5px] text-muted-foreground">{hint}</div>
      )}
    </>
  )

  // 玻璃卡：统计卡是「浮起」元素（§4.4）。不开 refract —— 折射只给少量静态装饰。
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="glass block w-full rounded-xl p-4 text-left outline-none transition-colors hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {body}
      </button>
    )
  }
  return <div className="glass block w-full rounded-xl p-4">{body}</div>
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
        <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'h-9 px-3 text-left align-middle text-[12.5px] font-medium whitespace-nowrap text-muted-foreground',
                  ALIGN_CLASS[col.align ?? 'left'],
                )}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-border transition-colors last:border-0 hover:bg-muted/50',
                onRowClick && 'cursor-pointer',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  data-align={col.align ?? 'left'}
                  className={cn(
                    'max-w-[420px] px-3 py-2 align-middle',
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
      className="rounded-xl border border-border bg-card p-8 text-center"
    >
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
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr] sm:items-baseline">
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
    <Card className={cn('mb-4 gap-0 p-4', className)}>
      {(title !== undefined || actions !== undefined) && (
        <CardHeader className="mb-3 flex-row items-center gap-2 p-0">
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
