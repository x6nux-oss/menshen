// 桌面端可排序表格：在 components.tsx 的静态 DataTable 之上加**客户端排序**。
//
// 与静态版的关系：
//   - props 是 components.tsx 的 DataTableProps 的**超集**（多一个可选 `sortable`），
//     不传 `sortable` 时行为与静态版一致，调用点可随时替换。
//   - 渲染仍是 Column.render（每列自带渲染函数）—— 这是本项目的既有契约。
//     只用 TanStack 管**排序状态与排序算法**，不用它的 header/cell 渲染模型，
//     因为 accessorKey/cell 那套与 Column.render 不兼容，硬套会让每个视图都要改。
//
// 为什么不做客户端分页：admin 端的数据加载已经是服务端分页（RecordsView 的
// useLogs({page}) + 上一页/下一页；SysLogView 是无限加载）。再叠一层客户端分页会
// 与服务端的口径打架，对无限列表更是错的。排序则是纯前端增量 —— 用户点表头排
// 当前已加载的行，不需要服务端参与。
import { useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { cn } from '../lib/utils'
import { Spinner } from '../components/ui'
import { EmptyRow } from './components'
import type { Column, DataTableProps as BaseDataTableProps } from './components'

export interface DataTableProps<T> extends BaseDataTableProps<T> {
  /**
   * 可排序的列 key 列表（对应 Column.key）。缺省不可排序。
   * 排序作用在**已加载的行**上（客户端），不触发请求。
   */
  sortable?: string[]
}

/** align 取值 → Tailwind 的文本对齐类（与静态版一致）。 */
const ALIGN_CLASS: Record<NonNullable<Column<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/** aria-sort 的三种取值（ARIA 规范里排在列头 th 上）。 */
function ariaSort(dir: false | 'asc' | 'desc'): 'none' | 'ascending' | 'descending' {
  if (dir === 'asc') return 'ascending'
  if (dir === 'desc') return 'descending'
  return 'none'
}

/**
 * DataTable 桌面表格（可排序版）。
 *
 * **不用玻璃**（设计文档 §4.4：表格与长列表不做玻璃 —— 行数多时每帧重算模糊会掉帧）。
 * 加载中只在**首屏无数据**时占位；已有数据时继续渲染旧行，避免刷新闪烁。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  sortable,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const sortableSet = useMemo(() => new Set(sortable ?? []), [sortable])

  // TanStack 的列定义只为排序服务：id 用 Column.key，accessor 从行对象按 key 取值，
  // 渲染交给 Column.render（下面手动调，不走 flexRender 的 cell）。
  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((col) => ({
        id: col.key,
        accessorFn: (row: T) => (row as Record<string, unknown>)[col.key],
        enableSorting: sortableSet.has(col.key),
        // header 不参与渲染（我们用 Column.header 自己画），给个空占位满足类型。
        header: () => null,
      })),
    [columns, sortableSet],
  )

  // useReactTable 返回不可 memo 的 API，这是 TanStack Table 的设计（React Compiler 会
  // 跳过本组件，属预期）——数据量小、该组件无性能热点，故抑制这一条。
  // oxlint-disable-next-line react/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // key 用来在行重排时保持 React 的复用（避免排序后整表重建）。
    getRowId: (row) => String(rowKey(row)),
  })

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
            {table.getHeaderGroups()[0].headers.map((header, i) => {
              const col = columns[i]
              const canSort = header.column.getCanSort()
              const dir = header.column.getIsSorted()
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={canSort ? ariaSort(dir) : undefined}
                  className={cn(
                    'h-9 px-3 text-left align-middle text-[12.5px] font-medium whitespace-nowrap text-muted-foreground',
                    ALIGN_CLASS[col.align ?? 'left'],
                  )}
                  style={{ width: col.width }}
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm outline-none',
                        'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                        dir !== false && 'text-foreground',
                      )}
                    >
                      {col.header}
                      {/* 排序方向指示：未排序时给一个淡的提示，避免表头看起来不可点 */}
                      <span aria-hidden="true" className="text-[10px] leading-none">
                        {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
                  {col.render(row.original)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type { Column } from './components'
