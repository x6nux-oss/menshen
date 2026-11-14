# 前端重写 Phase 2：桌面端迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端管理面板（`/admin`）从 MUI 迁到 Phase 1 建好的新设计系统（Tailwind + shadcn + 玻璃），并**补齐 AI 调用流水页**（设计文档 §7 记录的唯一功能缺口 —— `src/admin/` 里 0 处 `ailog` 引用，而 Mini App 有）。

**Architecture:** 重写 `admin/` 的三个外壳件（`shell.tsx` 侧栏外壳、`nav.tsx`、`AdminApp.tsx`）与抽象层 `admin/components.tsx`（12 个展示件），16 个视图改为从新抽象层 import。视图内部逻辑（`api/hooks` 的调用、筛选状态、权限分支）**保持不变** —— 本次只换展示层。

**Tech Stack:** React 19 · Tailwind CSS 4 · shadcn/ui（Base UI）· TanStack Table 8 · lucide-react · Rsbuild 2.3

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（§5 目录结构 · §7 功能对齐 · §10 Phase 2）

## Global Constraints

- **Phase 1 的组件层是唯一展示件来源**：`src/components/{ui,mobile,glass,feedback}`。不得新建第三套。
- **`src/ui/`（MUI 版）在 Phase 2 期间仍需存在** —— Mini App 页面还在用它（Phase 3 才迁）。**不得删 `src/ui/`、不得删 MUI 依赖**。
- **不得改 Go 代码**、不得改 rsbuild 承重配置、不得改 `internal/panel/webdist`。
- **不得改 Mini App 的文件**：`src/pages/`、`src/App.tsx`、`src/nav.tsx`、`src/shellPages.tsx`、`src/route.ts`、`src/telegram.ts`。
- **玻璃只用在浮起元素上**（设计文档 §4.4）：桌面端侧栏、顶栏、弹层、统计卡用玻璃；**表格与长列表不用**。
- **不得使用占位符实现**：无 TODO、无空壳函数、无假数据。
- **桌面端触控尺寸**：桌面用鼠标，按钮 `h-8/h-9`（不必 44px）；表格行紧凑（行高 ~40px）。
- **功能不缩水**：16 个视图的每个操作入口都要保留（见 §「功能对齐清单」）。这是本阶段最重要的验收项。
- **测试门禁**：`typecheck` / `test` / `lint` / `build` 全绿。**既有 472 个测试必须继续全绿**（Mini App 的测试依赖 `src/ui/`，本阶段不碰它）。
- **无障碍**：侧栏导航键盘可达、当前项 `aria-current`、弹层有标题、焦点环可见。

## 文件结构

| 路径 | 职责 |
|---|---|
| `web/src/admin/shell.tsx` | 重写：drill-in 侧栏外壳（`Sidebar` + 顶栏 + 内容区），替代 MUI Drawer 版 |
| `web/src/admin/nav.tsx` | 保留（路由逻辑不变），仅当类型有变时调整 |
| `web/src/admin/AdminApp.tsx` | 改用新 Provider（`ToastProvider`/`ErrorBoundary` 来自 `components/feedback`） |
| `web/src/admin/components.tsx` | 重写：12 个展示件改用新组件层 |
| `web/src/admin/data-table.tsx` | **新建**：TanStack Table 封装（替代 `DataTable` 的手写实现） |
| `web/src/admin/views/*.tsx` | 16 个视图：改 import 来源 + 替换残留的 `Box`/`Typography`/`Stack` |
| `web/src/admin/views/AILogView.tsx` | **新建**：AI 调用流水（补缺口，含列表 + 详情） |
| `web/src/components/ui/spinner.tsx` | **新建**：`CircularProgress` 的对应件 |
| `web/src/admin/*.test.tsx` | 重写 admin 相关测试 |

**分层规则**：`admin/views/*` 只 import `admin/components`、`components/*`、`api/*`、`lib/*`。

---

## 功能对齐清单（**每个视图都要保留的操作入口**）

改动前必须逐个视图核对，改动后逐项确认仍在。这张表是本阶段的核心验收依据。

