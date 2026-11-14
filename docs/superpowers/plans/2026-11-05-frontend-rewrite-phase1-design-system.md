# 前端重写 Phase 1：设计系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立新设计系统 —— oklch 语义 token、三层玻璃特效、shadcn 基础组件、移动端组件层、反馈层，并以一个「组件预览页」证明它们在三个面都能跑。**本阶段不迁移任何业务页面**（那是 Phase 2/3）。

**Architecture:** 新建 `web/src/components/` 目录树（shadcn 组件入仓库、玻璃层、移动层、反馈层），与现有 `web/src/ui/`（MUI）**并行共存**。现有页面继续用 `src/ui/`，Phase 2/3 才逐页迁到新组件层，全部迁完后删除 `src/ui/` 与 MUI 依赖。

**Tech Stack:** React 19 · Tailwind CSS 4.3 · shadcn/ui（Base UI 1.9）· sonner · class-variance-authority · clsx · tailwind-merge · lucide-react · Rsbuild 2.3

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（§3 技术选型 · §4 玻璃层设计 · §5 目录结构 · §10 Phase 1）

## Global Constraints

- **不删 MUI**：Phase 1 期间 MUI 与 Tailwind/shadcn 并存。不得改 `src/ui/`（MUI 组件）、`src/pages/`、`src/admin/`、`src/public/` 的任何现有文件 —— 那是 Phase 2/3 的工作。
- **不得改 Go 代码**、不得改 `internal/panel/webdist`、不得改 Phase 0 建立的 rsbuild 配置的承重部分（`distPath.root` / `cleanDistPath` / `assetPrefix` / `server.base` / 入口名 / `assets` 扁平布局）。
- **三层玻璃 + 三条回退**（设计文档 §4.2/§4.3）：Layer 1 基线毛玻璃（100% 设备）、Layer 2 噪点 + 镜面扫光（纯 CSS）、Layer 3 折射增强（`@supports` 才启用）。三条回退：`@supports not (backdrop-filter)`、`prefers-reduced-transparency`、`prefers-reduced-motion`。缺一条即缺陷。
- **折射只用于显式 opt-in**：`.glass--refract` 是显式类名，不设为默认（设计文档 §4.5 —— 列表与表格区域不得用折射）。
- **玻璃只用在「浮起」的元素上**（设计文档 §4.4）：顶栏/底栏/侧栏/弹层/统计卡用玻璃；**长列表行不用**（滚动时每帧重算模糊是移动端掉帧主因）。
- **移动端 `--glass-blur` 降到 12px**（桌面 20px），由媒体查询切换（设计文档 §4.6）。
- **无障碍**：所有可交互组件键盘可达；焦点可见（`focus-visible` 环）；`prefers-reduced-motion` 关掉动画。
- **测试门禁**：`npm run typecheck` / `npm run test` / `npm run lint` 必须全绿。现有 51 files / 339 tests 在 Phase 1 期间**必须继续全绿**（本阶段不碰它们依赖的 `src/ui/`）。
- **色彩对比度**：正文文字与背景 ≥4.5:1（AA）。token 值必须实测，不得凭感觉取值。
- **不得使用占位符实现**：所有组件必须真实可运行，无 TODO、无空壳函数、无假数据。

## 文件结构

| 路径 | 职责 |
|---|---|
| `web/src/styles/token.css` | oklch 语义 token（`:root` 亮色 + `.dark` 暗色两套） |
| `web/src/styles/index.css` | Tailwind 入口 + `@theme inline` 把 token 暴露成工具类 |
| `web/src/styles/glass.css` | 玻璃层契约（三层 + 三条回退） |
| `web/src/styles/glass-refract.css` | 折射增强（`@supports` 包裹） |
| `web/src/lib/utils.ts` | `cn()`（clsx + tailwind-merge） |
| `web/src/lib/theme-mode.ts` | 亮/暗模式解析与订阅（三个 app 共用，设计文档 §6） |
| `web/src/components/ui/*` | shadcn 组件（代码入仓库） |
| `web/src/components/glass/*` | GlassCard / GlassPanel / GlassSheet / GlassToolbar / GlassFilterDefs |
| `web/src/components/mobile/*` | ListRow / SectionCard / SwitchRow / Segmented / ActionSheet / SearchField / TabBar / TopBar |
| `web/src/components/feedback/*` | toast（sonner 封装）/ confirm / EmptyState / ErrorState / Skeletons / ErrorBoundary |
| `web/src/components/preview/` | 组件预览页（Phase 1 的验收载体，Phase 4 后删除） |
| `web/src/test/renderPage.tsx` | 测试装配（重建，同时支持新旧两套 Provider） |
| `web/src/test/setup.ts` | 测试环境（改动最小） |

**分层规则**（设计文档 §5）：`components/*` 只 import `lib/*`；`features/*`（Phase 2 才建）import `components/*` + `api/*` + `lib/*`。

---

## Task 1: 设计 token 与 Tailwind 管线

**Files:**
- Create: `web/src/styles/token.css`
- Create: `web/src/styles/index.css`
- Create: `web/src/lib/utils.ts`
- Create: `web/src/lib/theme-mode.ts`
- Modify: `web/tailwind.css`（改为 `@import` 新的 index.css）
- Test: `web/src/styles/token.test.ts`

**Interfaces:**
- Consumes: 无（本任务是 Phase 1 的根）
- Produces: CSS 变量 `--background` `--foreground` `--card` `--primary` `--border` `--ring` `--radius-*` 等（后续所有组件依赖）；`cn(...classes: ClassValue[]): string`；`resolveThemeMode()` / `subscribeThemeMode(cb)`

- [ ] **Step 1: 装依赖**

```bash
cd web
npm install class-variance-authority clsx tailwind-merge lucide-react sonner
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/styles/token.test.ts` —— 断言 token 文件里有亮暗两套定义、关键 token 齐全、且值都是 oklch：

```ts
// token 契约测试：读 CSS 源文件，断言亮暗两套与关键 token 齐全。
// jsdom 不解析 oklch，所以这里断的是**源文件结构**，真机效果由预览页人工验收。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokenCss = readFileSync(resolve(import.meta.dirname, 'token.css'), 'utf-8')

/** 必需的语义 token（设计文档 §3：颜色走 oklch 语义 token）。 */
const REQUIRED = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--muted', '--muted-foreground',
  '--primary', '--primary-foreground', '--destructive', '--success',
  '--warning', '--border', '--input', '--ring',
]

/** 玻璃层需要的 token（设计文档 §4.3 的 CSS 契约）。 */
const GLASS = [
  '--glass-bg', '--glass-border', '--glass-highlight', '--glass-shade',
  '--glass-shadow', '--glass-blur', '--glass-saturate',
  '--glass-noise', '--glass-noise-opacity', '--glass-sheen',
]

describe('设计 token', () => {
  it('亮色定义在 :root', () => {
    expect(tokenCss).toMatch(/:root\s*\{/)
  })

  it('暗色定义在 .dark', () => {
    expect(tokenCss).toMatch(/\.dark\s*\{/)
  })

  it.each([...REQUIRED, ...GLASS])('%s 在亮暗中都有定义', (name) => {
    const hits = tokenCss.match(new RegExp(`${name}:`, 'g')) ?? []
    expect(hits.length, `${name} 应定义两次（亮+暗）`).toBeGreaterThanOrEqual(2)
  })

  it('颜色值用 oklch', () => {
    expect(tokenCss).toMatch(/--background:\s*oklch\(/)
    expect(tokenCss).toMatch(/--primary:\s*oklch\(/)
  })

  it('圆角 token 齐全', () => {
    for (const r of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl']) {
      expect(tokenCss).toContain(`${r}:`)
    }
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd web && npx vitest run src/styles/token.test.ts
```

