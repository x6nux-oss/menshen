// 查看类页面（v / apv）的第二道门槛：GET 只拿到警示与 5 分钟凭据，
// 用户确认后才 POST 换取内容。链接预览与扫描器只发 GET，过不了这一步。
import { Clock3, LockKeyhole, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Spinner } from '../components/ui'
import { Callout, SectionCard } from './ui'

export function GatePrompt({
  warn,
  ttlSeconds,
  loading,
  error,
  expired,
  onReveal,
  children,
}: {
  warn: string
  ttlSeconds: number
  loading: boolean
  error?: string
  expired?: boolean
  onReveal: () => void
  children?: ReactNode
}) {
  const minutes = Math.max(1, Math.round((ttlSeconds || 300) / 60))
  return (
    <div className="space-y-4">
      {warn && (
        <Callout tone="warning" icon={<TriangleAlert />} title="敏感内容">
          {warn}
        </Callout>
      )}
      {children}
      <SectionCard icon={<LockKeyhole />} title="确认后查看">
        <p className="text-[16px] leading-7">
          此链接只对持有者有效。点击后会读取本页内容，凭据在 {minutes} 分钟内有效。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={loading} onClick={onReveal}>
            {loading ? (
              <>
                <Spinner size={15} />
                正在读取…
              </>
            ) : (
              '查看内容'
            )}
          </Button>
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Clock3 aria-hidden className="size-3.5" />
            凭据过期后可原地重试
          </span>
        </div>
        {error && (
          <Callout
            tone={expired ? 'info' : 'danger'}
            icon={<TriangleAlert />}
            role="alert"
            title={expired ? '凭据已刷新' : '读取失败'}
          >
            <p>{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={loading}
              onClick={onReveal}
            >
              重试查看
            </Button>
          </Callout>
        )}
      </SectionCard>
    </div>
  )
}
