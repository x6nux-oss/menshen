// InvalidState 是链接无效 / 已失效 / 读取失败的统一占位。
//
// 公开页没有可靠的「返回上一步」：用户多半从 Telegram 里点进来，站内没有
// 上一页。所以只给原因与可执行建议（联系管理员 / 回 bot 重新打开），
// 不放一个点了只会离开站点的假返回按钮。
import { Link2Off } from 'lucide-react'

export function InvalidState({ message, title = '链接无法使用' }: { message: string; title?: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-border bg-card px-5 py-8 text-center sm:px-8"
    >
      <span
        aria-hidden
        className="mx-auto grid size-11 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5"
      >
        <Link2Off />
      </span>
      <p className="mt-4 text-[17px] font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-[46ch] text-[15px] leading-7 text-muted-foreground">
        {message}
      </p>
      <p className="mx-auto mt-4 max-w-[46ch] text-[13px] leading-6 text-muted-foreground">
        如仍有疑问，请回到 Telegram 联系群管理员。
      </p>
    </div>
  )
}

/** errorText 把 unknown 错误收敛成带文案的错误（保留服务端中文提示）。 */
// oxlint-disable-next-line react/only-export-components -- 与 InvalidState 同属「公开页的错误呈现」，拆文件反而绕。
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '请求失败，请刷新重试。'
}
