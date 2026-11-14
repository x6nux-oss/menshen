import type { ReactNode } from 'react'

export interface ChatRefProps {
  /** 群展示名（后端 LookupChatRef 的 Display：群名，未知时为 chat_id）。 */
  name?: string | number | null
  /** 公开群的 t.me 链接；私有群或未知时为空，此时只渲染纯文本。 */
  url?: string | null
  /** name 与 url 都缺省（或 name 为空）时的回退文本。 */
  fallback?: string | number | null
  className?: string
}

/**
 * ChatRef 渲染一个群的引用：公开群是带 t.me 链接的群名，私有群只有群名。
 * 凡是展示 chat_id 的地方都改用它，让群引用对人可读、可点。
 *
 * props 与旧 `src/ui/ChatRef` 完全对齐（Phase 2/3 迁移时调用点不用改）。
 * 只把 MUI 的 `Link` 换成原生 `<a>`：外部链接固定 target=_blank + rel=noopener
 * （防 tabnabbing），样式用 Tailwind 的下划线 hover。
 */
export function ChatRef({ name, url, fallback, className }: ChatRefProps): ReactNode {
  const text =
    name === undefined || name === null || name === ''
      ? fallback === undefined || fallback === null
        ? ''
        : String(fallback)
      : String(name)
  if (!text) return null
  if (!url) return <>{text}</>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'text-inherit hover:underline'}
    >
      {text}
    </a>
  )
}
