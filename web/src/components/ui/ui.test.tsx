// shadcn 组件的类名/行为契约测试。jsdom 不跑真实样式，所以断的是
// **结构契约**（类名、role、可交互性）；真机观感由组件预览页人工验收。
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from './index'

describe('Button', () => {
  it('默认渲染 button 元素且可点击', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('variant 与 size 反映在类名上', () => {
    render(
      <Button variant="destructive" size="sm" data-testid="b">
        删除
      </Button>,
    )
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('destructive')
    expect(cls).toMatch(/h-8|text-\[0\.8rem\]/)
  })

  it('disabled 时不可点击', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('asChild 时把样式套到子元素上（用于包 <a>）', () => {
    render(
      <Button asChild>
        <a href="/x" data-testid="l">
          链接
        </a>
      </Button>,
    )
    const el = screen.getByTestId('l')
    expect(el.tagName).toBe('A')
    // 样式必须真的落在子元素上，否则 asChild 等于没生效
    expect(el.className).toContain('inline-flex')
  })
})

describe('Badge', () => {
  it.each(['ok', 'no', 'warn', 'neutral'] as const)('tone=%s 写进 data-tone 且带对应底色', (tone) => {
    render(
      <Badge tone={tone} data-testid="b">
        徽标
      </Badge>,
    )
    const el = screen.getByTestId('b')
    expect(el.getAttribute('data-tone')).toBe(tone)
    // cva 生成的类名里不含 tone 名（那是实现细节），断言真实样式类
    expect(el.className).toMatch(/bg-(success|destructive|warning|muted)/)
  })

  it('不传 tone 时是 neutral', () => {
    render(<Badge data-testid="b">徽标</Badge>)
    const el = screen.getByTestId('b')
    expect(el.getAttribute('data-tone')).toBe('neutral')
    expect(el.className).toContain('bg-muted')
  })

  it('tone 取值与 lib/status.ts 的 StatusTone 同集（跨阶段契约）', () => {
    // 四个 tone 都必须是 status.ts 会产出的值，Phase 2/3 迁移时直接喂给它
    for (const tone of ['ok', 'no', 'warn', 'neutral'] as const) {
      const { unmount } = render(
        <Badge tone={tone} data-testid="b">
          x
        </Badge>,
      )
      expect(screen.getByTestId('b')).toBeInTheDocument()
      unmount()
    }
  })
})

describe('Input / Textarea / Label', () => {
  it('Input 受控值可输入', async () => {
    render(<Input placeholder="名称" />)
    await userEvent.type(screen.getByPlaceholderText('名称'), 'abc')
    expect(screen.getByPlaceholderText('名称')).toHaveValue('abc')
  })

  it('Input aria-invalid 时描边转 destructive（无障碍）', () => {
    render(<Input aria-invalid data-testid="i" />)
    const el = screen.getByTestId('i')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    expect(el.className).toContain('destructive')
  })

  it('Textarea 可输入多行', async () => {
    render(<Textarea placeholder="理由" />)
    await userEvent.type(screen.getByPlaceholderText('理由'), 'line1')
    expect(screen.getByPlaceholderText('理由')).toHaveValue('line1')
  })

  it('Label 通过 htmlFor 关联控件', () => {
    render(
      <>
        <Label htmlFor="n">名称</Label>
        <Input id="n" />
      </>,
    )
    expect(screen.getByLabelText('名称')).toBeInTheDocument()
  })
})

describe('Switch', () => {
  it('切换触发 onCheckedChange（只回调布尔值）', async () => {
    const onChange = vi.fn()
    render(<Switch onCheckedChange={onChange} aria-label="启用" />)
    await userEvent.click(screen.getByRole('switch', { name: '启用' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('已选中时切换回调 false', async () => {
    const onChange = vi.fn()
    render(<Switch checked onCheckedChange={onChange} aria-label="启用" />)
    await userEvent.click(screen.getByRole('switch', { name: '启用' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })
})

describe('Checkbox', () => {
  it('点击切换并回调布尔值', async () => {
    const onChange = vi.fn()
    render(<Checkbox onCheckedChange={onChange} aria-label="选择" />)
    await userEvent.click(screen.getByRole('checkbox', { name: '选择' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Select', () => {
  it('选中间项后回调 value', async () => {
    const onValueChange = vi.fn()
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="渠道">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">甲</SelectItem>
          <SelectItem value="b">乙</SelectItem>
        </SelectContent>
      </Select>,
    )
    await userEvent.click(screen.getByRole('combobox', { name: '渠道' }))
    await userEvent.click(await screen.findByRole('option', { name: '乙' }))
    expect(onValueChange).toHaveBeenCalledWith('b')
  })
})

describe('Card', () => {
  it('组合渲染标题与内容', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>标题</CardTitle>
        </CardHeader>
        <CardContent>内容</CardContent>
      </Card>,
    )
    expect(screen.getByText('标题')).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })
})

describe('Dialog', () => {
  it('触发按钮打开弹层并显示标题与内容', async () => {
    render(
      <Dialog>
        <DialogTrigger>打开</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认操作</DialogTitle>
            <DialogDescription>这步不可撤销</DialogDescription>
          </DialogHeader>
          <p>正文</p>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByText('确认操作')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('确认操作')).toBeInTheDocument()
    expect(screen.getByText('这步不可撤销')).toBeInTheDocument()
  })

  it('弹层内容用玻璃底（浮起元素，§4.4）', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent data-testid="dc">
          <DialogTitle>标题</DialogTitle>
          <DialogDescription>说明</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect((await screen.findByTestId('dc')).className).toContain('glass')
  })
})

describe('Table', () => {
  it('渲染表头与单元格', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>列名</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>值</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.getByRole('columnheader', { name: '列名' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '值' })).toBeInTheDocument()
  })
})

describe('Separator / Skeleton / ScrollArea / Avatar', () => {
  it('Separator 水平时是 separator 角色', () => {
    render(<Separator />)
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('Skeleton 渲染占位并可在 reduced-motion 下停动画', () => {
    render(<Skeleton data-testid="s" />)
    const cls = screen.getByTestId('s').className
    expect(cls).toContain('animate-pulse')
    expect(cls).toContain('motion-reduce:animate-none')
  })

  it('ScrollArea 渲染子内容', () => {
    render(<ScrollArea>内容</ScrollArea>)
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('Avatar 渲染兜底文字', () => {
    render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText('AB')).toBeInTheDocument()
  })
})