Expected: FAIL —— `ENOENT: no such file or directory, open '.../styles/token.css'`

- [ ] **Step 4: 写 token.css**

创建 `web/src/styles/token.css`。值从 new-api（`web/src/styles/theme.css`，见研究快照附录 A）借鉴其 oklch 分层，主色按本项目品牌（蓝）调整。**注意 `--glass-noise` 是一个 SVG data-URI**（`feTurbulence` 生成的纹理，Layer 2 用）：

```css
/*
 * 门神设计 token。两层结构：原始值在 :root 与 .dark，语义名供组件使用。
 * 颜色一律 oklch（感知均匀，明暗两套的手工调色更可预测）。
 * 亮暗由 .dark 类切换（设计文档 §6：Mini App 由 Telegram colorScheme 决定）。
 */

:root {
  /* ---- 圆角（设计文档 §4.3 的 --radius-lg 由玻璃层引用）---- */
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.875rem;
  --radius-xl: 1.25rem;

  /* ---- 基础色 ---- */
  --background: oklch(0.985 0.003 250);
  --foreground: oklch(0.205 0.015 255);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.205 0.015 255);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.205 0.015 255);
  --muted: oklch(0.965 0.005 250);
  --muted-foreground: oklch(0.5 0.015 255);
  --accent: oklch(0.955 0.012 250);
  --accent-foreground: oklch(0.205 0.015 255);

  /* ---- 品牌与语义色 ---- */
  --primary: oklch(0.55 0.185 258);
  --primary-foreground: oklch(0.99 0.005 250);
  --destructive: oklch(0.58 0.21 27);
  --destructive-foreground: oklch(0.99 0.005 250);
  --success: oklch(0.6 0.15 155);
  --success-foreground: oklch(0.99 0.005 250);
  --warning: oklch(0.7 0.16 75);
  --warning-foreground: oklch(0.22 0.02 75);

  /* ---- 线 ---- */
  --border: oklch(0.9 0.008 255);
  --input: oklch(0.9 0.008 255);
  --ring: oklch(0.55 0.185 258);

  /* ---- 玻璃层（§4.3 契约）---- */
  --glass-bg: oklch(1 0 0 / 62%);
  --glass-border: oklch(1 0 0 / 55%);
  --glass-highlight: oklch(1 0 0 / 70%);
  --glass-shade: oklch(0.5 0.01 255 / 8%);
  --glass-shadow: oklch(0.3 0.02 255 / 12%);
  --glass-blur: 20px;
  --glass-saturate: 180%;
  --glass-noise-opacity: 0.03;
  --glass-sheen: oklch(1 0 0 / 35%);
  /* Layer 2 噪点纹理：feTurbulence fractalNoise 平铺（SVG data-URI） */
  --glass-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}

.dark {
  color-scheme: dark;

  --background: oklch(0.185 0.012 255);
  --foreground: oklch(0.955 0.005 250);
  --card: oklch(0.235 0.014 255);
  --card-foreground: oklch(0.955 0.005 250);
  --popover: oklch(0.26 0.014 255);
  --popover-foreground: oklch(0.955 0.005 250);
  --muted: oklch(0.28 0.012 255);
  --muted-foreground: oklch(0.72 0.012 250);
  --accent: oklch(0.3 0.018 255);
  --accent-foreground: oklch(0.955 0.005 250);

  --primary: oklch(0.68 0.16 258);
  --primary-foreground: oklch(0.16 0.015 255);
  --destructive: oklch(0.68 0.19 25);
  --destructive-foreground: oklch(0.16 0.015 255);
  --success: oklch(0.7 0.15 155);
  --success-foreground: oklch(0.16 0.015 255);
  --warning: oklch(0.78 0.15 78);
  --warning-foreground: oklch(0.18 0.02 78);

  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 16%);
  --ring: oklch(0.68 0.16 258);

  /* 暗色玻璃：底色更透、高光更弱（浅色底打白光会过曝） */
  --glass-bg: oklch(0.3 0.015 255 / 55%);
  --glass-border: oklch(1 0 0 / 14%);
  --glass-highlight: oklch(1 0 0 / 20%);
  --glass-shade: oklch(0 0 0 / 20%);
  --glass-shadow: oklch(0 0 0 / 40%);
  --glass-sheen: oklch(1 0 0 / 12%);
}

/* 移动端降模糊半径（§4.6：每帧重算模糊是移动端掉帧主因） */
@media (max-width: 640px) {
  :root,
  .dark {
    --glass-blur: 12px;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd web && npx vitest run src/styles/token.test.ts
```

Expected: PASS（9 个断言）

- [ ] **Step 6: 写 Tailwind 入口**

创建 `web/src/styles/index.css`（`@theme inline` 把 token 暴露成 Tailwind 工具类，写法照 new-api）：

```css
/* Tailwind 入口：把语义 token 映射成工具类（bg-background / text-foreground / rounded-lg …）。
   用 @theme inline 而非 @theme：变量值保持 var() 引用，暗色切换时工具类跟着变。 */
@import "tailwindcss";
@import "./token.css";
@import "./glass.css";
@import "./glass-refract.css";

/* 暗色变体：Tailwind 4 需要显式声明基于 .dark 类（而非媒体查询），
   因为 Mini App 的暗色由 Telegram colorScheme 决定，与系统偏好无关。 */
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-xl: var(--radius-xl);
}

/* 全局基线：正文可读、字体跟随系统、暗色下的原生控件配色 */
@layer base {
  * {
    border-color: var(--border);
  }
  body {
    background-color: var(--background);
    color: var(--foreground);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 7: 把 tailwind.css 指向新入口**

`web/tailwind.css` 的内容改为（保持 rsbuild 配置里的 import 路径不变，避免动 Phase 0 的承重配置）：

```css
/* Phase 0 的 rsbuild 配置 import 本文件；真正的入口在 styles/index.css。 */
@import "./src/styles/index.css";
```

- [ ] **Step 8: 写 cn() 工具**

创建 `web/src/lib/utils.ts`：

```ts
import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * cn 合并 className：clsx 处理条件类，tailwind-merge 消解冲突
 * （后面的同类工具类赢，如 cn('p-2', 'p-4') → 'p-4'）。
 * shadcn 组件的标准写法，不要用字符串拼接替代。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 9: 写 theme-mode.ts**

创建 `web/src/lib/theme-mode.ts`（三个 app 共用，设计文档 §6）：

```ts
// 亮/暗模式解析与订阅。三个前端面共用：
//   - Mini App：由 Telegram colorScheme 决定（App 把结果写成 .dark 类）
//   - 桌面面板 / 公开页：用户手动选择存 localStorage，缺省跟随系统
// 本模块只管「解析与订阅」，不直接操作 DOM（由各 app 的入口应用结果）。
export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'menshen-theme'

/** systemTheme 读系统偏好；无 matchMedia（测试）时按亮色。 */
export function systemTheme(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** storedTheme 读用户显式选择；没存过或值非法时返回 null（= 跟随系统）。 */
export function storedTheme(): ThemeMode | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

/** resolveThemeMode 按优先级解析：用户显式选择 > 系统偏好。 */
export function resolveThemeMode(): ThemeMode {
  return storedTheme() ?? systemTheme()
}

/** setStoredTheme 持久化用户选择；传 null 表示恢复跟随系统。 */
export function setStoredTheme(mode: ThemeMode | null): void {
  if (typeof localStorage === 'undefined') return
  if (mode === null) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, mode)
}

/**
 * subscribeSystemTheme 订阅系统偏好变化。返回值变化时回调；
 * 用户已显式选择时回调值仍会给出系统值，由调用方决定是否采用。
 * 无 matchMedia 时返回空取消函数。
 */
export function subscribeSystemTheme(cb: (mode: ThemeMode) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light')
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

/**
 * applyThemeMode 把模式写进 <html> 的 class 与 color-scheme。
 * 这是唯一直接操作 DOM 的函数，各 app 入口调用。
 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}
```

