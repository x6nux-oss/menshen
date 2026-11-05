// 设置行：左 label + 可选 hint，右 value + ›，点击触发 onClick。
// 不传 onClick 时是纯展示行（无箭头、不可点）。
//
// props 与旧 `src/ui/SettingRow` **完全一致**（BotDetailPage 与 SettingsPage 在用），
// 只是把它从「旧 ListRow 的包装」改成新 ListRow 的包装 —— 注意新 ListRow 的
// 主/副行叫 `primary`/`secondary`，而本组件对外的叫法仍是 `label`/`hint`。
import type { ReactNode } from 'react'
import { ListRow } from './ListRow'

export interface SettingRowProps {
  label: ReactNode
  hint?: ReactNode
  value?: ReactNode
  onClick?: () => void
  disabled?: boolean
}

export function SettingRow({ label, hint, value, onClick, disabled = false }: SettingRowProps) {
  return (
    <ListRow
      primary={label}
      secondary={hint}
      value={value}
      chevron={onClick !== undefined}
      onClick={onClick}
      disabled={disabled}
    />
  )
}
