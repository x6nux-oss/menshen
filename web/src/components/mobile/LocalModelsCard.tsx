// 本地视觉模型：主管理员一键下载并启用 OCR/NSFW，或分别启停、调整 NSFW 阈值。
// Telegram Mini App 与桌面面板共用同一张卡；下载中轮询状态。
import { useState } from 'react'
import { useLocalModels } from '../../api/hooks'
import { useLocalModelsMutation } from '../../api/mutations'
import type { LocalModelStatus } from '../../api/types'
import { useToast } from '../feedback'
import { Button, Input, Label, Spinner, Switch } from '../ui'
import { SectionCard } from './SectionCard'

export function LocalModelsCard() {
  const status = useLocalModels()
  const mut = useLocalModelsMutation()
  const toast = useToast()
  const data = status.data
  const busy = mut.isPending || data?.downloading === true

  if (status.isPending) {
    return (
      <SectionCard title="本地视觉模型">
        <div className="flex items-center gap-3 p-4">
          <Spinner size={18} />
          <p className="text-[13px] text-muted-foreground">正在读取本地模型状态…</p>
        </div>
      </SectionCard>
    )
  }

  if (status.isError || !data) {
    const message = status.error instanceof Error ? status.error.message : '加载失败'
    return (
      <SectionCard title="本地视觉模型">
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{message}</span>
            <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
              重试
            </Button>
          </div>
        </div>
      </SectionCard>
    )
  }

  function download() {
    mut.mutate(
      { action: 'download' },
      {
        onSuccess: () => toast('已开始下载；完成后会自动启用两个模型'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function toggle(model: LocalModelStatus, enabled: boolean) {
    mut.mutate(
      { action: 'configure', model: model.id, enabled },
      {
        onSuccess: () => toast(enabled ? '已启用' : '已停用'),
        onError: (err) => toast(err.message),
      },
    )
  }

  function saveThreshold(threshold: number) {
    mut.mutate(
      { action: 'configure', threshold },
      {
        onSuccess: () => toast('已保存阈值'),
        onError: (err) => toast(err.message),
      },
    )
  }

  const percent =
    data.total_bytes > 0
      ? Math.min(100, (data.downloaded_bytes / data.total_bytes) * 100)
      : 0

  return (
    <SectionCard title="本地视觉模型">
      <div className="p-4">
        <p className="text-[13px] leading-[1.7] text-muted-foreground">
          离线 OCR（PP-OCRv6 small）与 NSFW 分类（Marqo）。下载和启用仅主管理员可操作；
          已配置的远程模型仍作为失败回退。
        </p>

        {data.error !== '' && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
          >
            {data.error}
          </div>
        )}

        {data.downloading && (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-label="模型下载进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.total_bytes > 0 ? Math.round(percent) : undefined}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={
                  data.total_bytes > 0
                    ? 'h-full rounded-full bg-primary transition-[width]'
                    : 'h-full w-1/3 animate-pulse rounded-full bg-primary'
                }
                style={data.total_bytes > 0 ? { width: `${percent}%` } : undefined}
              />
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {formatBytes(data.downloaded_bytes)}
              {data.total_bytes > 0 ? ` / ${formatBytes(data.total_bytes)}` : ''}
            </p>
          </div>
        )}

        <div className="mt-3">
          {data.models.length === 0 && (
            <p className="text-[13px] text-muted-foreground">暂无本地模型清单。</p>
          )}
          {data.models.map((model) => (
            <div
              key={model.id}
              className="flex items-center gap-3 border-t border-border py-2 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{model.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {model.ready ? '已就绪' : '未下载'} · {formatBytes(model.size_bytes)}
                </p>
              </div>
              <Switch
                checked={model.enabled}
                disabled={busy || (!model.ready && !model.enabled)}
                onCheckedChange={(enabled) => toggle(model, enabled)}
                aria-label={`${model.enabled ? '停用' : '启用'} ${model.name}`}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={download}>
            {mut.isPending && <Spinner size={14} />}
            {data.error !== '' ? '重试下载' : '一键下载并启用'}
          </Button>
        </div>

        <ThresholdEditor
          key={data.nsfw_threshold}
          value={data.nsfw_threshold}
          disabled={busy}
          onSave={saveThreshold}
        />
      </div>
    </SectionCard>
  )
}

function ThresholdEditor({
  value,
  disabled,
  onSave,
}: {
  value: number
  disabled: boolean
  onSave: (threshold: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const parsed = Number(draft)
  const valid = /^\d+$/.test(draft.trim()) && parsed >= 1 && parsed <= 100

  return (
    <div className="mt-4 flex items-start gap-2">
      <div className="w-full max-w-[220px]">
        <Label htmlFor="localmodels-nsfw-threshold" className="mb-1 block">
          NSFW 阈值（%）
        </Label>
        <Input
          id="localmodels-nsfw-threshold"
          inputMode="numeric"
          min={1}
          max={100}
          value={draft}
          disabled={disabled}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="mt-1 text-[12px] leading-[1.6] text-muted-foreground">
          1-100；达到该概率才作为色情证据送判
        </p>
      </div>
      <Button variant="outline" disabled={disabled || !valid} onClick={() => onSave(parsed)}>
        保存阈值
      </Button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