- [ ] **Step 10: 跑全套验证**

```bash
cd web && npm run typecheck && npx vitest run src/styles/token.test.ts && npm run lint
```

Expected: 三条都通过。

- [ ] **Step 11: Commit**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/package.json web/package-lock.json web/tailwind.css web/src/styles/ web/src/lib/utils.ts web/src/lib/theme-mode.ts
git commit -m "web: 设计 token 与 Tailwind 管线落地（Phase 1）"
```

---

## Task 2: 玻璃层

**Files:**
- Create: `web/src/styles/glass.css`
- Create: `web/src/styles/glass-refract.css`
- Create: `web/src/components/glass/index.ts`
- Create: `web/src/components/glass/Glass.tsx`
- Create: `web/src/components/glass/GlassFilterDefs.tsx`
- Test: `web/src/components/glass/Glass.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `cn()` 与玻璃 token（`--glass-*`）
- Produces: `Glass`（基础玻璃容器，props: `as` `refract` `sheen` `className` `children`）· `GlassCard` · `GlassPanel` · `GlassSheet` · `GlassToolbar` · `GlassFilterDefs`（渲染 SVG 折射滤镜定义，全页一次）

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/glass/Glass.test.tsx`：

```tsx
// 玻璃层的类名契约测试。jsdom 不执行 backdrop-filter，所以这里断的是
// **类名与 DOM 结构**（真机观感由预览页人工验收）—— 这是设计文档 §4 的可测部分。
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Glass, GlassCard, GlassFilterDefs, GlassPanel, GlassToolbar } from './index'

