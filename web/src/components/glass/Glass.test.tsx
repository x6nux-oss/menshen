// 玻璃层的类名契约测试。jsdom 不执行 backdrop-filter，所以这里断的是
// **类名与 DOM 结构**（真机观感由预览页人工验收）—— 这是设计文档 §4 的可测部分。
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Glass, GlassCard, GlassFilterDefs, GlassPanel, GlassToolbar } from './index'

describe('Glass 玻璃容器', () => {
  it('默认带 .glass 类（Layer 1 基线毛玻璃）', () => {
    render(<Glass data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').className).toContain('glass')
  })

  it('refract 为真时加 .glass--refract（Layer 3 显式 opt-in）', () => {
    render(<Glass data-testid="g" refract>内容</Glass>)
    const el = screen.getByTestId('g')
    expect(el.className).toContain('glass--refract')
  })

  it('默认不带 refract —— 折射必须是显式 opt-in（§4.5）', () => {
    render(<Glass data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').className).not.toContain('glass--refract')
  })

  it('sheen 为真时加 data-sheen="in"（触发镜面扫光）', () => {
    render(<Glass data-testid="g" sheen>内容</Glass>)
    expect(screen.getByTestId('g').getAttribute('data-sheen')).toBe('in')
  })

  it('as 可换元素类型', () => {
    render(<Glass as="section" data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').tagName).toBe('SECTION')
  })
})

describe('玻璃预设', () => {
  it('GlassCard 是 .glass 且圆角 lg', () => {
    render(<GlassCard data-testid="c">内容</GlassCard>)
    const el = screen.getByTestId('c')
    expect(el.className).toContain('glass')
    expect(el.className).toContain('rounded-lg')
  })

  it('GlassPanel 是 .glass 且圆角 xl（侧栏/大面板）', () => {
    render(<GlassPanel data-testid="p">内容</GlassPanel>)
    expect(screen.getByTestId('p').className).toContain('rounded-xl')
  })

  it('GlassToolbar 是 .glass 且带底部描边', () => {
    render(<GlassToolbar data-testid="t">内容</GlassToolbar>)
    const el = screen.getByTestId('t')
    expect(el.className).toContain('glass')
    expect(el.className).toContain('border-b')
  })

  it('预设透传 refract', () => {
    render(<GlassCard data-testid="c" refract>内容</GlassCard>)
    expect(screen.getByTestId('c').className).toContain('glass--refract')
  })
})

describe('GlassFilterDefs', () => {
  it('渲染一个隐藏的 SVG，含折射滤镜与噪点滤镜定义', () => {
    const { container } = render(<GlassFilterDefs />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('#menshen-glass-refract')).not.toBeNull()
  })

  it('只渲染一次即可复用（幂等渲染不报错）', () => {
    render(<><GlassFilterDefs /><GlassFilterDefs /></>)
    expect(document.querySelectorAll('#menshen-glass-refract').length).toBe(2)
  })
})
