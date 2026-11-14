// 主题切换器：跟随系统 / 亮 / 暗 三态循环。
//
// 设计文档 §6 要求三个前端面共用同一套主题逻辑。Mini App 除外 —— 它的主题
// 由 Telegram 的 colorScheme 决定，用户不该在这里再覆盖一次。
//
// 三态而不是二态：`storedTheme() === null` 表示「跟随系统」，这是缺省状态。
// 二态开关一旦被点过就再也回不到跟随系统了（localStorage 里永远留着值）。
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import {
  applyThemeMode,
  resolveThemeMode,
  setStoredTheme,
  storedTheme,
  subscribeSystemTheme,
} from '../../lib/theme-mode'
import type { ThemeMode } from '../../lib/theme-mode'

/** 三态：跟随系统 → 亮 → 暗 → 跟随系统。 */
const NEXT: Record<string, ThemeMode | null> = {
  system: 'light',
  light: 'dark',
  dark: null,
}

const LABEL: Record<string, string> = {
  system: '主题：跟随系统',
  light: '主题：亮色',
  dark: '主题：暗色',
}

/** 当前状态：显式选择优先，否则 system。 */
function currentState(): string {
  return storedTheme() ?? 'system'
}

export interface ThemeToggleProps {
  className?: string
}

/**
 * ThemeToggle 是循环式的主题切换按钮（单按钮，点一次换一档）。
 *
 * 为什么不用下拉/分段：公开页与桌面面板的顶栏都很窄，一个 36px 的图标按钮
 * 比三个选项省地方，且「点一下换个样子」对三态足够直觉 —— 图标本身
 * 就是当前状态（显示器/太阳/月亮）。
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const [state, setState] = useState(currentState)

  // 跟随系统时，系统偏好变了要立刻反映到 <html>。
  useEffect(() => {
    if (state !== 'system') return
    return subscribeSystemTheme((mode) => applyThemeMode(mode))
  }, [state])

  const onClick = () => {
    const next = NEXT[state] ?? null
    setStoredTheme(next)
    setState(next ?? 'system')
    // 选「跟随系统」时立刻按系统值应用，不等下一次系统事件。
    applyThemeMode(next ?? resolveThemeMode())
  }

  const Icon = state === 'system' ? Monitor : state === 'dark' ? Moon : Sun

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={LABEL[state] ?? LABEL.system}
      title={LABEL[state] ?? LABEL.system}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none',
        'transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}
