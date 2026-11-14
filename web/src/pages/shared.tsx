// 页面内复用的小展示件：状态徽标、指标格、信息行、无限列表页脚、
// 键盘可达的用户链接与列表计数/加载占位。
// 纯展示/加载编排，无请求逻辑（请求留给各页的 query hook）。
//
// Phase 3：展示层换到新组件层（Tailwind + shadcn），**props 与导出名一律不变** ——
// 19 个页面都在用，改签名会把迁移面从 8 个文件扩散到 19 个。
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { errorStatus } from '../api/client'
import type { Bot, Chat } from '../api/types'
import { ErrorState } from '../components/feedback'
import { Badge } from '../components/ui'
import { Button } from '../components/ui/button'
import { botStatus, chatStatus } from '../lib/status'

/** BotStatusBadge 渲染 运行中/未运行/已停用 徽标。 */
export function BotStatusBadge({ bot }: { bot: Pick<Bot, 'enabled' | 'live'> }) {
  const status = botStatus(bot)
  return <Badge tone={status.tone}>{status.label}</Badge>
}

/** ChatStatusBadge 渲染 判定中/演练/停用 徽标。 */
export function ChatStatusBadge({ chat }: { chat: Pick<Chat, 'enabled' | 'dryrun'> }) {
  const status = chatStatus(chat)
  return <Badge tone={status.tone}>{status.label}</Badge>
}

/**
 * 底部操作条的紧凑按钮类名：全局 Button 的默认高度是 36，这里压回 32，
 * 按钮贴底一屏尽量放下，不遮挡正文。记录与申诉详情共用。
 */
export const COMPACT_BTN =
  'h-8 min-w-0 flex-1 basis-auto px-1.25 text-[13px] whitespace-nowrap'

/** Metric 是概览 2×2 指标格里的一格。 */
export function Metric({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <div className="text-[13px] leading-[1.4] text-muted-foreground">{label}</div>
      <div className="text-xl leading-[1.5] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/** InfoRow 是详情页信息卡里的一行：左标签（灰色 13px）+ 右内容（可换行）。 */
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 py-1.5">
      <span className="w-19 shrink-0 text-[13px] leading-[1.6] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm leading-[1.6] break-words">{children}</div>
    </div>
  )
}

/**
 * ListCount 是列表顶部的 `共 N 条` 行。total 未知或正在切换筛选（占位数据）
 * 时显示占位符，避免旧筛选的总数误导。
 */
export function ListCount({
  total,
  loading,
  testId,
}: {
  total: number | undefined
  loading: boolean
  testId?: string
}) {
  return (
    <div data-testid={testId} className="mb-1 px-0.5 text-[13px] text-muted-foreground">
      {loading || total === undefined ? '共 … 条' : `共 ${total} 条`}
    </div>
  )
}

/** ListLoading 是筛选/搜索请求进行中的轻量占位，替代会误导的空态。 */
export function ListLoading() {
  return (
    <p data-testid="list-loading" className="py-2 text-center text-[13px] text-muted-foreground">
      加载中…
    </p>
  )
}

/**
 * UserLink 是详情/列表里的 uid 资料链接。
 *
 * 渲染成 `<span role="link">` 而**不是** `<button>`：它常常嵌在行按钮
 * （ListRow 的根就是 `<button>`）内部，button 套 button 是非法 HTML，
 * 浏览器会拆掉内层节点。span 需要自己处理 Enter/Space 两个键。
 * stopPropagation 保证不触发外层行跳转。
 */
export function UserLink({
  userId,
  onClick,
  testId,
}: {
  userId: number
  onClick: () => void
  testId?: string
}) {
  return (
    <span
      role="link"
      tabIndex={0}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="inline max-w-full cursor-pointer rounded-[2px] align-baseline text-[length:inherit] leading-[inherit] font-[inherit] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      uid {userId}（资料）
    </span>
  )
}

export interface InfiniteFooterProps {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** 加载下一页失败（首屏失败由页面自己渲染 ErrorState）。 */
  isFetchNextPageError: boolean
  error: unknown
  onLoadMore: () => void
  onRetry: () => void
}

/**
 * InfiniteFooter 是无限列表的页脚：加载中… / 加载更多 / 没有更多了。
 * 有 IntersectionObserver 时滚动到底自动触发；没有（jsdom）时保留按钮兜底，
 * 测试与弱环境都能手动加载下一页。onLoadMore 用 ref 保证 observer 不频繁重建。
 */
export function InfiniteFooter({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  onLoadMore,
  onRetry,
}: InfiniteFooterProps) {
  const loadRef = useRef(onLoadMore)
  useEffect(() => {
    loadRef.current = onLoadMore
  }, [onLoadMore])

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadRef.current()
      },
      { rootMargin: '160px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage])

  if (isFetchNextPageError) {
    return <ErrorState status={errorStatus(error)} onRetry={onRetry} />
  }

  return (
    <div ref={sentinelRef} data-testid="list-footer" className="py-1.5 text-center">
      {isFetchingNextPage ? (
        <span className="text-[13px] text-muted-foreground">加载中…</span>
      ) : hasNextPage ? (
        <Button size="sm" variant="outline" onClick={onLoadMore}>
          加载更多
        </Button>
      ) : (
        <span className="text-[13px] text-muted-foreground/60">没有更多了</span>
      )}
    </div>
  )
}
