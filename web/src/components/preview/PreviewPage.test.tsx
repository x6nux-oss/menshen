// 预览页的存在性测试：断言它把各层的代表性组件都渲染出来了。
// 真机观感（玻璃的三层效果、暗色）由人工在这一页验收 —— jsdom 不跑 backdrop-filter。
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PreviewPage } from './PreviewPage'

describe('组件预览页', () => {
  it('渲染各分节标题', () => {
    render(<PreviewPage />)
    for (const t of ['语义 token', '玻璃层', '基础组件', '移动端组件', '反馈层']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    }
  })

  it('玻璃层演示含 Layer 1 与 Layer 3 两个样本', () => {
    render(<PreviewPage />)
    expect(screen.getByTestId('preview-glass-base')).toBeInTheDocument()
    expect(screen.getByTestId('preview-glass-refract')).toBeInTheDocument()
  })

  it('含亮暗切换开关（人工验收暗色用）', () => {
    render(<PreviewPage />)
    expect(screen.getByRole('switch', { name: /暗色|dark/i })).toBeInTheDocument()
  })

  it('渲染折射滤镜定义（否则 url(#…) 引用不到）', () => {
    const { container } = render(<PreviewPage />)
    expect(container.querySelector('#menshen-glass-refract')).not.toBeNull()
  })

  it('玻璃层样本背后有色块可透（否则看不出模糊）', () => {
    render(<PreviewPage />)
    // 三张玻璃卡悬浮在**同一块**彩色画布上（而非各自垫一块小格子）——
    // 真实界面里玻璃背后是整页内容，共享画布才看得出悬浮与模糊。
    const canvas = screen.getByTestId('preview-glass-backdrop')
    for (const id of ['preview-glass-base', 'preview-glass-refract', 'preview-glass-sheen']) {
      expect(canvas.contains(screen.getByTestId(id)), `${id} 应在这块画布内`).toBe(true)
    }
  })

  it('基础组件节渲染了按钮与徽标', () => {
    render(<PreviewPage />)
    expect(screen.getByRole('button', { name: '默认按钮' })).toBeInTheDocument()
    // 「正常」在徽标行与表格里各出现一次，所以用 getAllByText
    expect(screen.getAllByText('正常').length).toBeGreaterThanOrEqual(1)
  })

  it('移动端组件节渲染了列表行与分段控件', () => {
    render(<PreviewPage />)
    expect(screen.getByText('列表行主文案')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '判定' })).toBeInTheDocument()
  })

  it('反馈层节渲染了空态与错误态', () => {
    render(<PreviewPage />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getAllByTestId('error-state').length).toBeGreaterThanOrEqual(1)
  })

  it('切换暗色开关会给根元素加 .dark（人工验收暗色的开关）', async () => {
    render(<PreviewPage />)
    const toggle = screen.getByRole('switch', { name: /暗色|dark/i })
    await userEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // 还原，避免污染同文件后续用例与其它测试文件（class 挂在 documentElement 上）
    await userEvent.click(toggle)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
