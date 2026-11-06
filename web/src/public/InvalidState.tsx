// InvalidState 是链接无效 / 已失效 / 读取失败的统一占位。
export function InvalidState({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-card p-5 text-center text-card-foreground">
      <p className="text-[16px] leading-[1.7]">{message}</p>
    </div>
  )
}

/** errorText 把 unknown 错误收敛成带文案的错误（保留服务端中文提示）。 */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return '请求失败，请刷新重试。'
}
