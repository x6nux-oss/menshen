# 前端重写 Phase 3：Mini App 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Telegram Mini App（`/miniapp`，19 个页面）从 MUI 迁到新设计系统，并让主题策略改为「只跟随 Telegram 亮/暗」（设计文档 §6）。

**Architecture:** 与 Phase 2 同构 —— 换展示层，不动数据逻辑。Mini App 的外壳（`App.tsx` 的 `Shell`）换成新 `TopBar`/`TabBar`，`pages/shared.tsx` 的 8 个展示件改用新组件层，19 个页面改 import 来源 + 去掉 `sx`。

**Tech Stack:** React 19 · Tailwind CSS 4 · shadcn/ui · 新组件层（`components/{ui,mobile,glass,feedback}`）· Rsbuild 2.3

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（§5 目录结构 · §6 主题策略 · §10 Phase 3）

## Global Constraints

- **组件唯一来源**：`src/components/{ui,mobile,glass,feedback}`。不得新建第三套。
- **`src/ui/`（MUI 版）在本阶段结束时删除** —— 但要**最后一步**才删（等所有引用清零）。
- **不得改 Go 代码**、rsbuild 承重配置、`internal/panel/webdist`。
- **不得改 Phase 2 已完成的桌面端**：`src/admin/**`。
- **主题策略（§6）**：Mini App **只读 Telegram `colorScheme`（亮/暗），忽略 `themeParams` 的主题色**。玻璃效果依赖可控的底色；Telegram 允许任意自定义主色，白玻璃叠在自选深蓝上会发脏。
- **§4.6 景深画布**：页面容器不得铺不透明 `bg-background`（会盖住 body 的光晕，玻璃失效）。
- **玻璃只用在浮起元素**：顶栏/底栏/弹层/统计卡；长列表行不用。
- **移动端触控尺寸**：列表行 ≥52px、底部导航 ≥56px（含安全区）。
- **不得使用占位符实现**。
- **测试门禁**：`typecheck`/`test`/`lint`/`build` 全绿；既有 524 测试继续全绿（直到最后删除 `src/ui/` 时，其相关测试才一并删除）。

## 文件结构

| 路径 | 职责 |
|---|---|
| `web/src/App.tsx` | 外壳：`Shell` 换新 TopBar/TabBar；主题改 `colorScheme` |
| `web/src/pages/shared.tsx` | 8 个展示件（BotStatusBadge/ChatStatusBadge/Metric/InfoRow/ListCount/ListLoading/UserLink/InfiniteFooter）改用新层 |
| `web/src/pages/*.tsx` | 19 个页面：换 import + 删 `sx` |
| `web/src/ui/` | **最后删除**（连同 `src/ui/*.test.tsx`） |

---

