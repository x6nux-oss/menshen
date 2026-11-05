# 门神前端重写：new-api 风格 + 苹果玻璃拟态设计

> 2026-11-05。上游参考：`docs/panel.md`（面板与 Mini App 现状）·
> `docs/superpowers/plans/2026-10-01-miniapp-react-mui.md`（上一轮 React 重构）·
> 参考实现 `QuantumNous/new-api` 的 `web/`（研究快照见文末附录）。
>
> 本设计只改前端展示层。**Go 后端 API、鉴权、路由一律冻结**（唯一例外见 §7）。

## 1. 目标

三个前端面全部重写展示层，统一到一套设计系统：

| 面 | 挂载点 | 用户 | 形态 | 现状规模 |
|---|---|---|---|---|
| Mini App | `/miniapp` | 管理员（手机） | 移动优先，iOS Safari 主战场 | 18 页 |
| 桌面面板 | `/admin` | 管理员（桌面浏览器） | 桌面 Web 后台 | 16 视图 |
| 公开页 | `/_w/*` | **外部用户**（申诉者/待验证入群人） | 窄容器表单，弱网手机 | 6 页 |

三条硬约束：

1. **协议冻结**：`miniDispatch` 的 op 集合、initData HMAC 鉴权、会话 cookie 鉴权、
   `_w` 签名路由、CSP 全部不动。前端只消费现有 API。
2. **两端功能对齐**：同一组管理操作必须在三个面上都能完成（现状有一处缺口，见 §7）。
3. **视觉参考 new-api 当前形态**：它的 main 分支已从 Semi Design 迁到
   shadcn/ui + Tailwind CSS 4，本设计跟随这一形态（研究快照见附录 A）。

## 2. 非目标

- 不改判定链路、计费、申诉状态机、权限模型（主/次管分级原样）。
- 不新增管理角色、不做多语言、不做 PWA/离线。
- 不改 `internal/panel/*.go` 的托管路由与 embed 契约（`webdist` 路径不变）。
- 不改 Dockerfile / CI 的 `npm run build` 语义与产物路径。
- 不引入 URL 深层分享（Mini App 链接受 initData 绑定，本就不可分享）。

## 3. 技术选型

| 层 | 现状 | 目标 | 理由 |
|---|---|---|---|
| 框架 | React 19.2 | React 19.2 | 不动 |
| 构建 | Vite 8 | **rsbuild 2.3 + Rspack** | 跟随 new-api；加速构建 |
| 样式 | emotion（CSS-in-JS） | **Tailwind CSS 4.3** | 玻璃特效用工具类最直接；零运行时 |
| 组件 | MUI 7 | **shadcn/ui + Base UI 1.9** | 组件代码入仓库，无第三方版本耦合 |
| 图标 | @mui/icons-material | **lucide-react** | 与 shadcn 生态一致 |
| 动画 | 无 | **motion** | 页面过渡、玻璃扫光、列表入场 |
| 数据 | TanStack Query 5 | 不变 | 已在用且已验证 |
| 表格 | 手写 | **@tanstack/react-table 8** | 桌面端排序/筛选/分页/批量 |
| 虚拟滚动 | 无 | **@tanstack/react-virtual 3** | 判定流水列表可达数万条 |
| Toast | 自研 Toast | **sonner** | 与 shadcn 生态一致，队列与堆叠开箱可用 |
| 测试 | Vitest 5 + MSW 2 | 不变 | 已在用 |

**移除**：`@mui/material`、`@mui/icons-material`、`@emotion/react`、`@emotion/styled`、
`vite`、`vite.admin.config.ts`、`@vitejs/plugin-react`。

**主题**：MUI `createTheme` → **CSS 变量 + oklch 语义 token**（照搬 new-api 的分层，
值按本项目品牌调整）。暗色走 `.dark` 类切换，不再依赖 `prefers-color-scheme` 媒体查询
（Mini App 由 Telegram `colorScheme` 决定，见 §6）。

## 4. 玻璃层设计

### 4.1 平台现实（承重前提）

`backdrop-filter: url(#svgfilter)` —— SVG 位移滤镜做边缘折射 —— **在 iOS Safari 上
拿不到**。WebKit 长期未实现该形式，只支持 `blur()`/`saturate()` 这类滤镜函数。
iOS 上 Telegram 内嵌的就是 Safari WebView，也就是本项目的主力场景。

因此**折射不能作为基线**，否则 iOS 上会静默退化成一块半透明色板。做成三层渐进：

### 4.2 三层渐进

```
Layer 1  基线毛玻璃 —— 100% 设备，所有玻璃面都至少有这一层
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight), 0 8px 32px var(--glass-shadow);

Layer 2  噪点纹理 + 镜面扫光 —— 纯 CSS，100% 设备（视觉贡献最大、零风险）
  噪点：feTurbulence 生成的 data-URI 平铺，opacity ≈ .03，mix-blend-mode: overlay
  扫光：::after 斜向线性渐变，入场/hover 时过渡（reduced-motion 下关闭）

Layer 3  边缘折射增强 —— @supports (backdrop-filter: url(#x)) 通过才启用
  feDisplacementMap 作用于背景边缘 → Chromium 拿到真折射
  Safari/Firefox 自动跳过，退回 Layer 1+2 的干净毛玻璃
```

### 4.3 CSS 契约

