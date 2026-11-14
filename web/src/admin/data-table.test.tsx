// 可排序 DataTable 的契约测试。
//
// 注意：jsdom 不跑真实样式，所以这里断的是**结构与行为**（行序、aria-sort、
// 表头是否可点），真机观感由 Phase 2 的浏览器验收覆盖。
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'
import type { Column } from './components'

interface Row {
  id: number
  name: string
  size: number
}

const rows: Row[] = [
  { id: 3, name: 'c', size: 30 },
  { id: 1, name: 'a', size: 10 },
  { id: 2, name: 'b', size: 20 },
]

const columns: Column<Row>[] = [
  { key: 'name', header: '名称', render: (r) => r.name },
  { key: 'size', header: '大小', render: (r) => String(r.size), align: 'right' },
]

/** 取表格体里某一列的全部文本，用于断言行序。 */
function columnTexts(headerName: string) {
  const table = screen.getByRole('table')
  const headers = within(table).getAllByRole('columnheader')
  const idx = headers.findIndex((h) => h.textContent?.includes(headerName))
  const body = within(table).getAllByRole('row').slice(1) // 去表头行
  return body.map((tr) => within(tr).getAllByRole('cell')[idx].textContent)
}

describe('DataTable（可排序）', () => {
  it('渲染表头与全部行', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1)
  })

  it('不传 sortable 时与原序一致，且表头不是按钮', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(columnTexts('名称')).toEqual(['c', 'a', 'b'])
    expect(screen.queryByRole('button', { name: /名称/ })).not.toBeInTheDocument()
  })

  it('可排序列：点击表头升序、再点降序', async () => {
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sortable={['name']} />,
    )
    const header = screen.getByRole('button', { name: /名称/ })

    await userEvent.click(header)
    expect(columnTexts('名称')).toEqual(['a', 'b', 'c'])

    await userEvent.click(header)
    expect(columnTexts('名称')).toEqual(['c', 'b', 'a'])
  })

  it('aria-sort 反映当前排序方向', async () => {
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sortable={['name']} />,
    )
    const th = screen.getByRole('button', { name: /名称/ }).closest('th')!
    expect(th).toHaveAttribute('aria-sort', 'none')

    await userEvent.click(screen.getByRole('button', { name: /名称/ }))
    expect(th).toHaveAttribute('aria-sort', 'ascending')

    await userEvent.click(screen.getByRole('button', { name: /名称/ }))
    expect(th).toHaveAttribute('aria-sort', 'descending')
  })

  it('不在 sortable 里的列不可排序（表头非按钮）', () => {
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sortable={['name']} />,
    )
    expect(screen.queryByRole('button', { name: /大小/ })).not.toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
  })

  it('行可点：点击回调收到原始行', async () => {
    const onRowClick = vi.fn()
    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    )
    await userEvent.click(screen.getByText('a'))
    expect(onRowClick).toHaveBeenCalledWith({ id: 1, name: 'a', size: 10 })
  })

  it('loading 且无数据时显示占位', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />)
    expect(screen.getByTestId('table-loading')).toBeInTheDocument()
  })

  it('loading 且已有数据时继续渲染旧行（不闪烁）', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading />)
    expect(screen.queryByTestId('table-loading')).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1)
  })

  it('无数据且无 empty 时用默认空态', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} />)
    expect(screen.getByTestId('table-empty')).toBeInTheDocument()
  })

  it('无数据且给了 empty 时渲染自定义空态', () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>自定义空</p>} />,
    )
    expect(screen.getByText('自定义空')).toBeInTheDocument()
    expect(screen.queryByTestId('table-empty')).not.toBeInTheDocument()
  })

  it('排序用 Column.render 渲染单元格（契约不变）', async () => {
    // 若渲染走了 TanStack 的 cell 模型，这里会拿到原始值而非 render 的输出。
    const customColumns: Column<Row>[] = [
      { key: 'name', header: '名称', render: (r) => <em>#{r.name}#</em> },
    ]
    render(
      <DataTable columns={customColumns} rows={rows} rowKey={(r) => r.id} sortable={['name']} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /名称/ }))
    expect(columnTexts('名称')).toEqual(['#a#', '#b#', '#c#'])
  })
})