| 视图 | 必须保留的操作 |
|---|---|
| `OverviewView` | 待办项点击直达、近 24h 指标、最近命中列表 |
| `BotsView` | 列表、点击进详情 |
| `BotDetailView` | 启用开关、归属改派、判定模型选择、逐项参数覆盖（只显已覆盖项）、恢复全局、移除 |
| `ChatsView` | 搜索、按 bot 过滤、批量启停、批量切演练、批量改处罚方式 |
| `ChatDetailView` | 启用/演练开关、处罚方式、加群、移除群 |
| `RecordsView` | 分段（判定记录/申诉）、搜索、筛选、无限加载、进详情 |
| `LogDetailView` | AI 复查、解封、加白、人工标记、联合封禁/解除、AI 写规则 |
| `UserView` | 用户资料、其记录列表 |
| `AppealDetailView` | 申诉详情、AI 结果、解禁码签发、通过/驳回、重跑 |
| `ListsView` | 四分段（白名单/资料放行/联合封禁/次级管理员）、各自增删、搜索 |
| `UpstreamsView` | 列表、增删改、连通性测试 |
| `UpstreamDetailView` | 详情编辑、测试连通 |
| `ModelsView` | 列表、增删改、定价、`simple_instructions` 标记 |
| `RulesView` | 规则列表、测试、启停、强制、删除、Agent 启停与运行态 |
| `SettingsView` | 全局设置各分组、模型列表设置、摘要编辑 |
| `SysLogView` | 级别筛选、搜索、条数统计、无限加载 |
| `AILogView`（新建） | 列表（时间/模型/状态/耗时/用量/开销）、搜索、状态筛选、详情（输入/输出原文） |

---

## Task 1: Spinner 与 admin 基础件

**Files:**
- Create: `web/src/components/ui/spinner.tsx`
- Modify: `web/src/components/ui/index.ts`
- Create: `web/src/admin/components.tsx`（重写）
- Test: `web/src/admin/components.test.tsx`

**Interfaces:**
- Consumes: Phase 1 的 `components/ui`（Button/Badge/Card/Dialog/Table/Separator/Skeleton）与 `components/glass`
- Produces（**props 与旧 `admin/components.tsx` 保持兼容**，16 个视图的调用点不用改）：
  - `PageHeader` —— `title` `subtitle?` `actions?`
  - `Toolbar` —— `children`
  - `StatCard` —— `label` `value` `hint?` `onClick?`
  - `Column<T>` —— `key` `header` `render` `width?` `align?`
  - `DataTable<T>` —— `columns` `rows` `rowKey` `onRowClick?` `loading?` `empty?`
  - `EmptyRow` · `StatusBadge` —— `status: StatusInfo`
  - `ConfirmButton` —— `onConfirm` `children` `color?`（危险操作二次确认）
  - `InfoList` —— `items: {label, value}[]`
  - `CardBlock` —— `title?` `actions?` `children`
  - `MonoText` —— `children`

- [ ] **Step 1: 写失败测试**

创建 `web/src/admin/components.test.tsx`：断言 `PageHeader` 渲染标题与 actions、`DataTable` 渲染表头与行、`rowKey` 生效、`loading` 时显示占位、`empty` 时显示空态、`ConfirmButton` 点击后需二次确认才调 `onConfirm`、`StatusBadge` 按 tone 着色。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd web && npx vitest run src/admin/components.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 写 Spinner**

创建 `web/src/components/ui/spinner.tsx`：一个 SVG/CSS 旋转指示器，`animate-spin` 要在 `motion-reduce:animate-none` 下停。props：`className?` `size?`。

- [ ] **Step 4: 重写 admin/components.tsx**

按 Interfaces 列的 props 逐个实现，**先读旧实现确认字段名**（尤其 `ConfirmButton` 与 `StatusBadge`）。要点：
- `DataTable` 用 `<table>` + Tailwind 样式（**不要**先上 TanStack Table —— 本任务的 DataTable 只做静态渲染，排序/筛选在 Task 2 的 data-table.tsx 里做）
- `ConfirmButton` 用 Phase 1 的 `AlertDialog`（危险操作二次确认）
- 载入中用 `Spinner`（不是 `Skeleton` —— 表格内的行内加载用 spinner 更合适）
- 表格区域**不用玻璃**（§4.4）

- [ ] **Step 5: 跑测试确认通过**

```bash
cd web && npx vitest run src/admin/components.test.tsx && npm run typecheck
```

- [ ] **Step 6: 提交**

