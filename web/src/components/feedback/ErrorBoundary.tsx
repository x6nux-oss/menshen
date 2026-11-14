// ErrorBoundary 兜住渲染期异常：白屏是最坏的失败形态，至少给出原因与刷新入口。
//
// 只捕获渲染/生命周期异常（模块加载失败、事件回调里的异常不在范围内）。
// 必须是 class 组件 —— React 的错误边界 API（getDerivedStateFromError /
// componentDidCatch）只存在于 class 上，函数组件无法替代。
//
// 保留旧实现的 props（children + 可选 title）与 data-testid="error-boundary"。
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '../ui'

interface ErrorBoundaryProps {
  children: ReactNode
  /** title 是出错卡片的标题，默认为“页面出错了”。 */
  title?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="error-boundary"
          className="mx-auto mt-8 max-w-[520px] rounded-lg bg-card p-3"
        >
          <p className="mb-1 text-[17px] font-bold">{this.props.title ?? '页面出错了'}</p>
          <p className="text-[13.5px] break-words text-muted-foreground">
            {this.state.error.message || String(this.state.error)}
          </p>
          <Button className="mt-2" onClick={() => window.location.reload()}>
            刷新重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