## Task 1: 外壳与主题策略

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/telegram.ts`（`getTheme` 只返回 `colorScheme`）
- Test: `web/src/App.test.tsx`、`web/src/telegram.test.ts`（按需更新）

**Interfaces:**
- Consumes: `components/mobile` 的 `TopBar`/`TabBar`/`ActionSheetProvider`、`components/feedback` 的 `ToastProvider`/`ErrorBoundary`、`lib/theme-mode`
- Produces: `Shell` 组件改用新外壳；`telegram.getTheme()` 返回 `{ colorScheme }`（不再含 `themeParams`）

**要点**：
- 现状 `App.tsx` 用 MUI `ThemeProvider` + `buildMiniTheme(bridge.getTheme())`。改为：读 `bridge.getTheme().colorScheme` → `applyThemeMode('dark'|'light')`，组件树不再包 `ThemeProvider`/`CssBaseline`。
- `onThemeChanged` 仍订阅（用户切 Telegram 亮/暗时重建）。
- `setHeaderColor`/`setBackgroundColor` 仍按 Telegram 侧调用（让我们推给 Telegram 的颜色与 App 底色一致）。
- `TopBar`/`TabBar` 换成新组件；`TabBar` 的 key 要与 `TabKey`（overview/bots/chats/records/mine）对上。
- 保留 `BootSkeleton`/`UnavailableGuide`/导航栈逻辑（`nav.tsx` 不动）。

---

## Task 2: shared.tsx 的 8 个展示件

**Files:**
- Modify: `web/src/pages/shared.tsx`
- Test: 依赖它的页面测试会间接覆盖

**要点**：`BotStatusBadge`/`ChatStatusBadge` 改用新 `Badge`；`Metric`/`InfoRow`/`ListCount`/`ListLoading` 改 Tailwind；`UserLink` 用原生 `<button role="link">`；`InfiniteFooter` 用新 `Button` + Tailwind。**props 不变**（19 个页面都在用）。

---

## Task 3-6: 19 个页面（4 个批次）

按依赖与复杂度分批，每批一个 dispatch：

| 批次 | 页面 |
|---|---|
| 3 | `BotsPage`(69) · `MinePage`(140) · `OverviewPage`(128) · `SysLogPage`(209) |
| 4 | `UserPage`(146) · `ChatDetailPage`(213) · `AppealDetailPage`(254) · `LogDetailPage`(260) |
| 5 | `AILogPage`(269) · `AILogItemPage`(137) · `RecordsPage`(335) · `ChatsPage`(423) |
| 6 | `ModelsPage`(451) · `UpstreamsPage`(540) · `BotDetailPage`(601) |
| 7 | `ListsPage`(802) · `SettingsPage`(894) · `RulesPage`(1026) |

**每批的替换对照**（与 Phase 2 相同）：

| 旧 | 新 |
|---|---|
| `from '../ui'` 的 `Badge`/`EmptyState`/`ErrorState`/`ListRow`/`SearchField`/`SectionCard`/`Segmented`/`Skeletons`/`ChatRef` | `components/ui`（Badge/EmptyState/ErrorState/Skeletons）+ `components/mobile`（ListRow/SearchField/SectionCard/Segmented/ChatRef） |
| `useConfirm`/`useToast` | `components/mobile` 的 `useConfirm` / `components/feedback` 的 `useToast` |
| `@mui/material` 的 `Box`/`Typography`/`Stack`/`Button`/`TextField`/`Select`/`MenuItem`/`Chip`/`Card` 等 | Tailwind + `components/ui` 的对应件 |
| `sx={{...}}` | Tailwind 类名（删掉 sx） |

**注意**：`RulesPage`(1026) 与 `SettingsPage`(894) 按 CLAUDE.md 的大文件要求**借机拆分**（拆成同目录的子组件文件），但**不阻塞** —— 先完成迁移，拆分见 Task 8。

---

## Task 8: 拆分两个超大文件（可选，但 CLAUDE.md 要求）

`RulesPage.tsx`(1026) 与 `SettingsPage.tsx`(894) 拆分。**若时间/风险不允许，记为遗留**（不阻塞 Phase 4）。

---

## Task 9: 删除 MUI（`src/ui/`）与依赖

**Files:**
- Delete: `web/src/ui/`（整个目录，含 17 个组件 + 测试）
- Modify: `web/src/theme.ts`（`buildMiniTheme` 不再需要；`MiniThemeParams` 若还被 `telegram.ts` 引用则保留类型）
- Modify: `web/package.json`（卸载 `@mui/material`、`@mui/icons-material`、`@emotion/react`、`@emotion/styled`）

**前置**：`grep -rn "from '../ui'\|from './ui'" web/src/` 必须为空。

**要点**：
- `theme.ts` 的 `SUCCESS_COLOR`/`WARNING_COLOR` 若仍被引用，迁移到别处或直接删（新 token 有 `--success`/`--warning`）。
- 删除 `src/ui/*.test.tsx`（它们测的是 MUI 版组件，已被新组件测试取代）。
- 删完后跑全套门禁 + `npm run build` 确认产物正常。

---

## Task 10: Phase 3 收尾验证

- [ ] 跑全套门禁（typecheck/test/lint/build）
- [ ] Go 侧 `go build` + `go test ./internal/panel/`
- [ ] 确认 `src/admin/` 零改动
- [ ] `grep -rn "@mui\|@emotion" web/src/ web/package.json` 应为空
- [ ] 浏览器实测：Mini App 在 dev 下渲染、玻璃生效、暗色跟随 colorScheme
- [ ] 写设计文档 §10.3

---

## Phase 3 完成标准

1. 19 个页面全部迁到新设计系统，**`src/ui/` 已删除**
2. `@mui/*`、`@emotion/*` 已从依赖移除，全仓零引用
3. 主题只跟随 Telegram `colorScheme`（代码里不再读 `themeParams` 的主题色）
4. `typecheck`/`test`/`lint`/`build` 全绿
5. `src/admin/` 零改动
6. Go 侧未受影响
7. 设计文档已写入 §10.3

## 本阶段之后

Phase 4：公开页迁移 + 主题手动切换 UI + 无障碍/响应式收尾 + 删除组件预览页。