```bash
cd /Users/ll/code/menshen/.claude/worktrees/feat-frontend-rewrite
git add web/src/components/ui/spinner.tsx web/src/components/ui/index.ts web/src/admin/components.tsx web/src/admin/components.test.tsx
git commit -m "web: admin 展示层改用新设计系统，补 Spinner（Phase 2）"
```

---

## Task 2: data-table（TanStack Table 封装）

**Files:**
- Create: `web/src/admin/data-table.tsx`
- Test: `web/src/admin/data-table.test.tsx`

**Interfaces:**
- Consumes: `@tanstack/react-table@8`（需安装）、Task 1 的 `Column<T>` 类型
- Produces: `DataTable<T>` 的**增强版** —— 支持 `sortable?`（点击表头排序）、`filterable?`（列筛选）、`pagination?`（客户端分页）。**props 是 Task 1 的超集**，Task 1 的调用点仍可用。

**注意**：现有列表页大多是**服务端分页/无限加载**（`useInfiniteQuery`），客户端分页只对少量小数据集有意义。**先确认哪些视图真的需要** —— 若 16 个视图都用服务端分页，本任务的表格排序只需做**客户端排序**（对已加载的行），不做分页。**读几个视图确认后再决定**，并在报告里说明。

- [ ] **Step 1: 装依赖**

```bash
cd web && npm install @tanstack/react-table@^8
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/admin/data-table.test.tsx`：断言点击可排序表头后行序变化、`sortable=false` 时表头不可点、与 Task 1 的 `DataTable` props 兼容。

- [ ] **Step 3: 实现**

按实际需要实现（见上面「注意」）。保持与 Task 1 的 `DataTable` **同一套 props**，增强部分用可选 prop。

- [ ] **Step 4: 跑测试 + 提交**

---

## Task 3: 桌面外壳（drill-in 侧栏）

**Files:**
- Create: `web/src/admin/shell.tsx`（重写）
- Modify: `web/src/admin/AdminApp.tsx`
- Test: `web/src/admin/shell.test.tsx`（新建；原 `AdminApp.test.tsx` 按需重写）

**Interfaces:**
- Consumes: `components/glass`（`GlassPanel` 做侧栏/顶栏）、Task 1 的 `components.tsx`、`nav.tsx`（不变）
- Produces: `AdminShell` —— 保留现有导出名与 props（`AdminShell` / `MainOnly`），内部换成新外壳

**设计要点（设计文档 §5 + new-api 参考）**：
- **侧栏用 drill-in 模式**（new-api 自称「Vercel / Cloudflare pattern」）：主项分两组（`PRIMARY` 概览/机器人/群组/记录、`MANAGE` 名单/上游/模型/规则/运行日志/全局设置，后者按 `main` 过滤），点击进详情页时侧栏保持不换视图（我们的层级只有一层，比 new-api 简单）。
- 侧栏用 `GlassPanel`（浮起元素 ✓），顶栏用 `GlassToolbar`。
- 保留 `MAIN_ONLY_ROUTES` 的权限过滤、`LoginRequired` 的登录引导、`ShellSkeleton` 的加载态。
- 侧栏项当前项要 `aria-current="page"`。

- [ ] **Step 1-5**: 写测试 → 确认失败 → 实现 → 跑测试 → 提交

---

## Task 4-19: 16 个视图逐个迁移

**每个视图一个任务**，模式统一：

**Files:** `Modify: web/src/admin/views/<X>View.tsx`（+ 其 `.test.tsx` 若有）

**每个视图的步骤**：
1. **先读旧实现，列出它用到的所有操作入口**（对照 §「功能对齐清单」那行）
2. 改 import：`@mui/material` 的 `Box`/`Stack`/`Typography` → Tailwind 的 `<div className="...">`；`Card` → `CardBlock`/`Card`；`Table` 族 → `DataTable`
3. 替换 `sx` 内联样式为 Tailwind 类名（**注意**：`sx` 里的 responsive 写法要转成 `md:` 前缀）
4. 跑该视图的测试（若有），确认操作入口一个不少
5. 提交