```css
/* styles/glass.css —— 三个面共用，是本项目玻璃特效的唯一真源 */
.glass {
  position: relative;
  isolation: isolate;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    inset 0 -1px 0 var(--glass-shade),
    0 8px 32px var(--glass-shadow);
  border-radius: var(--radius-lg);
}
.glass::before { /* 噪点 */
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: var(--glass-noise); opacity: var(--glass-noise-opacity);
  mix-blend-mode: overlay; border-radius: inherit;
}
.glass::after { /* 镜面扫光 */
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(115deg,
    transparent 30%, var(--glass-sheen) 46%, transparent 62%);
  opacity: 0; transition: opacity .4s ease; border-radius: inherit;
}
.glass:hover::after, .glass[data-sheen='in']::after { opacity: 1; }

/* 三条回退，缺一不可 */
@supports not (backdrop-filter: blur(1px)) {   /* 老浏览器：不透明底，不做假模糊 */
  .glass { background: var(--card); backdrop-filter: none; }
}
@media (prefers-reduced-transparency: reduce) {
  .glass { background: var(--card); backdrop-filter: none; }
  .glass::after { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .glass::after { transition: none; opacity: 0; }
}
```

折射增强单独一个文件 `glass-refract.css`，用 `@supports` 包裹，并把 SVG 滤镜定义
挂在 DOM 里一个隐藏 `<svg>`（由 `GlassFilterDefs` 组件渲染一次）。

### 4.4 玻璃只用在「浮起」的元素上

**不是所有卡片都做玻璃。** 背后没有内容可透时，玻璃只会白耗合成开销。
明确分层：

| 用玻璃 | 用不透明卡片 |
|---|---|
| 顶栏、底栏（内容从下面滚过） | 列表内部的段落卡片 |
| 侧栏（drill-in 面板） | 表单区 |
| 弹层（Dialog/Drawer/Sheet/Popover） | 表格单元格 |
| 统计卡、概览首屏大卡 | 长列表的每一行 |

长列表行不做玻璃：滚动时每帧重算模糊是移动端掉帧的主因。

### 4.5 真折射只用在这几处

调研结论（附录 B）：所有 WebGL 截屏类方案都建立在「背景可被静态捕获」之上，
对本项目这种实时数据后台（列表/表格/日志）性能不可接受。所以 Layer 3 折射**只**用在：

- 概览首屏的大统计卡
- 公开页（申诉/验证）顶部卡
- 空状态插画容器

**列表与表格区域一律只用 Layer 1+2。** 这条边界写死在 `glass-refract.css` 的
类名设计里（`.glass--refract` 是显式 opt-in，不是默认值）。

### 4.6 景深画布（玻璃能看出效果的前提）

**玻璃的 `backdrop-filter` 模糊的是「它背后的内容」。背后是纯色时，模糊结果与
不模糊完全相同 —— 玻璃退化成一块半透明白板。** 这是「看着像 AI 生成」最典型的
来源：组件都写对了，但整页是均匀底色 + 白色卡片，没有景深、没有视觉焦点。

所以页面底色不能是单一颜色。`styles/index.css` 的 `body::before` 铺三团低饱和
品牌色光晕（`--canvas-glow-1/2/3`），`position: fixed` + `z-index: -1`：

```css
body::before {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(48rem 32rem at 8% -6%,  var(--canvas-glow-1), transparent 62%),
    radial-gradient(42rem 30rem at 96% 4%,  var(--canvas-glow-2), transparent 64%),
    radial-gradient(36rem 26rem at 50% 104%, var(--canvas-glow-3), transparent 66%);
}
```

三条硬约束：

1. **页面容器不得再铺不透明的 `bg-background`**。它会把光晕整个盖住，玻璃立刻失效。
   页面根容器只负责布局与内边距，背景交给 `body`。（这条踩过：预览页曾因此完全看不出玻璃。）
2. **光晕浓度不能太低**。实测 14% 在整页尺度下几乎不可见；当前取 22%/18%/14%，
   暗色提高到 26%/20%/24%（暗底上低透明度会被吃掉）。
3. **`prefers-reduced-transparency: reduce` 时关掉光晕** —— 对低对比敏感用户，
   纯色底比带色偏的渐变更容易读。

配套的玻璃底色要**薄**：`--glass-bg` 亮色 42%、暗色 38%。可读性不靠加厚不透明度，
而靠深色正文 + 1px 描边 + 内高光勾勒边界。

### 4.7 性能护栏

- `will-change: backdrop-filter` **只在弹层打开期间**加，关闭即摘（常驻会常驻合成层）。
- 移动端 `--glass-blur` 降到 12px（桌面 20px），由 `@media (max-width: 640px)` 切换。
- 列表虚拟滚动与玻璃层不共存于同一容器。

## 5. 目录结构

对齐 new-api 的 features 划分，顺带治两个既有的大文件病
（`RulesPage.tsx` 1026 行、`SettingsPage.tsx` 894 行 → 拆分，CLAUDE.md 有此要求）：

```
web/src/
  styles/
    theme.css        oklch 语义 token（亮/暗两套）
    index.css        Tailwind 入口 + @theme inline
    glass.css        玻璃层契约（§4.3）
    glass-refract.css 折射增强（@supports 包裹）
  components/
    ui/              shadcn 组件（代码入仓库）
    layout/
      desktop/       SidebarProvider + 顶栏 + SidebarInset（drill-in）
      mobile/        TopBar + TabBar + NavStack 外壳
      public/        公开页窄容器外壳
    glass/           GlassCard GlassPanel GlassSheet GlassToolbar GlassFilterDefs
    data-table/      TanStack Table 封装（桌面）
    mobile/          ListRow SectionCard SwitchRow Segmented ActionSheet SearchField
    feedback/        toast(sonner) confirm empty error skeleton
  features/          按业务域，每域 index.tsx + components/ + hooks.ts
    overview/ bots/ chats/ records/ appeals/ users/ lists/
    upstreams/ models/ rules/ settings/ syslog/ ailog/
  apps/
    miniapp/         入口 + 外壳装配
    admin/           入口 + 外壳装配
    public/          入口 + 外壳装配
  api/               保留（client/hooks/mutations/types 不动）
  lib/               保留（filters/format/settings/status/selection）
  telegram.ts        保留（主题改读 colorScheme，见 §6）
```

