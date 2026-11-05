// 移动端组件层的契约测试。jsdom 不跑真实样式，断的是行为与无障碍属性
// （触控尺寸、真机手感由 Phase 1 的预览页人工验收）。
//
// 注意 SwitchRow 用 `primary`（不是 label）、ConfirmOptions 用 `danger`
// （不是 destructive）—— 与旧 src/ui/ 的实现对齐，是 Phase 2/3 迁移的契约。
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ActionSheetProvider,
  ListRow,
  SearchField,
  SectionCard,
  Segmented,
  SwitchRow,
  TabBar,
  TopBar,
  useConfirm,
} from './index'

describe('ListRow', () => {
  it('有 onClick 时整行可点且可键盘激活', async () => {
    const onClick = vi.fn()
    render(<ListRow primary="群 123" onClick={onClick} />)
    const row = screen.getByRole('button')
    await userEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('渲染副行、徽标、值、箭头', () => {
    render(<ListRow primary="主" secondary="副" badge={<span>徽</span>} value="值" chevron />)
    expect(screen.getByText('副')).toBeInTheDocument()
    expect(screen.getByText('徽')).toBeInTheDocument()
    expect(screen.getByText('值')).toBeInTheDocument()
  })

  it('无 onClick 时不是 button（不可点的行不该有按钮语义）', () => {
    render(<ListRow primary="只读行" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('disabled 时不触发 onClick', async () => {
    const onClick = vi.fn()
    render(<ListRow primary="x" onClick={onClick} disabled />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('secondaryMono 给副行加等宽字体', () => {
    render(<ListRow primary="p" secondary="-1001234567890" secondaryMono />)
    expect(screen.getByText('-1001234567890').className).toContain('font-mono')
  })
})

describe('SectionCard', () => {
  it('渲染标题、内容与 footer', () => {
    render(
      <SectionCard title="分组" footer={<span>添加</span>}>
        <span>正文</span>
      </SectionCard>,
    )
    expect(screen.getByRole('heading', { name: '分组' })).toBeInTheDocument()
    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.getByText('添加')).toBeInTheDocument()
  })

  it('不传 title 时不渲染标题元素', () => {
    render(<SectionCard><span>只有内容</span></SectionCard>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

describe('SwitchRow', () => {
  it('点开关回调新值', async () => {
    const onChange = vi.fn()
    render(<SwitchRow primary="启用判定" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('点整行也切换（移动端习惯）', async () => {
    const onChange = vi.fn()
    render(<SwitchRow primary="启用判定" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByText('启用判定'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('primary 是字符串时拿它当开关的无障碍名', () => {
    render(<SwitchRow primary="启用判定" checked onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: '启用判定' })).toBeInTheDocument()
  })

  it('ariaLabel 覆盖默认无障碍名', () => {
    render(<SwitchRow primary={<span>复杂节点</span>} ariaLabel="指定名" checked onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: '指定名' })).toBeInTheDocument()
  })

  it('disabled 时不回调', async () => {
    const onChange = vi.fn()
    render(<SwitchRow primary="x" checked={false} onChange={onChange} disabled />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'a', label: '判定' },
    { value: 'b', label: '申诉' },
  ]

  it('点击选项回调 value', async () => {
    const onChange = vi.fn()
    render(<Segmented value="a" onChange={onChange} options={options} />)
    await userEvent.click(screen.getByRole('button', { name: '申诉' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('当前项标 aria-pressed（无障碍）', () => {
    render(<Segmented value="a" onChange={() => {}} options={options} />)
    expect(screen.getByRole('button', { name: '判定' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '申诉' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('再点当前项不触发 onChange（避免空态）', async () => {
    const onChange = vi.fn()
    render(<Segmented value="a" onChange={onChange} options={options} />)
    await userEvent.click(screen.getByRole('button', { name: '判定' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ariaLabel 传给容器', () => {
    render(<Segmented value="a" onChange={() => {}} options={options} ariaLabel="视图" />)
    expect(screen.getByRole('group', { name: '视图' })).toBeInTheDocument()
  })
})

describe('SearchField', () => {
  it('输入触发 onChange', async () => {
    const onChange = vi.fn()
    render(<SearchField value="" onChange={onChange} placeholder="搜索" />)
    await userEvent.type(screen.getByPlaceholderText('搜索'), 'ab')
    expect(onChange).toHaveBeenCalled()
  })

  it('placeholder 缺省时也作无障碍名', () => {
    render(<SearchField value="" onChange={() => {}} />)
    expect(screen.getByRole('searchbox', { name: '搜索' })).toBeInTheDocument()
  })

  it('有内容时显示清空按钮，点击回空串', async () => {
    const onChange = vi.fn()
    render(<SearchField value="abc" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '清空' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('clearable=false 时不显示清空按钮', () => {
    render(<SearchField value="abc" onChange={() => {}} clearable={false} />)
    expect(screen.queryByRole('button', { name: '清空' })).not.toBeInTheDocument()
  })

  it('回车触发 onSubmit', async () => {
    const onSubmit = vi.fn()
    render(<SearchField value="x" onChange={() => {}} onSubmit={onSubmit} placeholder="搜" />)
    await userEvent.type(screen.getByPlaceholderText('搜'), '{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

describe('TabBar', () => {
  const tabs = [
    { key: 'overview', label: '概览' },
    { key: 'bots', label: '机器人' },
  ]

  it('点击 tab 回调 key', async () => {
    const onChange = vi.fn()
    render(<TabBar tabs={tabs} active="overview" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '机器人' }))
    expect(onChange).toHaveBeenCalledWith('bots')
  })

  it('当前 tab 标 aria-current（无障碍）', () => {
    render(<TabBar tabs={tabs} active="overview" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '概览' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '机器人' })).not.toHaveAttribute('aria-current')
  })

  it('渲染图标与无障碍名', () => {
    render(
      <TabBar
        tabs={[{ key: 'a', label: '首页', icon: <svg data-testid="ic" /> }]}
        active="a"
        onChange={() => {}}
        ariaLabel="主导航"
      />,
    )
    expect(screen.getByTestId('ic')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })
})

describe('TopBar', () => {
  it('不传 onBack 时不渲染返回按钮', () => {
    render(<TopBar title="门神" />)
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument()
  })

  it('有 onBack 时渲染返回按钮并回调', async () => {
    const onBack = vi.fn()
    render(<TopBar title="详情" onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('渲染标题与副标题', () => {
    render(<TopBar title="门神" subtitle="主管理员 · 张三" />)
    expect(screen.getByText('门神')).toBeInTheDocument()
    expect(screen.getByText('主管理员 · 张三')).toBeInTheDocument()
  })

  it('渲染右侧动作', () => {
    render(<TopBar title="t" actions={<button>刷新</button>} />)
    expect(screen.getByTestId('topbar-actions')).toContainElement(
      screen.getByRole('button', { name: '刷新' }),
    )
  })
})

describe('ActionSheet / useConfirm', () => {
  function Probe() {
    const confirm = useConfirm()
    return (
      <button onClick={() => void confirm({ title: '确认删除？', danger: true })}>删</button>
    )
  }

  it('confirm 弹出确认层，点确认关闭', async () => {
    render(
      <ActionSheetProvider>
        <Probe />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    expect(await screen.findByText('确认删除？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument()
  })

  it('点取消关闭且不抛错', async () => {
    render(
      <ActionSheetProvider>
        <Probe />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    await userEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument()
  })

  it('confirm 返回 Promise<boolean>：确认 true、取消 false', async () => {
    let seen: boolean | null = null
    function Probe2() {
      const confirm = useConfirm()
      return (
        <button
          onClick={() => {
            void confirm({ title: 'Q' }).then((ok) => {
              seen = ok
            })
          }}
        >
          问
        </button>
      )
    }
    render(
      <ActionSheetProvider>
        <Probe2 />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '问' }))
    await userEvent.click(await screen.findByRole('button', { name: '确定' }))
    await vi.waitFor(() => expect(seen).toBe(true))

    seen = null
    await userEvent.click(screen.getByRole('button', { name: '问' }))
    await userEvent.click(await screen.findByRole('button', { name: '取消' }))
    await vi.waitFor(() => expect(seen).toBe(false))
  })

  it('Esc 关闭（= 取消）', async () => {
    render(
      <ActionSheetProvider>
        <Probe />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    await screen.findByText('确认删除？')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument()
  })

  it('渲染为 dialog 且带 aria-modal 与标题关联（无障碍）', async () => {
    render(
      <ActionSheetProvider>
        <Probe />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)).toHaveTextContent('确认删除？')
  })

  it('danger 时确认按钮用 destructive 样式', async () => {
    render(
      <ActionSheetProvider>
        <Probe />
      </ActionSheetProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    const confirmBtn = await screen.findByRole('button', { name: '确定' })
    expect(confirmBtn.className).toContain('destructive')
  })

  it('无 Provider 时 useConfirm 抛错（用错地方要立刻暴露）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/ActionSheetProvider/)
    spy.mockRestore()
  })
})