**视图清单与顺序**（先简后繁，简单的先验证模式）：
| # | 视图 | 行数 | 备注 |
|---|---|---|---|
| 4 | `BotsView` | 67 | 最简单，先做以验证模式 |
| 5 | `SysLogView` | 111 | |
| 6 | `UserView` | 114 | |
| 7 | `OverviewView` | 133 | 统计卡可用玻璃 |
| 8 | `UpstreamsView` | 144 | |
| 9 | `AppealDetailView` | 147 | |
| 10 | `ChatDetailView` | 157 | |
| 11 | `LogDetailView` | 165 | |
| 12 | `UpstreamDetailView` | 190 | |
| 13 | `RecordsView` | 258 | 无限加载 + 分段 |
| 14 | `ChatsView` | 276 | 批量操作 |
| 15 | `SettingsView` | 334 | 设置分组 |
| 16 | `BotDetailView` | 347 | 参数覆盖 |
| 17 | `ListsView` | 433 | 四分段 |
| 18 | `ModelsView` | 433 | |
| 19 | `RulesView` | 441 | Agent 启停 |

**注意**：`RecordsView`/`ChatsView` 等用 `useInfiniteQuery` 的视图，**不要改数据逻辑**，只换展示。

---

## Task 20: 补 AI 调用流水页

**Files:**
- Create: `web/src/admin/views/AILogView.tsx` + `AILogItemView`（或同文件内的详情弹层）
- Modify: `web/src/admin/shell.tsx`（侧栏加一项）
- Modify: `web/src/admin/nav.tsx` + `route.ts`（加路由）
- Test: `web/src/admin/views/AILogView.test.tsx`

**Interfaces:**
- Consumes: **已有的 `ailog` / `ailogitem` 两个 op**（`api/hooks.ts` 的 `useAILogsInfinite` / `useAILogItem` —— Mini App 已在用，本任务只需复用）
- Produces: 桌面端 AI 流水页（列表 + 详情）

**参考**：Mini App 的 `src/pages/AILogPage.tsx` 与 `AILogItemPage.tsx`（读它们看有哪些筛选与字段），但**桌面形态**：用 `DataTable` 呈现（列：时间/模型/状态/耗时/输入输出用量/开销），详情用 `Sheet` 或独立路由页。

**这是设计文档 §7 记录的唯一功能缺口** —— 完成后两端功能对齐。

- [ ] Step 1-5：写测试 → 实现 → 验证 → 提交

---

## Task 21: Phase 2 收尾验证

**Files:** `Modify: docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（追加 §10.2）

- [ ] **Step 1: 功能对齐逐项核对**（**本阶段最重要的验收**）

打开每个视图，对照 §「功能对齐清单」逐项确认操作入口存在且可用。**记录每一条的核对结果**。

- [ ] **Step 2: 跑全套门禁**

```bash
cd web && npm run typecheck && npm run test && npm run lint && npm run build
cd .. && CGO_ENABLED=0 go build -o /tmp/menshen-p2 . && go test ./internal/panel/ -count=1
```

- [ ] **Step 3: 确认 Mini App 未受影响**（本阶段不动 `src/pages/`）

```bash
git diff --stat <Phase2 base> HEAD -- web/src/pages/ web/src/App.tsx web/src/nav.tsx web/src/route.ts
```

Expected: 空。

- [ ] **Step 4: 浏览器人工验收**

起 dev server（`npm run dev:admin`），用 agent-browser 打开 `/admin`，走一遍：概览 → 机器人详情 → 群组批量操作 → 记录筛选 → 上游测试连通 → 规则 Agent 启停 → **AI 流水页** → 全局设置。确认无 console 错误、侧栏导航正常、玻璃观感正确。

- [ ] **Step 5: 写 §10.2 并提交**

---

## Phase 2 完成标准

1. `/admin` 的 16 个视图全部迁到新设计系统，**无 `@mui` import 残留**（`src/admin/` 下 grep 应为 0）
2. **AI 调用流水页存在且可用**（列表 + 详情 + 筛选）
3. **§「功能对齐清单」逐项核对通过**（每个操作入口都在）
4. `typecheck` / `test` / `lint` / `build` 全绿；既有 472 测试继续全绿
5. **Mini App 零改动**（`src/pages/` 等无 diff）
6. Go 侧未受影响
7. 侧栏键盘可达、当前项 `aria-current`、弹层有标题
8. 设计文档已写入 §10.2

## 本阶段之后

Phase 3（Mini App 迁移）与 Phase 4（公开页 + 收尾）的计划在 Phase 2 落地后写。