**分层规则**：`features/*` 只 import `components/*`、`api/*`、`lib/*`；
`components/*` 只 import `lib/*`；`apps/*` 装配三者。三个 app 的入口互不引用。

## 6. Mini App 主题策略

现状：实时跟随 Telegram `themeParams`（`bg_color`/`button_color`/`text_color`），
用户改 Telegram 主题色，App 跟着变。

改为：**只读 `colorScheme`（亮/暗），忽略主题色**。

理由：玻璃效果依赖精确可控的底色。Telegram 允许用户自定义任意主色，
白色玻璃叠在用户自选的深蓝底上会发脏，且每套自定义主题都要单独调玻璃参数——
这是一条无法收敛的维护路径。

改动点：`telegram.ts` 的 `getTheme()` 返回 `{colorScheme}`；`onThemeChanged` 仍订阅
（用户切换 Telegram 亮/暗时重建）；`App` 里 `ThemeProvider` 换成
`<div className={dark ? 'dark' : ''}>` + `document.documentElement.classList`。
`setHeaderColor`/`setBackgroundColor` 仍按 Telegram 侧调用（让 Telegram 自己的
标题栏与 App 底色一致），但那两个值是**我们推给 Telegram 的**，不是读回来的。

公开页与桌面面板：`prefers-color-scheme` + 用户手动切换（存 `localStorage`），
由 `lib/theme-mode.ts` 统一，三个 app 共用。

## 7. 功能对齐

逐 op 核对后，**唯一实锤缺口**：桌面端 `/admin` 没有 **AI 调用流水**页
（`src/admin/` 里 0 处 `ailog` 引用），而 Mini App 有 `AILogPage` + `AILogItemPage`。

修复：桌面端补 `features/ailog/`（列表 + 详情），复用已有的 `ailog` / `ailogitem`
两个 op —— 它们本就不分端（`miniDispatch` 里没有端判断）。桌面形态用 data-table
（时间/模型/状态/耗时/用量/开销列 + 筛选），详情用 Sheet。

其余逐页核对结果：`overview` `bots` `chats` `records` `appeals` `users` `lists`
`upstreams` `models` `rules`（含 Agent 启停）`settings` `syslog` 两端均已覆盖，
重写时保持覆盖不缩水，并新增**每页 op 覆盖回归测试**钉住（§9）。

**本设计对 Go 侧的唯一要求**：确认 `ailog` / `ailogitem` 的返回字段够桌面端表格用
（当前只服务过移动端列表）。若缺字段则补 `miniapp.go` 的返回结构 —— 这是唯一允许的
后端改动，且只加字段不改语义。

## 8. 构建链迁移

### 8.1 配置形态

保留两套构建入口（`assetPrefix` 不同，且 Mini App 产物含 `telegram-web-app.js`、
公开页要单独分包，两个入口本就不同）：

```
web/rsbuild.config.ts        entries: main(index.html) + public(public.html)
                             assetPrefix: /miniapp/
web/rsbuild.admin.config.ts  entry: admin(admin.html)
                             assetPrefix: /admin/
两者都输出到 ../internal/panel/webdist
```

Go 侧 `miniapp_embed.go`（`//go:embed all:webdist`）、`internal/panel/webdist/.gitkeep`、
Dockerfile 的两条 `test -f`（index.html + admin.html）、CI 的 `npm run build` 全部不变。
`package.json` 的 `build` 脚本仍是 `tsc -b && <两次构建>`，只是构建器换了。

### 8.2 待验证的 5 个前提（Phase 0 第一步，不通过则按退路改）

**a、b 已实测（2026-11-05，rsbuild v2.3.1）**，c、d、e 由 Task 2/3/4 在与生产配置
合流时覆盖。

| # | 前提 | 退路 | 实测结果 |
|---|---|---|---|
| a | `output.distPath.root: '../internal/panel/webdist'` 可跨目录 | 构建到 `web/dist` 再脚本拷贝 | ✅ **可行**。产物落到 `../internal/panel/webdist/probe.html`，无任何路径告警 |
| b | **两次构建共用一产物目录，第二次不误删第一次** | 第二次 `cleanDistPath: false` + 手动清自己的文件 | ✅ **可行，但前提是后置构建必须 `cleanDistPath: false`**（见下） |
| c | `html.template` 用函数按 `entryName` 分派模板 | 每入口独立配置目录 | 待 Task 2 实测 |
| d | Tailwind 4 在 rsbuild 下 `@theme inline` 生效 | 回退 `@tailwindcss/postcss` | 待 Task 2 实测 |
| e | MSW worker 可由 `public/` 复制替代 dev 中间件 | 保留自定义 rsbuild 插件 | 待 Task 4 实测 |

**b 是最危险的一条**：现状 Vite 靠「第二个配置 `emptyOutDir` 只清自己的文件」+
第一次构建结束回写 `.gitkeep` 实现共享产物目录（见现有 `vite.config.ts` 的
`keepWebdistPlaceholder`）。若 rsbuild 的 `cleanDistPath` 清空整个目录，第二次构建
会删掉 Mini App 产物，而 Dockerfile 的 `test -f index.html` 会因此失败 —— 这是
一个「构建成功但产物缺一半」的失效模式，必须显式验证。

#### b 的实测细节（决定 Task 2/3 的配置写法）

