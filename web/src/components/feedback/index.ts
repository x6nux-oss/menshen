// 反馈层统一导出。
//
// 这些组件与旧 src/ui/ 的同名组件**语义与 props 对齐**（含 useToast 返回函数的
// 签名），Phase 2/3 逐页迁移时调用点只需改 import 路径。
export { ToastProvider, useToast } from './Toast'
export type { ToastProviderProps } from './Toast'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'
export { ErrorState } from './ErrorState'
export type { ErrorStateProps } from './ErrorState'
export { ErrorBoundary } from './ErrorBoundary'
export { Skeletons } from './Skeletons'
export type { SkeletonsProps } from './Skeletons'
export { ThemeToggle } from './ThemeToggle'
export type { ThemeToggleProps } from './ThemeToggle'
