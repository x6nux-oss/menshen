// admin 展示层组件的契约测试（Phase 2：从 MUI 迁到新设计系统）。
// jsdom 不跑真实样式，这里断的是**结构与行为契约** —— 而「props 与旧实现兼容」
// 由 16 个视图的编译（tsc）间接保证：它们仍按旧 props 调用这些组件。
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CardBlock,
  ConfirmButton,
  DataTable,
  EmptyRow,
  InfoList,
  MonoText,
  PageHeader,
  StatCard,
  StatusBadge,
  Toolbar,
} from './components'
import type { Column } from './components'

interface Row {
  id: number
  name: string
}

const rows: Row[] = [
  { id: 1, name: '甲' },
  { id: 2, name: '乙' },
]

const columns: Column<Row>[] = [
  { key: 'id', header: '编号', width: 80, render: (r) => r.id },
  { key: 'name', header: '名称', render: (r) => r.name, align: 'right' },
]

describe('PageHeader', () => {
  it('渲染标题与副标题', () => {
    render(<PageHeader title="机器人" subtitle="共 3 个" />)
    expect(screen.getByText('机器人')).toBeInTheDocument()
    expect(screen.getByText('共 3 个')).toBeInTheDocument()
  })

  it('渲染右侧操作区', () => {
    render(<PageHeader title="x" actions={<button>新建</button>} />)
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument()
  })

  it('不传 subtitle / actions 时不渲染空节点', () => {
    const { container } = render(<PageHeader title="只有标题" />)
    expect(container.textContent).toBe('只有标题')
  })
})

describe('Toolbar', () => {
  it('渲染子元素', () => {
    render(
      <Toolbar>
        <input aria-label="搜索" />
      </Toolbar>,
    )
    expect(screen.getByLabelText('搜索')).toBeInTheDocument()
  })
})

describe('StatCard', () => {
  it('渲染标签、数值与提示', () => {
    render(<StatCard label="近 24 小时" value={42} hint="含去重" />)
    expect(screen.getByText('近 24 小时')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('含去重')).toBeInTheDocument()
  })

  it('有 onClick 时整卡是可点按钮且可键盘激活', async () => {
    const onClick = vi.fn()
    render(<StatCard label="待办" value={2} onClick={onClick} />)
    const card = screen.getByRole('button')
    await userEvent.click(card)
    expect(onClick).toHaveBeenCalledOnce()
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('无 onClick 时不是按钮（不可误点）', () => {
    render(<StatCard label="只读" value={1} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('DataTable', () => {
  it('渲染表头与每一行（按 rowKey）', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(screen.getByRole('columnheader', { name: '编号' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    const bodyRows = screen.getAllByRole('row').slice(1) // 去掉表头行
    expect(bodyRows).toHaveLength(2)
    expect(within(bodyRows[0]).getByText('甲')).toBeInTheDocument()
    expect(within(bodyRows[1]).getByText('乙')).toBeInTheDocument()
  })

  it('align 反映到单元格', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    const cell = screen.getByRole('cell', { name: '乙' })
    expect(cell).toHaveAttribute('data-align', 'right')
    expect(cell.className).toContain('text-right')
  })

  it('onRowClick 时整行可点', async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />)
    await userEvent.click(screen.getByText('甲'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })

  it('loading 且无数据时显示加载指示', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />)
    expect(screen.getByTestId('table-loading')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('无数据且未 loading 时显示空态', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} />)
    expect(screen.getByTestId('table-empty')).toBeInTheDocument()
  })

  it('empty 传入时优先用调用方的空态节点', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<span>没有匹配的机器人。</span>}
      />,
    )
    expect(screen.getByText('没有匹配的机器人。')).toBeInTheDocument()
    expect(screen.queryByTestId('table-empty')).not.toBeInTheDocument()
  })

  it('loading 但有数据时仍渲染表格（避免刷新时闪空态）', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading />)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('EmptyRow', () => {
  it('渲染提示文案', () => {
    render(<EmptyRow text="暂无数据" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  // Badge 把 tone 写进 data-tone（稳定的语义钩子，见 components/ui/badge.tsx），
  // 不去解析 cva 生成的类名 —— 这里按那个契约断言。
  it('按 tone 反映到 data-tone', () => {
    render(<StatusBadge info={{ label: '运行中', tone: 'ok' }} />)
    expect(screen.getByText('运行中')).toHaveAttribute('data-tone', 'ok')
  })

  it('neutral 与 warn 各自着色', () => {
    render(
      <>
        <StatusBadge info={{ label: '候选', tone: 'neutral' }} />
        <StatusBadge info={{ label: '强制', tone: 'warn' }} />
      </>,
    )
    expect(screen.getByText('候选')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getByText('强制')).toHaveAttribute('data-tone', 'warn')
  })
})

describe('ConfirmButton', () => {
  it('点击不立即执行，弹出确认框', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton title="移除群组" onConfirm={onConfirm}>
        移除
      </ConfirmButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(await screen.findByText('移除群组')).toBeInTheDocument()
  })

  it('确认后才执行 onConfirm', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton title="移除群组" confirmLabel="确认移除" onConfirm={onConfirm}>
        移除
      </ConfirmButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: '移除' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认移除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('取消不执行', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton title="移除群组" cancelLabel="再想想" onConfirm={onConfirm}>
        移除
      </ConfirmButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: '移除' }))
    await userEvent.click(await screen.findByRole('button', { name: '再想想' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('渲染 description', async () => {
    render(
      <ConfirmButton title="移除群组" description="移除后该群不再判定。" onConfirm={() => {}}>
        移除
      </ConfirmButton>,
    )
    await userEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(await screen.findByText('移除后该群不再判定。')).toBeInTheDocument()
  })

  it('disabled 时不能打开确认框', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton title="移除群组" disabled onConfirm={onConfirm}>
        移除
      </ConfirmButton>,
    )
    const btn = screen.getByRole('button', { name: '移除' })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(screen.queryByText('移除群组')).not.toBeInTheDocument()
  })

  it('接受旧调用方的 MUI variant/color/size 取值（视图未迁移前必须兼容）', () => {
    for (const variant of ['contained', 'outlined', 'text'] as const) {
      const { unmount } = render(
        <ConfirmButton variant={variant} color="error" size="small" title="t" onConfirm={() => {}}>
          x
        </ConfirmButton>,
      )
      expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument()
      unmount()
    }
  })
})

describe('InfoList', () => {
  it('渲染键值对', () => {
    render(
      <InfoList
        items={[
          { label: '归属', value: '@someone' },
          { label: '群号', value: '-100123' },
        ]}
      />,
    )
    expect(screen.getByText('归属')).toBeInTheDocument()
    expect(screen.getByText('@someone')).toBeInTheDocument()
    expect(screen.getByText('-100123')).toBeInTheDocument()
  })
})

describe('CardBlock', () => {
  it('渲染标题、操作与内容', () => {
    render(
      <CardBlock title="运行状态" actions={<button>刷新</button>}>
        <div>内容</div>
      </CardBlock>,
    )
    expect(screen.getByText('运行状态')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('无标题无操作时只渲染内容', () => {
    render(
      <CardBlock>
        <div>裸内容</div>
      </CardBlock>,
    )
    expect(screen.getByText('裸内容')).toBeInTheDocument()
  })
})

describe('MonoText', () => {
  it('渲染等宽文本', () => {
    render(<MonoText>abc_123</MonoText>)
    expect(screen.getByText('abc_123')).toBeInTheDocument()
  })
})