1. `cleanDistPath: true` **清空整个目录**：先用 `touch` 造一个 `index.html`
   （模拟 Mini App 的产物），再以 `true` 跑第二次构建 —— `index.html` 被删除。
   同时 **`.gitkeep` 也被删除**，所以「构建结束回写 `.gitkeep`」的插件是必需的，
   不是可选优化。
2. `cleanDistPath: false` **保留他人产物**：再造一个 `index.html`，以 `false`
   跑构建 —— `index.html` 存活，与本次构建的 `probe.html` 并存。
3. 结论：**先构建者用 `true`（顺带清掉上次构建的陈旧文件），后构建者用 `false`**。
   这正是计划的 `build:miniapp`（true）→ `build:admin`（false）顺序。

#### 实测发现的额外事实（Task 2/3 可直接利用）

- **rsbuild 默认自动复制 `public/` 到产物根**：未配置任何 `copy` 时，
  `web/public/telegram-web-app.js` 就出现在了产物目录。所以 Task 2 配置里的
  `copy: [{ from: 'public', to: '' }]` 是冗余的（不会报错，但非必需）。
- **`@rsbuild/core/types` 子路径存在**（`package.json` 的 `exports["./types"]`），
  所以 Task 4 把 `tsconfig.app.json` 的 `"types": ["vite/client"]` 改成
  `["@rsbuild/core/types"]` 是有效写法。
- **`onAfterBuild` 钩子在 v2.3.1 存在**（`dist/hooks.d.ts:7`），Task 2/3 的
  `.gitkeep` 回写插件逐字可用。

### 8.3 Phase 0 验收结论（2026-11-05，rsbuild v2.3.1，Node v26.13.0）

完整验证记录见 `.superpowers/sdd/2026-11-05-frontend-rewrite-phase0-build/task-5-report.md`。

**五条前提的最终结果**

| # | 前提 | 结果 |
|---|---|---|
| a | `distPath.root` 跨目录 | ✅ 成立，无退路 |
| b | 共享产物目录两次构建 | ✅ 成立（**前置构建 `true` / 后置 `false`**），无退路 |
| c | `html.template` 按 entryName 分派 | ✅ 成立（`rsbuild.config.ts` 用函数形式，`index`→`index.html`、`public`→`public.html`） |
| d | Tailwind 4 在 rsbuild 下 `@theme inline` | ✅ 成立，**未走 `@tailwindcss/postcss` 退路**（实测产出 8168 字节 CSS） |
| e | MSW worker 由 `public/` 复制替代 dev 中间件 | ✅ 成立（worker 进产物根、Go 侧可达；dev 路径缺陷已修复，见下） |

**dev server 白屏缺陷（已修复）**

验收时发现 Phase 0 完成标准第 4 条在 **dev 模式**下未满足（生产构建与托管始终正常）。
审查判定为 Important（dev 不可用即标准 4 未满足），已在本阶段内修复，未顺延到 Phase 1。

- **现象**：`VITE_MOCK=1 npm run dev` 后打开 `http://localhost:3000/miniapp/` ——
  `#root` 永远空白，页面什么都不渲染。
- **根因**：dev 模式下 rsbuild 把应用挂在**根路径 `/`**，而运行时代码硬编码了 `/miniapp/`
  前缀，导致 `/miniapp/*` 全部落到 SPA 回退返回 `text/html`：

  ```
  /                             200  text/html        ← 应用其实在这里
  /mockServiceWorker.js         200  text/javascript  ← 真实文件在根
  /miniapp/telegram-web-app.js  200  text/html        ← 期望真文件，实得 HTML
  /miniapp/mockServiceWorker.js 200  text/html        ← 期望真文件，实得 HTML
  ```

  于是 MSW 注册抛错（`unsupported MIME type ('text/html')`），`bootstrap()` 的
  `await startMocks()` 拒绝，后面的 `createRoot(...).render(...)` 永不执行：

  ```
  error   [browser] Uncaught (in promise) Error: [MSW] Failed to register the
  Service Worker: ... The script has an unsupported MIME type ('text/html').
  ```

- **迁移根因**：Vite 的 `base` 一个选项**同时**管 dev 与 build；rsbuild 拆成
  **`server.base`（dev 的 URL 基路径）** 与 **`output.assetPrefix`（产物里的资源前缀）**
  两个选项。Task 4 只迁了 `output.assetPrefix: '/miniapp/'`，漏了 `server.base`。

**修复内容（两处，均已落地并实测）**

1. **两个配置各加 `server.base`** —— `rsbuild.config.ts` 加 `base: '/miniapp/'`，
   `rsbuild.admin.config.ts` 加 `base: '/admin/'`。
2. **admin 再加 `server.historyApiFallback: { index: '/admin.html' }`** ——
   加完 `base` 后暴露的第二层问题：入口名是 `admin`，rsbuild dev 按入口名给 URL
   （`/admin/admin`），而 `/admin/`、`/admin/logs/9` 等会 404。生产由 Go 做同样的回退
   （`admin_panel.go` 的 `adminDistFile` + `adminIndex`），dev 也要对齐，否则本地
   打不开面板、刷新与深链全 404。Mini App 无需此项（入口名是 `index`，天然正确）。

**修复后的实测验证（`npm run dev` / `npm run dev:admin`）**

| 检查项 | 修复前 | 修复后 |
|---|---|---|
| Mini App dev URL | `http://localhost:3000/` | `http://localhost:3000/miniapp/` ✅ |
| `/miniapp/telegram-web-app.js` | `text/html` | `text/javascript` ✅ |
| `/miniapp/mockServiceWorker.js` | `text/html` | `text/javascript` ✅ |
| 浏览器 console 消息数 | 1（MSW MIME 报错） | **0** ✅ |
| 页面渲染 | `#root` 空 | 正常渲染 ✅ |
| Mini App 深链（`/miniapp/bots/12`、`/miniapp/logs/9`、`/miniapp/records`） | — | 全部 200 HTML ✅ |
| admin `/admin`、`/admin/`、`/admin/logs/9` | 404 | 全部 200 HTML ✅ |

