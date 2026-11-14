# 前端重写 Phase 4：公开页迁移与收尾

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把公开页（`/miniapp/_w/*`，6 个页面）迁到新设计系统，补主题手动切换 UI，做无障碍/响应式收尾，删预览页，最后卸载 MUI 依赖。

**Architecture:** 与 Phase 3 同构 —— 换展示层，不动数据与验证逻辑。公开页是**独立入口**（`src/public/main.tsx` → `public.html`），不加载 Telegram SDK，主题跟随系统（Phase 4 起增加手动切换）。

**Tech Stack:** React 19 · Tailwind CSS 4 · shadcn/ui · 新组件层（`components/{ui,mobile,glass,feedback}`）· Rsbuild 2.3

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（§6 主题策略 · §10 Phase 4）

## Global Constraints

- **组件唯一来源**：`src/components/{ui,mobile,glass,feedback}`。不得新建第三套。
- **不得改 Go 代码**、rsbuild 承重配置、`internal/panel/webdist`。
- **不得改已完成的桌面端与 Mini App**：`src/admin/**`、`src/pages/**`、`src/App.tsx`。
- **§4.6 景深画布**：页面容器不得铺不透明 `bg-background`（会盖住 body 的光晕，玻璃失效）。
- **玻璃只用在浮起元素**：卡片/弹层；长列表行不用。
- **间距换算（Phase 3 血的教训）**：MUI `spacing(n) = n×8px`，Tailwind 单位 4px，**换算是 ×2**。
  `sx={{ mb: 1 }}`(8px) → `mb-2`；`sx={{ mt: 0.5 }}`(4px) → `mt-1`；
  `sx={{ px: 1.5 }}`(12px) → `px-3`；`sx={{ gap: 0.75 }}`(6px) → `gap-1.5`。
- **不得使用占位符实现**。
- **CSP 是硬约束**：公开页有严格的 CSP（`panel.writeHTMLHeaders`），
  不得引入内联脚本或新的外部域名 —— 否则验证页静默失效（见 CLAUDE.md「网页验证页的 CSP」）。
- **验证逻辑零改动**：`captcha.ts`、`useGate`、签名校验、Turnstile/hCaptcha/cap 的调用链
  **一个字都不能改**。这是安全边界，只换展示层。
- **测试门禁**：`typecheck`/`test`/`lint`/`build` 全绿；488 个既有测试继续全绿
  （最后卸载 MUI 时相关测试才一并调整）。

## 文件结构

| 路径 | 职责 |
|---|---|
| `src/public/PublicApp.tsx` | 外壳：换新层，去 MUI `ThemeProvider`/`CssBaseline`/`Container` |
| `src/public/pages/*.tsx` | 6 个页面：换 import + 删 `sx` |
| `src/public/TurnstileWidget.tsx` | 换新层（`Box` → `div`） |
| `src/public/InvalidState.tsx` | 换新层 |
| `src/theme.ts` | **最后删除**（`buildMiniTheme` 无消费者后） |
| `src/components/preview/` | **最后删除**（Phase 1 的验收载体） |

---

## Task 1: 公开页外壳与主题

**Files:**
- Modify: `web/src/public/PublicApp.tsx`
- Modify: `web/src/public/main.tsx`（如需注入主题模式）

**要点**：
- 去 MUI `ThemeProvider`/`CssBaseline`/`Container`/`Box`/`Typography`。
- 主题：`applyThemeMode(resolveThemeMode())` + `subscribeSystemTheme`（与 `AdminApp.tsx` 同构）。
- 容器宽度按路由选（`apv` 宽 / `v` 中 / 其余窄），用 Tailwind `max-w-*` + `mx-auto px-4`。
- 顶部「门神 / 反广告申诉与记录查看」标题栏用 Tailwind。
- **不得铺 `bg-background`**。

---

## Task 2: 6 个页面迁移（分 3 批）

| 批次 | 页面 |
|---|---|
| 2a | `JoinVerifyPage`(161) · `LogViewPage`(156) · `InvalidState`(16) |
| 2b | `AppealVerifyPage`(323) · `AppealDemoPage`(147) · `CaptchaDemoPage`(139) |
| 2c | `AppealViewPage`(395) · `TurnstileWidget`(61) |

**替换对照**（同 Phase 3）：

| 旧 | 新 |
|---|---|
| `Box`/`Typography`/`Stack`/`Container` | `<div>`/`<p>`/`<span>`/`<h*>` + Tailwind |
| `Button` | `components/ui` 的 `Button` |
| `CircularProgress` | `components/ui` 的 `Spinner` |
| `TextField` | `Input` + `Label` |
| `Chip` | `components/mobile` 的 `Chip`/`ChipStatic` |
| `useMediaQuery` | Tailwind 响应式前缀（`sm:`/`md:`/`lg:`） |
| `sx={{...}}` | Tailwind 类名 |

**硬约束**：
- `captcha.ts` 的加载与渲染逻辑**一字不改**（CSP 白名单对齐它）。
- Turnstile/hCaptcha/cap 的 widget 容器尺寸与回调不变。
- 表单的 `Label htmlFor` 与输入框 `id` 成对。

---

## Task 3: 主题手动切换 UI

**Files:**
- Create: `web/src/components/feedback/ThemeToggle.tsx`（或复用预览页里已有的 `ThemeToggle`）
- Modify: `web/src/public/PublicApp.tsx`、`web/src/admin/shell.tsx`、Mini App 的「我的」页

**要点**：
- `lib/theme-mode.ts` 已有 `setStoredTheme` / `resolveThemeMode` / `subscribeSystemTheme`。
- 三面共用同一个组件（设计文档 §6 要求）。Mini App 内因 Telegram 管主题，**不显示**切换器。
- 循环三态：跟随系统 → 亮 → 暗 → 跟随系统。

---

## Task 4: 无障碍/响应式/reduced-motion 收尾

**要点**：
- `prefers-reduced-motion`：所有过渡/动画在减弱动效时关闭（检查 `glass.css` 是否已覆盖）。
- 焦点可见：所有可交互元素有 `focus-visible` 环（Phase 1 的组件层已做，抽查页面自定义元素）。
- 触控尺寸：**做一次设计系统级裁定** —— 决定 `COMPACT_BTN`(32px)/`Segmented`(26px)
  是保持还是提到 44px，并在组件层统一实施（不要逐页私改）。
- 响应式：三个面在 320px / 768px / 1280px 下无横向滚动。

---

## Task 5: 删除预览页与 `theme.ts`，卸载 MUI

**Files:**
- Delete: `web/src/components/preview/`、`web/src/theme.ts`、`web/src/theme.test.ts`
- Modify: `web/src/main.tsx`（删预览路由分支）、`web/package.json`（卸载 MUI 依赖）

**前置**：`grep -rn "@mui\|@emotion" web/src/` 必须为空。

---

## Task 6: Phase 4 收尾验证

- [ ] 全套门禁（typecheck/test/lint/build）
- [ ] Go 侧 `go build` + `go test ./...`
- [ ] `grep -rn "@mui\|@emotion" web/src/ web/package.json` 为空
- [ ] 浏览器实测：公开页在亮/暗两种模式下渲染、玻璃生效、CSP 无违规
- [ ] 写设计文档 §10.4

---

## Phase 4 完成标准

1. 公开页 6 个全部迁到新设计系统
2. `@mui/*`、`@emotion/*` 已从依赖移除，全仓零引用
3. 主题手动切换在三面可用（Mini App 除外）
4. 预览页已删除
5. `typecheck`/`test`/`lint`/`build` 全绿
6. Go 侧未受影响
7. 设计文档已写入 §10.4