describe('Glass 玻璃容器', () => {
  it('默认带 .glass 类（Layer 1 基线毛玻璃）', () => {
    render(<Glass data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').className).toContain('glass')
  })

  it('refract 为真时加 .glass--refract（Layer 3 显式 opt-in）', () => {
    render(<Glass data-testid="g" refract>内容</Glass>)
    const el = screen.getByTestId('g')
    expect(el.className).toContain('glass--refract')
  })

  it('默认不带 refract —— 折射必须是显式 opt-in（§4.5）', () => {
    render(<Glass data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').className).not.toContain('glass--refract')
  })

  it('sheen 为真时加 data-sheen="in"（触发镜面扫光）', () => {
    render(<Glass data-testid="g" sheen>内容</Glass>)
    expect(screen.getByTestId('g').getAttribute('data-sheen')).toBe('in')
  })

  it('as 可换元素类型', () => {
    render(<Glass as="section" data-testid="g">内容</Glass>)
    expect(screen.getByTestId('g').tagName).toBe('SECTION')
  })
})

describe('玻璃预设', () => {
  it('GlassCard 是 .glass 且圆角 lg', () => {
    render(<GlassCard data-testid="c">内容</GlassCard>)
    const el = screen.getByTestId('c')
    expect(el.className).toContain('glass')
    expect(el.className).toContain('rounded-lg')
  })

  it('GlassPanel 是 .glass 且圆角 xl（侧栏/大面板）', () => {
    render(<GlassPanel data-testid="p">内容</GlassPanel>)
    expect(screen.getByTestId('p').className).toContain('rounded-xl')
  })

  it('GlassToolbar 是 .glass 且带底部描边', () => {
    render(<GlassToolbar data-testid="t">内容</GlassToolbar>)
    const el = screen.getByTestId('t')
    expect(el.className).toContain('glass')
    expect(el.className).toContain('border-b')
  })

  it('预设透传 refract', () => {
    render(<GlassCard data-testid="c" refract>内容</GlassCard>)
    expect(screen.getByTestId('c').className).toContain('glass--refract')
  })
})

describe('GlassFilterDefs', () => {
  it('渲染一个隐藏的 SVG，含折射滤镜与噪点滤镜定义', () => {
    const { container } = render(<GlassFilterDefs />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('#menshen-glass-refract')).not.toBeNull()
  })

  it('只渲染一次即可复用（幂等渲染不报错）', () => {
    render(<><GlassFilterDefs /><GlassFilterDefs /></>)
    expect(document.querySelectorAll('#menshen-glass-refract').length).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/components/glass/Glass.test.tsx
```

Expected: FAIL —— `Failed to resolve import "./index"`

- [ ] **Step 3: 写 glass.css（三层 + 三条回退）**

创建 `web/src/styles/glass.css`：

```css
/*
 * 门神玻璃层（设计文档 §4.3 契约）。三层渐进：
 *   Layer 1 基线毛玻璃 —— 100% 设备，所有玻璃面都有
 *   Layer 2 噪点 + 镜面扫光 —— 纯 CSS，100% 设备
 *   Layer 3 边缘折射 —— 见 glass-refract.css，@supports 才启用
 * 三条回退缺一不可：@supports not / prefers-reduced-transparency / prefers-reduced-motion。
 */

.glass {
  position: relative;
  isolation: isolate;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    inset 0 -1px 0 var(--glass-shade),
    0 8px 32px var(--glass-shadow);
}

/* Layer 2a：噪点纹理。打破大面积纯色的塑料感。 */
.glass::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: var(--glass-noise);
  opacity: var(--glass-noise-opacity);
  mix-blend-mode: overlay;
  border-radius: inherit;
  z-index: -1;
}

/* Layer 2b：镜面扫光。斜向渐变，默认隐藏，hover 或 data-sheen=in 时显现。 */
.glass::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    115deg,
    transparent 30%,
    var(--glass-sheen) 46%,
    transparent 62%
  );
  opacity: 0;
  transition: opacity 0.4s ease;
  border-radius: inherit;
  z-index: -1;
}

.glass:hover::after,
.glass[data-sheen='in']::after {
  opacity: 1;
}

/* 回退 1：浏览器不支持 backdrop-filter —— 退成不透明卡片，不做假模糊 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass {
    background: var(--card);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/* 回退 2：用户要求降低透明度 —— 同样退成不透明，并去掉扫光 */
@media (prefers-reduced-transparency: reduce) {
  .glass {
    background: var(--card);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .glass::after {
    display: none;
  }
}

/* 回退 3：用户要求减少动效 —— 关掉扫光的过渡 */
@media (prefers-reduced-motion: reduce) {
  .glass::after {
    transition: none;
    opacity: 0;
  }
}
```

- [ ] **Step 4: 写 glass-refract.css（Layer 3）**

创建 `web/src/styles/glass-refract.css`：

```css
/*
 * Layer 3：边缘折射增强。**只在浏览器真的支持 `backdrop-filter: url(#…)` 时生效**
 * —— 实测 iOS Safari 拿不到（WebKit 长期未实现该形式，见设计文档附录 B.1），
 * 所以它只能是增强层，不能是基线。
 *
 * 用法：在 .glass 元素上加 .glass--refract（显式 opt-in，§4.5：列表与表格不用）。
 */
@supports (backdrop-filter: url(#menshen-glass-refract)) {
  .glass--refract {
    backdrop-filter: url(#menshen-glass-refract) blur(var(--glass-blur))
      saturate(var(--glass-saturate));
    -webkit-backdrop-filter: url(#menshen-glass-refract) blur(var(--glass-blur))
      saturate(var(--glass-saturate));
  }
}

/* 与回退 2 一致：降低透明度时连折射也去掉 */
@media (prefers-reduced-transparency: reduce) {
  .glass--refract {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

- [ ] **Step 5: 写 GlassFilterDefs.tsx**

创建 `web/src/components/glass/GlassFilterDefs.tsx`：

```tsx
/**
 * 折射滤镜的 SVG 定义，每个页面渲染一次（放在外壳根部）。
 * 用 feDisplacementMap 对背景做边缘位移 —— 这是「液态玻璃」折射感的来源。
 * 不支持该特性的浏览器会忽略引用它的 backdrop-filter，自动退回 Layer 1+2。
 */
export function GlassFilterDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        <filter id="menshen-glass-refract" x="-20%" y="-20%" width="140%" height="140%">
          {/* 低频噪声当作位移图：边缘处梯度大 → 位移明显，中心平缓 → 几乎不变形 */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.008"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="42"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
```

- [ ] **Step 6: 写 Glass.tsx**

创建 `web/src/components/glass/Glass.tsx`：

```tsx
import type { ElementType, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface GlassProps {
  /** 渲染的元素类型；默认 div（玻璃是容器语义）。 */
  as?: ElementType
  /**
   * 启用 Layer 3 边缘折射（设计文档 §4.5）。**显式 opt-in**：
   * 只用在静态装饰元素（概览大卡、公开页顶部、空状态），
   * 列表与表格区域不要开 —— 滚动时每帧重算位移会掉帧。
   */
  refract?: boolean
  /** 立即显示镜面扫光（默认只在 hover 时显现）。用于入场动效。 */
  sheen?: boolean
  className?: string
  children?: ReactNode
  [key: `data-${string}`]: string | undefined
}

/**
 * 玻璃容器。三层渐进的第一步（设计文档 §4.2）：
 * 本组件给出 Layer 1（毛玻璃底 + 描边 + 内外高光）与 Layer 2（噪点/扫光，走 CSS 伪元素）。
 * Layer 3 由 `refract` 开关；支持它的浏览器才渲染出折射。
 */
export function Glass({ as, refract, sheen, className, children, ...rest }: GlassProps) {
  const Tag = (as ?? 'div') as ElementType
  return (
    <Tag
      className={cn('glass', refract && 'glass--refract', className)}
      data-sheen={sheen ? 'in' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}
```

- [ ] **Step 7: 写玻璃预设**

把以下内容追加到 `web/src/components/glass/Glass.tsx` 末尾：

```tsx
/** GlassCard：内容卡片形态（圆角 lg，内边距 4）。列表外的段落卡片用这个。 */
export function GlassCard({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-lg p-4', className)} {...rest} />
}

/** GlassPanel：大面板形态（圆角 xl）。侧栏、抽屉、概览大卡用这个。 */
export function GlassPanel({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-xl p-5', className)} {...rest} />
}

/** GlassSheet：底部弹层形态（只上圆角）。配合 ActionSheet 使用。 */
export function GlassSheet({ className, ...rest }: GlassProps) {
  return <Glass className={cn('rounded-t-2xl px-4 pt-3 pb-6', className)} {...rest} />
}

/** GlassToolbar：顶栏/工具栏形态（只下圆角，底部描边）。内容从下面滚过时用它。 */
export function GlassToolbar({ className, ...rest }: GlassProps) {
  return (
    <Glass
      className={cn('rounded-b-xl border-b border-glass-border px-4 py-2.5', className)}
      {...rest}
    />
  )
}
```

**注意**：`border-glass-border` 这个工具类需要 token 暴露。Task 1 的 `@theme inline` 没映射它 —— 在 Task 1 的 `index.css` 里补一行 `--color-glass-border: var(--glass-border);`（本步骤一并加上）。

- [ ] **Step 8: 写导出入口**

创建 `web/src/components/glass/index.ts`：

```ts
export { Glass, GlassCard, GlassPanel, GlassSheet, GlassToolbar } from './Glass'
export type { GlassProps } from './Glass'
export { GlassFilterDefs } from './GlassFilterDefs'
```

- [ ] **Step 9: 跑测试确认通过**

```bash
cd web && npx vitest run src/components/glass/Glass.test.tsx
```

Expected: PASS（11 个断言）

- [ ] **Step 10: 确认 Tailwind 能编译到玻璃类**

```bash
cd web && npm run build 2>&1 | tail -5 && grep -c "glass--refract\|backdrop-filter" ../internal/panel/webdist/assets/*.css 2>/dev/null | head -3
```

Expected: 构建成功；CSS 产物里能搜到 `backdrop-filter`（Tailwind 未 purge 掉，因为 `tailwind.css` 被 import 进产物）。

**若 CSS 产物里搜不到 `glass` 类**：说明 Tailwind 没扫到 `components/` 目录。检查 `tailwind.css` 的 `@source` 指令是否需要显式声明扫描路径（Tailwind 4 默认扫项目根，必要时加 `@source "../components";`）。

- [ ] **Step 11: Commit**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/styles/glass.css web/src/styles/glass-refract.css web/src/components/glass/ web/src/styles/index.css
git commit -m "web: 三层玻璃特效与玻璃容器组件（Phase 1）"
```

- [ ] **Step 4: 写 Badge**

创建 `web/src/components/ui/badge.tsx`：

```tsx
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * 语义徽标。**tone 必须与 `src/lib/status.ts` 的 StatusTone 完全一致**
 * （ok/no/warn/neutral）—— 那是跨阶段契约：`lib/` 产出的 tone 直接喂给本组件，
 * Phase 2/3 迁移时不该改动任何调用点的取值。
 * 底色用语义色的 16% 淡底，文字色在亮暗中分别取值保证 ≥4.5:1 对比度（沿用旧 Badge 的实测值）。
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        ok: 'bg-success/16 text-[#067A3E] dark:text-[#4ADE80]',
        no: 'bg-destructive/16 text-[#C62828] dark:text-[#FF8A80]',
        warn: 'bg-warning/16 text-[#7A5B00] dark:text-[#FFD54F]',
        neutral: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string
  children: ReactNode
}

export function Badge({ className, tone, children }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>
}

export { badgeVariants }
```

**注意**：`bg-success/16` 这类写法要求 Tailwind 4 支持任意透明度（`/16`）。若不生效，改用 `color-mix(in oklch, var(--success) 16%, transparent)` 作为 inline style。

- [ ] **Step 5: 写其余组件**

逐个创建以下文件。**每个都是薄封装**：样式用 Tailwind 工具类（引用 Task 1 的 token），交互原语用 Base UI 的对应组件。命名与 props 遵循 shadcn 惯例。

| 文件 | 导出 | 关键 props / 契约 |
|---|---|---|
| `input.tsx` | `Input` | 原生 input 属性；`aria-invalid` 时描边转 destructive |
| `textarea.tsx` | `Textarea` | 同上，多行 |
| `label.tsx` | `Label` | 原生 label；点 Label 聚焦关联控件 |
| `checkbox.tsx` | `Checkbox` | Base UI Checkbox；props: `checked` `onCheckedChange` `disabled` |
| `switch.tsx` | `Switch` | Base UI Switch；props: `checked` `onCheckedChange` `disabled` `aria-label`（无可见标签时必需） |
| `card.tsx` | `Card` `CardHeader` `CardTitle` `CardDescription` `CardContent` `CardFooter` | 纯样式容器（不透明卡片，**不用玻璃** —— 玻璃只给浮起元素，见 §4.4） |
| `separator.tsx` | `Separator` | props: `orientation`（horizontal/vertical） |
| `skeleton.tsx` | `Skeleton` | props: `className`；`animate-pulse` 要在 reduced-motion 下停 |
| `select.tsx` | `Select` `SelectTrigger` `SelectValue` `SelectContent` `SelectItem` | Base UI Select；`value`/`onValueChange` |
| `dialog.tsx` | `Dialog` `DialogTrigger` `DialogContent` `DialogHeader` `DialogTitle` `DialogDescription` `DialogFooter` `DialogClose` | **DialogContent 用 `glass` 底**（弹层是浮起元素） |
| `sheet.tsx` | `Sheet` `SheetTrigger` `SheetContent` `SheetHeader` `SheetTitle` `SheetFooter` `SheetClose` | props 加 `side`（top/right/bottom/left）；**用 `glass` 底** |
| `alert-dialog.tsx` | `AlertDialog` 族 | 危险操作确认；`AlertDialogAction` / `AlertDialogCancel` |
| `dropdown-menu.tsx` | `DropdownMenu` 族 | Base UI Menu |
| `tooltip.tsx` | `TooltipProvider` `Tooltip` `TooltipTrigger` `TooltipContent` | |
| `tabs.tsx` | `Tabs` `TabsList` `TabsTrigger` `TabsContent` | `value`/`onValueChange` |
| `table.tsx` | `Table` `TableHeader` `TableBody` `TableRow` `TableHead` `TableCell` `TableCaption` | 纯样式；数据逻辑在 Task 5 |
| `scroll-area.tsx` | `ScrollArea` | props: `className` |
| `avatar.tsx` | `Avatar` `AvatarFallback` | 用户标识 |

**无障碍要求（每条都要做）**：Dialog/Sheet/AlertDialog 必须有标题（`DialogTitle`/`SheetTitle`），否则屏幕阅读器读不出；触发按钮要有可读文本或 `aria-label`；焦点环不可去掉（`focus-visible:ring-2`）。

- [ ] **Step 6: 写导出入口**

创建 `web/src/components/ui/index.ts`，把上表所有导出集中 re-export。

- [ ] **Step 7: 跑测试确认通过**

```bash
cd web && npx vitest run src/components/ui/ui.test.tsx && npm run typecheck
```

Expected: PASS + typecheck 干净。

- [ ] **Step 8: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/components/ui/
git commit -m "web: shadcn 基础组件层（Phase 1）"
```

---

## Task 3: shadcn 基础组件（桌面端用）

**Files:**
- Create: `web/src/components/ui/button.tsx` · `badge.tsx` · `input.tsx` · `textarea.tsx` · `label.tsx` · `select.tsx` · `checkbox.tsx` · `switch.tsx` · `card.tsx` · `dialog.tsx` · `sheet.tsx` · `alert-dialog.tsx` · `dropdown-menu.tsx` · `tooltip.tsx` · `tabs.tsx` · `table.tsx` · `separator.tsx` · `skeleton.tsx` · `scroll-area.tsx` · `avatar.tsx` · `index.ts`
- Test: `web/src/components/ui/ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `cn()` 与 token；Task 2 的玻璃类（`sheet`/`dialog` 用 `glass` 底）
- Produces: `Button`（`variant`: default/outline/secondary/ghost/destructive/link；`size`: sm/default/lg/icon）· `Badge`（`tone`: default/ok/no/warn/neutral —— **必须与现有 `src/ui/Badge` 的 `BadgeTone` 语义一致**）· `Input` · `Textarea` · `Label` · `Select` · `Checkbox` · `Switch` · `Card` 族 · `Dialog` 族 · `Sheet` 族 · `AlertDialog` 族 · `DropdownMenu` 族 · `Tooltip` · `Tabs` 族 · `Table` 族 · `Separator` · `Skeleton` · `ScrollArea` · `Avatar`

**实现方式**：本任务**手写**这些组件的适配层（`components/ui/` 下每个文件是一个薄封装，样式用 Tailwind + cva，交互原语用 Base UI）。**不要用 `npx shadcn add`** —— 它需要交互式确认、会改 `components.json` 与建 `src/lib/utils`，与本项目结构（`web/` 子目录、rsbuild 而非 Next.js）不匹配。手写能保证结构受控、注释符合本项目风格。

**范围裁剪（YAGNI）**：只做本项目实际会用到的组件。Phase 2/3 的页面需要什么就做什么，不要预先铺全套。上表已按现有页面（`src/pages/` + `src/admin/views/`）实际用到的 MUI 组件筛过。

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/ui/ui.test.tsx`：

```tsx
// shadcn 组件的类名/行为契约测试（jsdom 不跑真实样式，断的是结构契约）。
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Switch } from './index'

describe('Button', () => {
  it('默认渲染 button 元素且可点击', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('variant 与 size 反映在类名上', () => {
    render(<Button variant="destructive" size="sm" data-testid="b">删除</Button>)
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('destructive')
    expect(cls).toMatch(/h-8|text-\[0\.8rem\]/)
  })

  it('disabled 时不可点击', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>保存</Button>)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('asChild 时渲染子元素而非 button（用于包 <a>）', () => {
    render(<Button asChild><a href="/x" data-testid="l">链接</a></Button>)
    expect(screen.getByTestId('l').tagName).toBe('A')
  })
})

describe('Badge', () => {
  it.each([
    ['ok', 'ok'],
    ['no', 'no'],
    ['warn', 'warn'],
    ['neutral', 'neutral'],
  ])('tone=%s 反映在类名上', (tone, cls) => {
    render(<Badge tone={tone as never} data-testid="b">徽标</Badge>)
    expect(screen.getByTestId('b').className).toContain(cls)
  })

  it('不传 tone 时是 neutral', () => {
    render(<Badge data-testid="b">徽标</Badge>)
    expect(screen.getByTestId('b').className).toContain('neutral')
  })
})

describe('Input', () => {
  it('受控值可输入', async () => {
    render(<Input placeholder="名称" />)
    await userEvent.type(screen.getByPlaceholderText('名称'), 'abc')
    expect(screen.getByPlaceholderText('名称')).toHaveValue('abc')
  })

  it('aria-invalid 时描边转 destructive（无障碍）', () => {
    render(<Input aria-invalid data-testid="i" />)
    const el = screen.getByTestId('i')
    expect(el).toHaveAttribute('aria-invalid', 'true')
    expect(el.className).toContain('destructive')
  })
})

describe('Switch', () => {
  it('切换触发 onCheckedChange', async () => {
    const onChange = vi.fn()
    render(<Switch onCheckedChange={onChange} aria-label="启用" />)
    await userEvent.click(screen.getByRole('switch', { name: '启用' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Card', () => {
  it('组合渲染标题与内容', () => {
    render(
      <Card>
        <CardHeader><CardTitle>标题</CardTitle></CardHeader>
        <CardContent>内容</CardContent>
      </Card>,
    )
    expect(screen.getByText('标题')).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/components/ui/ui.test.tsx
```

Expected: FAIL —— `Failed to resolve import "./index"`

- [ ] **Step 3: 写 Button**

创建 `web/src/components/ui/button.tsx`：

```tsx
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

/**
 * 按钮样式变体。触控高度：默认 h-9（36px）；移动端由调用方用 size="lg"（h-11 = 44px）
 * 满足 iOS HIG 的 44px 触控目标。
 * focus-visible 环是硬要求（无障碍）；disabled 用 opacity + pointer-events。
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-card hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-muted text-foreground hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-2.5 text-[0.8rem]',
        default: 'h-9 px-3',
        lg: 'h-11 px-4 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends Omit<ComponentProps<typeof BaseButton>, 'className'>,
    VariantProps<typeof buttonVariants> {
  className?: string
  /** 把样式与行为套到子元素上（包 <a> 做链接按钮）。 */
  asChild?: boolean
}

/**
 * 按钮。交互原语用 Base UI Button（键盘、焦点、disabled 语义），
 * 样式用 cva。
 */
export function Button({ className, variant, size, asChild, children, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <BaseButton
        render={children as never}
        className={cn(buttonVariants({ variant, size }), className)}
      />
    )
  }
  return (
    <BaseButton className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </BaseButton>
  )
}

export { buttonVariants }
```

---

## Task 4: 移动端组件层

**Files:**
- Create: `web/src/components/mobile/ListRow.tsx` · `SectionCard.tsx` · `SwitchRow.tsx` · `Segmented.tsx` · `ActionSheet.tsx` · `SearchField.tsx` · `TabBar.tsx` · `TopBar.tsx` · `index.ts`
- Test: `web/src/components/mobile/mobile.test.tsx`

**Interfaces:**
- Consumes: Task 1 token/cn；Task 2 玻璃；Task 3 的 `Switch`/`Badge`/`Input`
- Produces: 与现有 `src/ui/` 同名同语义的组件（**props 尽量保持兼容**，Phase 2/3 迁移时改动最小）：
  - `ListRow` —— `primary` `secondary?` `secondaryMono?` `badge?` `value?` `trailing?` `chevron?` `onClick?` `disabled?`
  - `SectionCard` —— `title?` `footer?` `children`
  - `SwitchRow` —— `label` `checked` `onChange(checked: boolean)` `disabled?`
  - `Segmented` —— `value` `onChange(value: string)` `options: {value,label}[]` `ariaLabel?`
  - `SearchField` —— `value` `onChange(value: string)` `placeholder?`
  - `ActionSheet` —— `ActionSheetProvider` + `useConfirm(): (options: ConfirmOptions) => Promise<boolean>`（**保持现有 Promise 式 API**；`ConfirmOptions` 含 `title` `description?` `confirmText?` `cancelText?` `destructive?`）
  - `TabBar` —— `tabs: {key,label,icon}[]` `active` `onChange(key)`
  - `TopBar` —— `title` `subtitle?` `onBack?` `actions?`

**注意 44px 触控目标**：`ListRow` 行高 ≥52px、`SwitchRow` 行高 ≥52px、`TabBar` 项高 ≥56px（含安全区）。这是移动端可点性的底线。

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/mobile/mobile.test.tsx`，覆盖每个组件的核心行为与无障碍：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ActionSheetProvider, ListRow, SearchField, SectionCard, Segmented,
  SwitchRow, TabBar, TopBar, useConfirm,
} from './index'

describe('ListRow', () => {
  it('有 onClick 时整行可点且可键盘激活', async () => {
    const onClick = vi.fn()
    render(<ListRow primary="群 123" onClick={onClick} />)
    const row = screen.getByRole('button')
    await userEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('渲染副行、徽标、值、箭头', () => {
    render(<ListRow primary="主" secondary="副" badge={<span>徽</span>} value="值" chevron />)
    expect(screen.getByText('副')).toBeInTheDocument()
    expect(screen.getByText('徽')).toBeInTheDocument()
    expect(screen.getByText('值')).toBeInTheDocument()
  })

  it('disabled 时不触发 onClick', async () => {
    const onClick = vi.fn()
    render(<ListRow primary="x" onClick={onClick} disabled />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('SwitchRow', () => {
  it('切换回调带新值', async () => {
    const onChange = vi.fn()
    render(<SwitchRow label="启用判定" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Segmented', () => {
  it('点击选项回调 value', async () => {
    const onChange = vi.fn()
    render(<Segmented value="a" onChange={onChange}
      options={[{ value: 'a', label: '判定' }, { value: 'b', label: '申诉' }]} />)
    await userEvent.click(screen.getByRole('button', { name: '申诉' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('当前项标 aria-pressed（无障碍）', () => {
    render(<Segmented value="a" onChange={() => {}}
      options={[{ value: 'a', label: '判定' }, { value: 'b', label: '申诉' }]} />)
    expect(screen.getByRole('button', { name: '判定' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SearchField', () => {
  it('输入触发 onChange', async () => {
    const onChange = vi.fn()
    render(<SearchField value="" onChange={onChange} placeholder="搜索" />)
    await userEvent.type(screen.getByPlaceholderText('搜索'), 'ab')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('TabBar', () => {
  it('点击 tab 回调 key', async () => {
    const onChange = vi.fn()
    render(<TabBar active="overview" onChange={onChange}
      tabs={[{ key: 'overview', label: '概览' }, { key: 'bots', label: '机器人' }]} />)
    await userEvent.click(screen.getByRole('button', { name: '机器人' }))
    expect(onChange).toHaveBeenCalledWith('bots')
  })

  it('当前 tab 标 aria-current（无障碍）', () => {
    render(<TabBar active="overview" onChange={() => {}}
      tabs={[{ key: 'overview', label: '概览' }]} />)
    expect(screen.getByRole('button', { name: '概览' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('TopBar', () => {
  it('有 onBack 时渲染返回按钮', async () => {
    const onBack = vi.fn()
    render(<TopBar title="详情" onBack={onBack} />)
    await userEvent.click(screen.getByRole('button', { name: /返回/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('ActionSheet / useConfirm', () => {
  function Probe() {
    const confirm = useConfirm()
    return <button onClick={() => void confirm({ title: '确认删除？', destructive: true })}>删</button>
  }

  it('调用 confirm 弹出确认层，点确认关闭', async () => {
    render(<ActionSheetProvider><Probe /></ActionSheetProvider>)
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    expect(await screen.findByText('确认删除？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /确认/ }))
    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument()
  })

  it('点取消关闭且不抛错', async () => {
    render(<ActionSheetProvider><Probe /></ActionSheetProvider>)
    await userEvent.click(screen.getByRole('button', { name: '删' }))
    await userEvent.click(await screen.findByRole('button', { name: /取消/ }))
    expect(screen.queryByText('确认删除？')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/components/mobile/mobile.test.tsx
```

Expected: FAIL —— 无法解析 `./index`

- [ ] **Step 3: 实现 8 个组件**

逐个创建。要点：

- **`ListRow`**：有 `onClick` 时渲染 `<button>`，无则 `<div>`。行高 `min-h-[52px]`、`px-4`。内部布局：左列（primary `text-[16px]` + secondary `text-[13px] text-muted-foreground`）+ 右列（badge/value/trailing/chevron）。`disabled` 时同时加 `aria-disabled` 并**实际拦截点击**（沿用旧实现的双保险 —— 只加 `pointer-events:none` 会漏掉键盘路径）。
- **`SectionCard`**：组标题 `text-[13px] text-muted-foreground pl-1 mb-1.5`，卡片 `bg-card rounded-lg`，`footer` 上方 `border-t border-border`。
- **`SwitchRow`**：`ListRow` 的变体，右侧放 Task 3 的 `Switch`；**整行可点即切换**（移动端习惯）。`label` 关联到 `Switch` 的 `aria-label`。
- **`Segmented`**：横向胶囊 chips，`role="group"` + 每项 `aria-pressed`。当前项 `bg-card shadow-sm`，其余透明。
- **`SearchField`**：Task 3 的 `Input` + 左侧搜索图标（lucide `Search`）+ 有值时右侧清除按钮。
- **`TabBar`**：固定底部，`Glass` 底（浮起元素 ✓），每项垂直布局（icon + label `text-[11px]`），`min-h-[56px]`，`pb-[env(safe-area-inset-bottom)]`。当前项 `aria-current="page"` 且 `text-primary`。
- **`TopBar`**：`GlassToolbar`（浮起元素 ✓），`title` + 可选 `subtitle`，`onBack` 时左侧返回按钮（lucide `ChevronLeft`），`actions` 右侧。
- **`ActionSheet`**：Context + Provider，`useConfirm` 返回 `Promise<boolean>`。弹层用 `GlassSheet`（浮起元素 ✓）+ 遮罩 `bg-black/30 backdrop-blur-xs`。必须有 `role="dialog"` `aria-modal="true"` `aria-labelledby` 指向标题；Esc 关闭 = resolve false；**焦点管理**：打开时焦点移到确认按钮、关闭后还给触发元素。

- [ ] **Step 4: 写导出入口**

创建 `web/src/components/mobile/index.ts`。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd web && npx vitest run src/components/mobile/mobile.test.tsx && npm run typecheck
```

Expected: PASS + typecheck 干净。

- [ ] **Step 6: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/components/mobile/
git commit -m "web: 移动端组件层（Phase 1）"
```

---

## Task 5: 反馈层与测试装配重建

**Files:**
- Create: `web/src/components/feedback/Toast.tsx` · `EmptyState.tsx` · `ErrorState.tsx` · `Skeletons.tsx` · `ErrorBoundary.tsx` · `index.ts`
- Modify: `web/src/test/renderPage.tsx`（改为同时支持新旧两套 Provider）
- Modify: `web/src/test/setup.ts`（仅当需要时）
- Test: `web/src/components/feedback/feedback.test.tsx`

**Interfaces:**
- Consumes: Task 1 token/cn；Task 3 的 `Button`
- Produces（**props 与现有 `src/ui/` 保持兼容**，Phase 2/3 迁移时改动最小）：
  - `ToastProvider` + `useToast(): { show(message: string): void }` —— 用 sonner 实现
  - `EmptyState` —— `title` `description?` `action?`
  - `ErrorState` —— `status: number` `onRetry?: () => void`（`status` 语义与现有实现一致：0=网络失败、401=身份失效、403=无权限、404=不存在、其余=服务端错误）
  - `Skeletons` —— `rows?: number`
  - `ErrorBoundary` —— `children`
- Produces（测试装配）：`renderPage(ui, options?)` 返回 `{ ...rtlResult, client }`，**同时挂新旧两套 Provider**（Phase 1 期间新组件用新 Provider、旧页面用旧 Provider，装配必须两者都支持）

**关键点：`renderPage` 在 Phase 1 期间必须同时支持新旧组件**。现有 `renderPage` 挂的是 MUI 版 `ActionSheetProvider`/`ToastProvider`（来自 `src/ui`）。Phase 1 新增了 Tailwind 版。做法：`renderPage` 挂**两套** Provider，新组件用新的 `useToast`/`useConfirm`，旧组件用旧的，互不干扰（两个 Context 名字相同但在不同模块，不会串）。

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/feedback/feedback.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorBoundary, ErrorState, Skeletons, ToastProvider, useToast } from './index'

describe('ToastProvider / useToast', () => {
  function Probe() {
    const { show } = useToast()
    return <button onClick={() => show('已保存')}>触发</button>
  }

  it('show 后消息出现在文档里', async () => {
    render(<ToastProvider><Probe /></ToastProvider>)
    await userEvent.click(screen.getByRole('button', { name: '触发' }))
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('渲染标题与说明', () => {
    render(<EmptyState title="暂无记录" description="换个筛选试试" />)
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
    expect(screen.getByText('换个筛选试试')).toBeInTheDocument()
  })

  it('有 action 时渲染操作按钮', () => {
    render(<EmptyState title="空" action={<button>去添加</button>} />)
    expect(screen.getByRole('button', { name: '去添加' })).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('401 提示身份失效', () => {
    render(<ErrorState status={401} />)
    expect(screen.getByText(/身份|失效|登录/)).toBeInTheDocument()
  })

  it('有 onRetry 时渲染重试按钮并回调', async () => {
    const onRetry = vi.fn()
    render(<ErrorState status={500} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('无 onRetry 时不渲染重试按钮', () => {
    render(<ErrorState status={0} />)
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })
})

describe('Skeletons', () => {
  it('渲染指定行数', () => {
    const { container } = render(<Skeletons rows={3} />)
    expect(container.querySelectorAll('[data-skeleton-row]').length).toBe(3)
  })

  it('默认 1 行', () => {
    const { container } = render(<Skeletons />)
    expect(container.querySelectorAll('[data-skeleton-row]').length).toBe(1)
  })
})

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('boom')
  }

  it('子组件抛错时渲染兜底而非整页崩', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByText(/出错|异常/)).toBeInTheDocument()
    spy.mockRestore()
  })

  it('正常子树原样渲染', () => {
    render(<ErrorBoundary><div>正常</div></ErrorBoundary>)
    expect(screen.getByText('正常')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/components/feedback/feedback.test.tsx
```

Expected: FAIL —— 无法解析 `./index`

- [ ] **Step 3: 实现反馈层组件**

- **`Toast.tsx`**：封装 sonner。`ToastProvider` 渲染 sonner 的 `<Toaster />`（位置 `bottom-center`，与旧 Toast 的位置习惯一致），`useToast` 返回 `{ show }` → 内部调 sonner 的 `toast()`。**必须保持 `useToast().show(message)` 的签名**，Phase 2/3 迁移时调用点不用改。
- **`EmptyState.tsx`**：居中布局，图标（lucide）+ `title` + `description`（`text-muted-foreground text-[13px]`）+ `action`。
- **`ErrorState.tsx`**：按 `status` 分文案（**沿用现有 `src/ui/ErrorState.tsx` 的文案表** —— 读它抄过来，不要自己另写一套，否则两端提示不一致）。`onRetry` 存在时给「重试」按钮。
- **`Skeletons.tsx`**：`rows` 行矩形占位，每行加 `data-skeleton-row` 属性（测试断言用）。`animate-pulse` 要在 `prefers-reduced-motion` 下停（用 Tailwind 的 `motion-reduce:animate-none`）。
- **`ErrorBoundary.tsx`**：class 组件（React 的错误边界只能是 class），抓错后渲染兜底 UI。**沿用现有实现的兜底文案**。

- [ ] **Step 4: 重建测试装配**

修改 `web/src/test/renderPage.tsx`：保留原有 MUI 版 Provider 链，**追加**新组件层的 Provider（`ToastProvider` 来自 `components/feedback`、`ActionSheetProvider` 来自 `components/mobile`）。两个模块的同名导出用别名导入避免冲突：

```tsx
import { ActionSheetProvider as MuiActionSheetProvider, ToastProvider as MuiToastProvider } from '../ui'
import { ActionSheetProvider as TwActionSheetProvider } from '../components/mobile'
import { ToastProvider as TwToastProvider } from '../components/feedback'
```

在原有嵌套外再包一层新 Provider。

**注意**：`web/src/test/renderPage.tsx` 当前挂着 `NavProvider`（`src/nav.tsx`）—— 那是 Mini App 的导航，Phase 2 才换。本阶段保留。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd web && npx vitest run src/components/feedback/feedback.test.tsx && npm run test 2>&1 | tail -6
```

Expected: 新测试 PASS，且**原有 51 files / 339 tests 仍全绿**（证明装配改动没破坏旧页面测试）。

- [ ] **Step 6: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/components/feedback/ web/src/test/renderPage.tsx
git commit -m "web: 反馈层组件与测试装配扩展（Phase 1）"
```

---

## Task 6: 组件预览页

**Files:**
- Create: `web/src/components/preview/PreviewPage.tsx` · `index.ts`
- Modify: `web/src/public/PublicApp.tsx`（**只加一条路由**，不动现有页面）
- Test: `web/src/components/preview/PreviewPage.test.tsx`

**Interfaces:**
- Consumes: Task 1-5 的全部产出
- Produces: `/miniapp/_preview` 与 `/_w/preview/0/x` 两个可访问的预览入口 —— Phase 1 的人工验收载体；Phase 4 后删除

**为什么放公开页入口**：Mini App 入口需要 Telegram initData 才能绕过鉴权，不适合自动验收；公开页（`_w`）用签名路径，可以造一个固定签名路径直达。**但公开页的 CSP 很严**（`default-src 'none'`），预览页在 `_w` 下可能被 CSP 挡住样式 —— 若如此，改为只在 dev server（`npm run dev`）下通过 `/miniapp/_preview` 访问，**不要为此放松生产 CSP**（那是安全边界，见 CLAUDE.md）。

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/preview/PreviewPage.test.tsx`：

```tsx
// 预览页的存在性测试：断言它把各层的代表性组件都渲染出来了。
// 真机观感（玻璃的三层效果、暗色）由人工在这一页验收。
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreviewPage } from './PreviewPage'

describe('组件预览页', () => {
  it('渲染各分节标题', () => {
    render(<PreviewPage />)
    for (const t of ['语义 token', '玻璃层', '基础组件', '移动端组件', '反馈层']) {
      expect(screen.getByRole('heading', { name: t })).toBeInTheDocument()
    }
  })

  it('玻璃层演示含 Layer 1 与 Layer 3 两个样本', () => {
    render(<PreviewPage />)
    expect(screen.getByTestId('preview-glass-base')).toBeInTheDocument()
    expect(screen.getByTestId('preview-glass-refract')).toBeInTheDocument()
  })

  it('含亮暗切换开关（人工验收暗色用）', () => {
    render(<PreviewPage />)
    expect(screen.getByRole('switch', { name: /暗色|dark/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/components/preview/PreviewPage.test.tsx
```

Expected: FAIL —— 无法解析 `./PreviewPage`

- [ ] **Step 3: 写预览页**

创建 `web/src/components/preview/PreviewPage.tsx`，分五节：

1. **语义 token** —— 色块网格，每格标 token 名与值（`bg-background` `bg-card` `bg-primary` `bg-destructive` `bg-success` `bg-warning` `bg-muted`），每格内放正文与次要文字（**用于人工核对对比度 ≥4.5:1**）
2. **玻璃层** —— `data-testid="preview-glass-base"` 的基础玻璃卡、`data-testid="preview-glass-refract"` 的折射卡、一张带 `sheen` 的卡。**每张卡下面垫一张彩色渐变图片/色块**（否则看不出模糊效果 —— 玻璃必须有东西可透）
3. **基础组件** —— Button 全 variant/size、Badge 全 tone、Input（正常/错误态）、Switch、Checkbox、Select、Card、Tabs、Table
4. **移动端组件** —— ListRow（各种组合）、SectionCard、SwitchRow、Segmented、SearchField
5. **反馈层** —— EmptyState、ErrorState（各 status）、Skeletons、Toast 触发按钮

顶部放一个亮/暗切换 Switch（调 Task 1 的 `setStoredTheme` + `applyThemeMode`），以及一行说明文字：本页是 Phase 1 验收载体，Phase 4 后删除。

- [ ] **Step 4: 加 dev 入口**

在 `web/src/public/main.tsx` 或 `web/src/main.tsx` 里加一条**开发期**路由判断（用 `import.meta.env.DEV` 门控，生产构建里这段是死代码会被摇掉）：

```tsx
// 开发期组件预览页（Phase 1 验收用，Phase 4 删除）。
// 只在 dev 构建里可达，生产产物不含此分支。
if (import.meta.env.DEV && location.pathname.endsWith('/_preview')) {
  // 渲染 <PreviewPage />
}
```

- [ ] **Step 5: 跑测试与人工验收**

```bash
cd web && npx vitest run src/components/preview/PreviewPage.test.tsx && npm run test 2>&1 | tail -5
```

然后用 dev server 人工验收（**这是 Phase 1 的核心验收动作**）：

```bash
cd web && npm run dev
# 浏览器打开 http://localhost:3000/miniapp/_preview
```

逐项确认（记录在报告里）：
- 玻璃卡：背后色块被模糊、边缘有描边与高光、能看到噪点纹理
- 折射卡：在 Chrome 上有边缘位移（Safari 上应无位移但仍有毛玻璃 —— 这是预期的平台差异）
- 切暗色：所有 token 与玻璃都跟着变，文字仍清晰可读
- 键盘 Tab 走一遍：所有可交互组件有可见焦点环
- 对比度：各 token 格里的正文/次要文字能看清

- [ ] **Step 6: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/components/preview/ web/src/main.tsx web/src/public/main.tsx
git commit -m "web: 组件预览页（Phase 1 验收载体）"
```

---

## Task 7: Phase 1 收尾验证

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（追加 Phase 1 实测结论）

**Interfaces:**
- Consumes: Task 1-6 全部产出
- Produces: Phase 1 的验收结论 —— 决定 Phase 2 能否开始

- [ ] **Step 1: 跑全套门禁**

```bash
cd web
npm run typecheck
npm run test 2>&1 | tail -8
npm run lint
npm run build 2>&1 | tail -6
```

Expected 全部通过，且：
- 测试总数 > 339（Phase 1 新增了 token/玻璃/组件/预览页的测试），**原有 339 个一个不动**
- 构建产物里含 Tailwind CSS（搜 `backdrop-filter`）

- [ ] **Step 2: 确认 Go 侧未受影响**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
CGO_ENABLED=0 go build -o /tmp/menshen-p1 .
go test ./internal/panel/ -count=1 2>&1 | tail -2
ls internal/panel/webdist/*.html
```

Expected: 编译通过、测试通过、三个 html 都在（Phase 1 没碰 Go 与构建链）。

- [ ] **Step 3: 确认现有页面未受影响**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git diff --stat HEAD~7 -- web/src/pages/ web/src/admin/ web/src/public/ web/src/ui/
```

Expected: **空**（除了 Task 6 在 `src/public/main.tsx` 或 `src/main.tsx` 加的那条 dev 路由）。Phase 1 不应改动任何现有页面组件。

- [ ] **Step 4: 写设计文档实测结论**

在 `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md` 追加一节「§10.1 Phase 1 验收结论」，记录：
- 6 个任务的产出清单
- 测试数量变化（从 339 到多少）
- 玻璃三层在 Chrome / Safari 的实际表现差异（人工验收结果）
- 对比度实测值（各 token 组合）
- 暗色切换是否正常
- 遇到的坑

- [ ] **Step 5: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md
git commit -m "docs: 记录前端 Phase 1 设计系统的实测结论"
```

---

## Phase 1 完成标准

1. `src/styles/` 四件套就位，token 亮暗两套齐全，颜色全 oklch
2. 玻璃三层实现完整，**三条回退齐全**（`@supports not` / `prefers-reduced-transparency` / `prefers-reduced-motion`）
3. 折射是显式 opt-in（`.glass--refract`），默认不启用
4. `components/ui/` 的基础组件可用（Button/Badge/Input/Switch/Card/Dialog 等按需）
5. `components/mobile/` 的 8 个组件 props 与旧 `src/ui/` 同名组件兼容
6. `components/feedback/` 的 toast/confirm/empty/error/skeleton/boundary 可用
7. 组件预览页能打开，玻璃/暗色/对比度/键盘焦点四项人工验收通过
8. `typecheck` / `test` / `lint` / `build` 全绿，**原有 339 个测试一个未改**
9. **未改动任何现有页面**（`src/pages/` `src/admin/` `src/public/` `src/ui/` 无 diff）
10. Go 侧未受影响（`go build` + `go test ./internal/panel/` 通过）
11. 设计文档已写入 Phase 1 实测结论

## 本阶段之后

Phase 2（桌面端外壳 + 16 视图 + 补 AI 流水页）与 Phase 3（Mini App 外壳 + 18 页面）的计划在 Phase 1 落地后单独写 —— 那时组件接口已是真实代码，可以引用具体签名而非猜测。