**proxy key 复验（加 `base` 后是否仍需按原路径匹配）**：仍按原路径匹配，**无需随 base 改**。
实测（Go 服务未起，故表现为转发失败而非返回 dev 自己的 HTML —— 这恰好证明转发发生了）：

```
POST /miniapp/api/state  → HTTP 504  Error occurred while trying to proxy: localhost:3000/miniapp/api/state
GET  /admin/api/state    → HTTP 504
```

返回 `504` + proxy 错误文案说明请求已被转发到 `127.0.0.1:8081`（连接被拒）；
若未转发会得到 dev server 自己的 HTML。

**修复未影响生产构建**：`npm run build` 产物哈希与修复前**完全一致**
（`lib-react.875be40ab7.js`、`admin.6ee65c18a8.js`、`u.0867847a85.js`，Total 650.1 kB），
三 html 齐全；`npm run typecheck` exit 0；51 files / 339 tests 通过；lint exit 0；
`internal/panel` 的托管用例（`TestMiniAppServesEmbeddedApp`、`TestMiniAppRouteBoundaries`、
`TestAdminPanelRoutes`、`TestPublicShellHandler`）全部 PASS。
`server.base` 与 `historyApiFallback` 都只作用于 dev server，不进产物。

- **不受影响的部分**：生产构建产物的路径**完全正确**（`assets/` 扁平、引用带
  `/miniapp/` 前缀、SDK 排在入口脚本之前），Go 侧托管与全部前端测试都通过。
  该缺陷**只在 dev**。

**构建耗时**（`npm run build`，含 `tsc -b` + 两次 rsbuild 构建）

```
real 4.96s   user 7.39s   sys 0.73s
产物 Total: 650.1 kB / gzip 195.7 kB
```

Vite 基线无法对比（Vite 配置与依赖已在 Task 4 删除，为对比去重装不值得）。

**Phase 0 完成标准逐条核验**

| # | 标准 | 结果 |
|---|---|---|
| 1 | `npm run build` 一条命令产三个 html | ✅ `index.html` + `public.html` + `admin.html` |
| 2 | typecheck / test / lint 全绿（测试文件一个不改） | ✅ `tsc -b` exit 0；51 files / 339 tests 通过；lint exit 0（2 个既有 warning，非本次引入） |
| 3 | 有产物与无产物两种状态下 `go build` 都成功 | ✅ 两者均通过；无产物时 `go test ./internal/panel/` 也通过（回到 503 占位页路径） |
| 4 | 三个面在浏览器里打开正常 | ✅ **通过**（dev 缺陷已在本阶段修复，见上「dev server 白屏缺陷（已修复）」）。生产托管由 handler 测试覆盖；dev 下两个 app 的入口页、静态文件、SPA 深链均已实测正常 |
| 5 | vite 配置已删、依赖已移除 | ✅ 两个配置删除；`package.json` 无 `vite` / `@vitejs/*` |
| 6 | `.gitkeep` 在 git 索引、`.gitignore` 未排掉 | ✅ `git ls-files` 列出它；规则为 `webdist/*` + `!webdist/.gitkeep` |
| 7 | 设计文档已写入实测结论 | ✅ 本节 |

**Go 侧托管验证方式**（按裁决 1，未启动完整服务）

用既有的 in-process handler 测试覆盖，比起服务更贴近要验的东西：

- `TestMiniAppServesEmbeddedApp`（`miniapp_test.go:1149`）—— 入口页 200 且含 `id="root"`、
  入口页 `no-store`、引用 `/miniapp/telegram-web-app.js`、`fs.Glob(dist,"assets/*")` 非空、
  真实 asset 200 且 `immutable`、SDK 返回 JS Content-Type 且 `max-age=3600`、
  目录与缺失资源 404（禁止列举）、未匹配路由 SPA 回退 200。
- `TestMiniAppRouteBoundaries`（`miniapp_test.go:1238`）—— 页面路由只收 GET/HEAD 且 405 带
  `Allow`、API 只收 POST、HEAD 不写 body。
- `TestAdminPanelRoutes`（`admin_panel_test.go:128`）—— 桌面端 405 / 404 / 路径穿越边界。

**未覆盖的路径**（如实记录，非阻塞）：`_w` 公开页的托管没有被上述用例直接覆盖 ——
公开页与 Mini App 共用 `MiniAppHandler` 的 SPA 回退分支，但 `_w` 路径本身由 `main.webRouter`
组装，不在 `internal/panel` 的测试面内。补一条 `_w` 托管的端到端测试是可选改进，Phase 1 可一并做。

**Phase 0 遇到的坑（全部已修，供后续参考）**

1. **入口名决定 HTML 文件名**：`entry: { main: ... }` 产出 `main.html`，而 Go 硬编码找
   `index.html` —— 入口名必须是 `index`。
2. **模板注释里的 `</head>` 字面量**：rsbuild 的 HTML 插件按字面量查找并替换，会命中注释
   里那一处，把入口脚本**注进注释内部**使它们全部失效 —— 构建成功、无告警、页面全废。
   注释里绝不能出现闭合标签字面量。
3. **SDK 必须留在 `<head>`**：`html.inject` 默认注入到 head 末尾，SDK 放进 `<body>` 就会
   排在入口脚本之后，App 静默落引导页。
