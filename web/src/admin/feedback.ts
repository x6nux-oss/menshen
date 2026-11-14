// 操作反馈：所有写操作统一成功提示或失败提示（用服务端文案），
// 避免每个视图各写一遍 toast 分流。
//
// Phase 2 视图迁移完成后一路切到新反馈层（components/feedback 的 sonner 封装）。
// 注意：新 useToast 返回的是**函数**（不是 { show } 对象），与旧 src/ui 的签名一致。
import { ApiError } from '../api/client'
import { useToast } from '../components/feedback'

export type Run = (promise: Promise<unknown>, okText?: string) => void

export function useRunFeedback(): Run {
  const toast = useToast()
  return (promise, okText = '已保存') => {
    promise
      .then(() => toast(okText))
      .catch((err) => toast(err instanceof ApiError ? err.message : '操作失败，请重试'))
  }
}