4. **资源必须扁平落在 `assets/`**：Go 只对该前缀走 immutable 强缓存，且
   `miniapp_test.go` 断言 `assets/*` 非空、`assets[0]` 不能命中目录。
5. **`rsbuild dev` 会清空 `distPath.root`**：Task 4 引入的回归 —— `npm run dev` 后
   `webdist` 整个变空（含 `.gitkeep`），全新克隆上会导致 `go build` 直接失败。
   修法：dev 的 `distPath.root` 指向 `node_modules/.rsbuild-dev`（dev 产物本就在内存）。
6. **`import.meta.env.VITE_MOCK` 会静默失效**：rsbuild 默认只暴露 `PUBLIC_` 前缀，
   必须在 `loadEnv({ prefixes: ['VITE_'] })` 里显式声明，否则开发 mock 恒为关闭。
7. **`tsconfig` 的 `"types": ["vite/client"]` 是 `import.meta.env` 的类型来源** ——
   删 vite 后不改成 `["@rsbuild/core/types"]`，`tsc -b` 会挂。
8. **`server.base` ≠ `output.assetPrefix`**：Vite 的 `base` 是一个选项管两端，rsbuild
   拆成两个。只迁后者会导致 dev 下路径全错（即上面第 4 条完成标准的问题）。

## 9. 测试策略

**保留 12 个纯逻辑测试**（与组件库无关）：

```
lib/filters · lib/format · lib/selection · lib/settings · lib/status
route.test（Mini App 路由）· admin/route.test（桌面路由）
api/client.test · api/hooks.test（数据层契约）· api/mutations.test
telegram.test（Telegram 桥）
```

**重写 39 个组件/页面测试**，按新结构重建 —— 含 `nav.test.tsx` /
`navUrl.test.tsx`（导航逻辑正确但断言写在 React 渲染里，换组件层后要重写）。
新增：

1. **op 覆盖回归**（功能对齐的守卫）：断言每个页面/视图调用的 op 集合，
   任一端漏掉某操作即变红。这是 §7「两端功能对齐」的唯一自动化保障。
2. **主题与 token**：CSS 变量在亮/暗类下取到预期值（替代原 `theme.test.ts`）。
3. **玻璃层**：`GlassCard` 渲染出噪声/扫光伪元素与三类回退类名（jsdom 不跑
   `backdrop-filter`，断言的是**类名与计算样式契约**，真机效果靠人工验收）。
4. **桌面 data-table**：排序/筛选/分页/批量选择行为。
5. **drill-in 侧栏**：URL 变化驱动侧栏视图切换，返回箭头可回根视图。

沿用现有测试装配思路（`src/test/renderPage.tsx` 的 Provider 栈、MSW handlers、
`fixtures.ts`），但把 MUI 相关的部分换掉。

**人工验收**（自动化覆盖不到，进 bd 工单）：
Telegram 真机 iOS + Android（玻璃在 Safari 的实际观感、滚动不掉帧）、
桌面 Chrome/Firefox/Safari（折射在 Chromium 上是否真的生效）、
弱网（公开页申诉流程）。

## 10. 分期与验收

| Phase | 内容 | 验收标准 |
|---|---|---|
| **0** | rsbuild 迁移 + 5 个前提实测。产物仍被 Go 正常托管，组件暂不动 | `npm run build` 后 `./menshen` 打开三个面都不白屏；Dockerfile 两条 `test -f` 通过 |
| **1** | 设计 token + 玻璃层 + shadcn 基础组件 + 测试装配重建 | 组件预览页在三个面都能开；玻璃三层与三条回退可见 |
| **2** | `/admin` 外壳（drill-in 侧栏）+ 16 视图 + **补 AI 流水页** | 桌面端全功能，op 覆盖测试全绿 |
| **3** | `/miniapp` 外壳（TabBar + 导航栈）+ 18 页面 | TG 真机走完核心链路（开关、处置、申诉、兑换） |
| **4** | 公开页 token 对齐 + 无障碍/响应式/reduced-motion 收尾 | 申诉与入群验证全链路真机通过；三个面视觉统一 |

Phase 之间不留新旧组件共存态（主人选的是「全部页面一次重写」），
但 Phase 0 是个例外：它只换构建器，组件保持 MUI，用来隔离构建链风险。

### 10.1 Phase 1 验收结论（2026-11-06 实测）

**结论：全部 7 条完成标准满足。** 设计系统落地，与现有 MUI 界面并存，未改动任何现有页面。

#### 产出清单

| 路径 | 内容 |
|---|---|
| `src/styles/token.css` | oklch 语义 token（`:root` 亮色 + `.dark` 暗色两套），含 10 个玻璃 token 与 feTurbulence 噪点 data-URI |
| `src/styles/index.css` | Tailwind 入口 + `@theme inline`（保持 `var()` 引用，暗色切换时工具类跟着变）+ `@custom-variant dark` |
| `src/styles/glass.css` | 玻璃 Layer 1（毛玻璃）+ Layer 2（噪点/扫光）+ 三条回退 |
| `src/styles/glass-refract.css` | 玻璃 Layer 3（折射，`@supports` 包裹） |
| `src/lib/utils.ts` | `cn()`（clsx + tailwind-merge） |
| `src/lib/theme-mode.ts` | 亮暗模式解析与订阅（三个面共用） |
| `src/components/glass/` | `Glass` + 四个预设（Card/Panel/Sheet/Toolbar）+ `GlassFilterDefs`（SVG 滤镜定义） |
| `src/components/ui/` | 21 个 shadcn 组件（Button/Badge/Input/…/Table） |
| `src/components/mobile/` | 8 个移动端组件（ListRow/SectionCard/SwitchRow/Segmented/ActionSheet/SearchField/TabBar/TopBar） |
| `src/components/feedback/` | 5 件（Toast/EmptyState/ErrorState/Skeletons/ErrorBoundary） |
| `src/components/preview/` | 组件预览页（dev-only 入口 `/miniapp/_preview`，Phase 4 后删除） |

#### 门禁结果

```
npm run typecheck  → exit 0
npm run test       → 58 files / 472 tests 全绿（Phase 0 结束时 51/339）
npm run lint       → exit 0（2 个既有 warning，非本阶段引入）
npm run build      → 成功；CSS 产物 41.2 KB（含 backdrop-filter、三条回退、glass--refract）
go build / go test ./internal/panel/  → 通过（Go 侧零改动）
```

**测试数 339 → 472（+133）**，且**既有 339 个一个未改** —— 这是「Phase 1 只新增、不破坏」的直接证据。

#### 未改动现有页面（承重验证）

```
git diff --stat <Phase1 base> HEAD -- web/src/pages/ web/src/admin/ web/src/ui/ web/src/public/
→ 仅 main.tsx × 2（各加一行设计系统样式 import）
→ 其余零改动
```

#### 玻璃三层在真实浏览器的表现

| 层 | 实测结果 |
|---|---|
| Layer 1 基线毛玻璃 | `backdrop-filter: blur(20px) saturate(180%)`，移动端降为 12px |
| Layer 2 噪点 + 扫光 | 噪点 SVG data-URI 平铺（opacity 0.03，mix-blend overlay）；扫光 hover/`data-sheen=in` 时显现 |
| Layer 3 折射 | Chromium 上 `url(#menshen-glass-refract)` 生效；**Safari 无位移但仍保留毛玻璃**（平台差异，属预期） |

三条回退均实测存在于产物 CSS：`@supports not (backdrop-filter)` / `prefers-reduced-transparency` / `prefers-reduced-motion`。

#### Phase 1 踩到的三个真实缺陷（都已修）

1. **token 与玻璃层从未进入构建产物** —— 三个入口都没 `import` 样式入口文件。Tailwind 只处理被 import 到的 CSS，于是构建成功、产物里却**没有任何 CSS**，所有新组件无样式且无告警。这个缺陷溜过了两轮人工审查。修法：三个入口各加一行 import（`src/main.tsx` 用 `../`，`src/public/` 与 `src/admin/` 用 `../../`）。**并新增 `src/styles/entry.test.ts` 用断言钉住**，防同类回归。

2. **lightningcss 去前缀导致 Layer 3 折射整条静默失效** —— 同值的标准 + `-webkit-` 两条声明被去重成只留前缀那条，而 Chromium 的 `url()` 形式只认标准属性。表现为 `@supports` 返回 true、选择器匹配、但规则为空。修法：`glass-refract.css` 只写标准属性。

3. **模板注释里的 `</head>` 字面量**（Phase 0 遗留同类）—— rsbuild 的 HTML 插件按字面量替换，会命中注释里那一处，把入口脚本注进注释内部从而使它们失效。

#### 与 new-api 的取舍差异

new-api 的玻璃只用标准 `backdrop-blur`；本设计多了一层**显式 opt-in 的折射**（`.glass--refract`），并按附录 B 的调研结论把它限定在少量静态装饰元素（概览大卡、公开页顶部、空状态），列表与表格区域不用 —— 滚动时每帧重算位移会掉帧。

#### 遗留（不阻塞 Phase 2）

- 若干注释类 Minor（rsbuild 配置的归因注释、`env.d.ts` 一行冗余声明等），已记入 SDD ledger 待 Phase 2 一并处理。
- `Skeletons` 的 `rows` 语义、`ConfirmOptions` 的 `danger` 字段名等**计划文本与旧实现不符**的地方，实现时一律以旧实现为准（已在 ledger 记录）。

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| rsbuild 共享产物目录语义（§8.2 b） | 产物缺一半，Docker 构建失败 | Phase 0 第一步实测，退路明确 |
| iOS Safari 拿不到折射 | 玻璃观感不达预期 | 三层渐进，Layer 2 承担主要观感 |
| 一次性重写量（40 页 + 39 测试） | 中途回归网缺失 | Phase 0 保留可用旧界面；op 覆盖测试先行 |
| Tailwind 4 与 shadcn 的版本组合 | `@theme inline` 不生效 | 前提 d，退路 `@tailwindcss/postcss` |
| Mini App 包体变大（Tailwind + shadcn） | 弱网首屏变慢 | 公开页单独分包；Mini App 路由级懒加载 |

---

## 附录 A：new-api 研究快照（2026-11-05，main 分支）

本地克隆 `QuantumNous/new-api`（`web/`）实测，非在线片段：

**技术栈**：rsbuild 2.1 + Rspack · React 19.2 · Tailwind CSS 4.3 · shadcn/ui
（`style: base-nova`，`iconLibrary: hugeicons`）· Base UI · TanStack
（Query/Router/Table/Virtual）· motion · sonner · zustand · recharts。
**`@douyinfe/semi-ui` 在 `package.json` 与 `src/` 中均已零引用** ——
该仓库已从 Semi 迁走。

**布局**：`SidebarProvider` + 顶栏（`--app-header-height: 3rem`）+ `AppSidebar`
+ `SidebarInset`。侧栏是 **drill-in 模式**（注释自称「Vercel / Cloudflare pattern」）：
URL 驱动侧栏渲染哪个 *view*，点「系统设置」把侧栏整体换成上下文工作区并给
「← Back to Dashboard」，而不是在根树里叠子导航。

**token**：`--radius: 1rem`；颜色全 oklch；`@theme inline` 把
`--color-*` 映射到语义变量；暗色走 `.dark` 类 + `@custom-variant dark (&:is(.dark *))`。
亮色 `--primary: oklch(0.692 0.141 243.716)`，暗色 `--background: oklch(0.235 0 0)`。
另有主题预设体系（`data-theme-preset`：underground / rose-garden / lake-view /
sunset-glow / forest-whisper / ocean-breeze / lavender-dream / anthropic 等）
与字体/圆角轴（`data-theme-font` / `data-theme-radius`）。

**玻璃**：标准 `backdrop-blur-2xl` + `bg-background/60` + `ring-[0.5px]` +
多层阴影，**带 `supports-[backdrop-filter]:` 守卫**（如
`bg-background/95 supports-[backdrop-filter]:bg-background/80`）。
**没有用 SVG 折射** —— 与本设计 §4.1 的平台结论一致。

**值得借鉴的其他点**：cmd+K 命令面板（`CommandMenu`）· 页面过渡
（`AnimatedOutlet` + `MOTION_VARIANTS`，含 `useReducedMotion` 分支）·
`SkipToMain` 无障碍跳转 · `data-table/` 分层（`core`/`layout`/`toolbar`/`static`/`hooks`，
`layout/` 里含 `mobile-card-list.tsx` 做响应式降级）· features 目录划分
（每域 `index.tsx` + `components/` + `api.ts` + `hooks/` + `types.ts`）。

## 附录 B：玻璃方案调研结论（2026-11-05，实测绘 source）

对真实存在的液态玻璃复现项目逐个核实（star 数、License、最后 push 为实测值）：

| Repo | ★ | License | 最后 push | 技术路线 |
|---|---|---|---|---|
| `rdev/liquid-glass-react` | 6609 | MIT | 2025-06-13 | SVG `feDisplacementMap` 位移**元素自身** + 原生 `backdrop-filter` |
| `naughtyduk/liquidGL` | 1044 | NOASSERTION | 2026-10-01 | WebGPU→WebGL2→WebGL1→CSS 四级降级，自建背景 rasteriser |
| `ybouane/liquidglass` | 595 | 无 | 2026-09-30 | WebGL2 着色器 + `html-to-image`(SVG foreignObject) 截图 |
| `VII-Cae/hyalite--liquid-glass` | 260 | MIT | 2026-09-11 | SDF lens map → SVG filter → **`backdrop-filter: url()`**，单文件无构建 |
| `Muggleee/liquid-glass` | 166 | 无 | 2025-06-25 | WebGL2 + GLSL ES 3.0 + SDF，Vue 3 专属 |
| `Oliverrr2424/webgl-apple-liquid-glass` | 146 | MIT | 2026-09-29 | WebGL2，squircle SDF → Snell 折射 |

npm 周下载：`liquid-glass-react` 36,234；`liquid-gl` 3,387。
`@liquid-glass/react`、`liquidglass` 两个包名 **npm 上不存在（404）**。

### B.1 兼容性真相（决定 §4 三层设计的依据）

**WebKit Bugzilla #245510**：`backdrop-filter: url(#some-svg-filter) doesn't work
with SVG filters like feDisplacementMap` —— 创建于 2022-09-21，状态一直是 **NEW**，
**四年未修**。另一条 **#297770**「`filter: url()` ignored when backdrop-filter
applied」状态 **REOPENED**。

上游项目自己在源码里写死了这个结论。`hyalite` 的检测逻辑：

```js
const css = CSS.supports('backdrop-filter','url(#x)') ||
            CSS.supports('-webkit-backdrop-filter','url(#x)');
const chromium = uad?.brands?.some(b => /Chromium/i.test(b.brand)) ?? ...;
supportedMemo = !!(css && chromium);   // 必须同时是 Chromium
```

`liquid-glass-react` 的 README 也自认：

> **⚠️ NOTE:** Safari and Firefox only partially support the effect
> (**displacement will not be visible**)

**结论**：iOS Safari（Telegram Mini App 主战场）上 SVG 位移路线的折射拿不到，
只会退化成普通模糊。这是平台级限制，不是选型能绕过的。

### B.2 各方案对本项目的适用性

| 方案 | 判断 |
|---|---|
| `hyalite` 思路（`backdrop-filter: url()` + 特性检测） | **适合 Layer 3**：单文件无构建、MIT、自带降级。可直接借鉴其检测写法与 SDF lens map |
| `liquid-glass-react` | **不适合**：它位移的是元素自身而非折射背景，语义上不是真玻璃；且 issue 里 Chrome 上都时好时坏 |
| `liquidGL` | **不适合**：折射的是**自己截的背景快照**（README 要求 `snapshot: "body"`），bundle 297KB，且要求元素 fixed/sticky 定位 |
| `ybouane/liquidglass` | **不适合**：动态内容（`data-dynamic`）**每帧重截 DOM**。本项目是实时数据后台（列表/表格/日志），性能不可接受 |
| WebGL 截屏类（以上两者） | **与产品形态冲突**：整条路线建立在「背景可被静态捕获」之上 |

**关键取舍**：本项目是动态数据后台，所有 WebGL 截屏类方案都要求背景可静态捕获，
与产品形态直接冲突。所以真折射只作为**增强层**用在少量静态装饰元素
（概览首屏大卡、公开页顶部、空状态插画），列表与表格区域用基线毛玻璃。

**未找到的证据**：没有任何项目给出 iOS 电量/发热的实测数据 —— 这一点是不确定的，
不作为论据。真实性能反馈只有 issue 层面的掉帧报告
（`rdev/liquid-glass-react`：#3 frame drops、#16 effects not working in Chrome、
#29 shader mode does not work 等）。
