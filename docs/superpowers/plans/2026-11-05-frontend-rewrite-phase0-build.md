# 前端重写 Phase 0：构建链迁移（Vite → Rsbuild）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `web/` 的构建器从 Vite 换成 Rsbuild 2，产物仍落 `internal/panel/webdist` 并被 Go `go:embed` 正常托管，本阶段**不改任何组件**（UI 保持 MUI，功能不变）。

**Architecture:** 两个 rsbuild 配置对应现有两个 Vite 配置（Mini App 三入口 / 桌面面板单入口），都输出到同一个 `webdist` 目录。靠 `cleanDistPath` 的先后顺序实现共享产物目录 —— 这是本阶段唯一的技术难点，也是唯一可能「构建成功但产物缺一半」的失效点。

**Tech Stack:** Rsbuild 2.x（Rspack）· `@rsbuild/plugin-react` · `@rsbuild/plugin-tailwindcss` · Tailwind CSS 4 · React 19 · TypeScript 6

**Spec:** `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md`（§8 构建链迁移、§10 Phase 0）

## Global Constraints

- **产物路径不变**：`web/` → `../internal/panel/webdist`。Go 侧 `internal/panel/miniapp_embed.go` 的 `//go:embed all:webdist`、`webdist/.gitkeep`（入库占位，保证未构建时 `go build` 不失败）都不许动。
- **`npm run build` 语义不变**：一条命令产出 `index.html` + `public.html` + `admin.html` 三个入口页。Dockerfile 的两条断言必须继续通过：
  - `test -f /internal/panel/webdist/index.html`
  - `test -f /internal/panel/webdist/admin.html`
- **`assetPrefix` 必须分别是 `/miniapp/` 与 `/admin/`**：Go 侧按这两个前缀托管静态资源（`miniAppAsset` / `adminAsset`），前缀错了资源 404。
- **本阶段保留全部 MUI 代码**：不删 `@mui/*`、不改 `src/` 下任何组件。Phase 0 的唯一变量是构建器。
- **`telegram-web-app.js` 必须早于 `src/main.tsx` 执行**：它是经典同步脚本，`main.tsx` 是模块脚本（默认 defer）。这是 CLAUDE.md 记录的静默失效点 —— SDK 晚于应用启动时，App 落引导页而不报错。
- **Node ≥ 22.12**（`package.json` engines 已声明）。
- 前端单测/类型检查是 CI 门禁：`npm run test`、`npm run typecheck` 必须全绿。

## 文件结构

| 文件 | 职责 |
|---|---|
| `web/rsbuild.config.ts` | Mini App + 公开页构建（entries `main` / `public`，assetPrefix `/miniapp/`） |
| `web/rsbuild.admin.config.ts` | 桌面面板构建（entry `admin`，assetPrefix `/admin/`） |
| `web/package.json` | scripts 与依赖（`build` 仍是一条命令串两次构建） |
| `web/index.html` `web/public.html` `web/admin.html` | 模板：去掉手写 `<script>`，交给 rsbuild 注入 |
| `web/vite.config.ts` `web/vite.admin.config.ts` | **删除** |
| `web/tailwind.css`（暂名） | Phase 1 才真正使用；本阶段只让插件能编译通过 |

**顺序约束**：Mini App 配置必须先构建（它负责清理目录），桌面配置后构建（`cleanDistPath: false`，不许碰已产出的文件）。

---

## Task 1: 实测 Rsbuild 共享产物目录语义

> **这是 spike 性质的验证任务。** 结论若为「不可行」，本计划的 Task 2-5 换用退路方案（见 Task 1 Step 6），再继续。

**Files:**
- Create: `web/rsbuild.probe.config.ts`（临时实验配置，本任务结束前删除）

**Interfaces:**
- Consumes: 无
- Produces: 一个明确结论 —— `output.distPath.root` 能否跨目录、`cleanDistPath` 的两次构建语义。后续 Task 2/3 依赖这个结论决定配置写法。

- [ ] **Step 1: 装依赖**

```bash
cd web
npm install -D @rsbuild/core@^2 @rsbuild/plugin-react@^2 @rsbuild/plugin-tailwindcss@^2
npm install -D tailwindcss@^4
```

- [ ] **Step 2: 写实验配置**

创建 `web/rsbuild.probe.config.ts`：

```ts
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

// 实验：验证 output.distPath.root 能否指向项目外目录。
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { probe: './probe-entry.tsx' } },
  html: { template: './probe.html' },
  output: {
    distPath: { root: '../internal/panel/webdist' },
    cleanDistPath: false,
  },
})
```

同时创建两个临时文件：

`web/probe-entry.tsx`：
```tsx
import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')!).render(<div>probe</div>)
```

`web/probe.html`：
```html
<!doctype html>
<html><body><div id="root"></div></body></html>
```

- [ ] **Step 3: 跑构建，验证跨目录**

```bash
cd web && npx rsbuild build -c rsbuild.probe.config.ts
ls -la ../internal/panel/webdist/probe.html
```

Expected: `probe.html` 存在。
**若失败**（报路径必须在项目内 / 报 `distPath.root` 非法）→ 退路：输出到 `web/dist`，在 `package.json` 的 build 脚本末尾加一步 `node scripts/copy-dist.mjs` 拷贝到 `webdist`。把这个结论记下，Task 2/3 改用退路写法。

- [ ] **Step 4: 验证共享目录语义（关键）**

先造一个「第一个构建的产物」，再跑第二个构建，看它会不会被清掉：

```bash
cd web
# 模拟「Mini App 先构建」：留一个 index.html 在产物目录
touch ../internal/panel/webdist/index.html
# 模拟「桌面端后构建」，故意把 cleanDistPath 设成 true
sed -i.bak 's/cleanDistPath: false/cleanDistPath: true/' rsbuild.probe.config.ts
npx rsbuild build -c rsbuild.probe.config.ts
ls ../internal/panel/webdist/index.html
```

Expected: `index.html` **已被删除**（证明 `cleanDistPath: true` 会清空整个目录，包括其他构建的输出）。

这就是 §8.2 的失效模式 b。结论：**后构建的那个配置必须 `cleanDistPath: false`**。

```bash
# 还原探针配置
mv rsbuild.probe.config.ts.bak rsbuild.probe.config.ts
```

- [ ] **Step 5: 验证首次构建清理是否安全**

```bash
cd web
sed -i.bak 's/cleanDistPath: false/cleanDistPath: true/' rsbuild.probe.config.ts
npx rsbuild build -c rsbuild.probe.config.ts
ls ../internal/panel/webdist/
```

Expected: 只有 `probe.html` 与 `static/`（`.gitkeep` 被清掉了 —— 这没关系，Task 2 的插件会回写它）。

- [ ] **Step 6: 记录结论并清理**

把三条结论写进 `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md` 的 §8.2 表格（把「待验证」改成实测结果）：

1. `output.distPath.root: '../internal/panel/webdist'` 是否可行
2. `cleanDistPath: true` 是否清空目录（含他人产物）
3. 首次构建（Mini App）用 `true`、后置构建（桌面）用 `false` 是否正确

```bash
cd web
rm -f rsbuild.probe.config.ts rsbuild.probe.config.ts.bak probe-entry.tsx probe.html
cd .. && git status --short web/ internal/panel/webdist/
```

Expected: 只留下 `package.json` / `package-lock.json` 的改动；`webdist` 里只有 `.gitkeep`。

- [ ] **Step 7: Commit**

```bash
cd /Users/ll/code/menshen
git add web/package.json web/package-lock.json docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md
git commit -m "web: 验证 rsbuild 共享产物目录语义，装 rsbuild 依赖"
```

---

## Task 2: Mini App 的 Rsbuild 配置

**Files:**
- Create: `web/rsbuild.config.ts`
- Modify: `web/index.html`、`web/public.html`（去掉手写 script，交给 rsbuild 注入）
- Create: `web/tailwind.css`（本阶段只求编译通过，Phase 1 才填 token）

**Interfaces:**
- Consumes: Task 1 的结论（`distPath.root` 写法、`cleanDistPath: true`）
- Produces: `npm run build:miniapp` 产出 `webdist/index.html` + `webdist/public.html`
- Produces: `web/tailwind.css` —— Phase 1 的 Task 6/7 会往这个文件里填 `@theme inline` 与 token import

- [ ] **Step 1: 改造 HTML 模板**

rsbuild 会自动注入入口脚本，模板里的手写 `<script>` 要删掉，否则会重复执行。

`web/index.html` 改为：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no"
    />
    <title>门神配置</title>
  </head>
  <body>
    <div id="root"></div>
    <!-- 官方 SDK 自托管：部分网络无法直连官方 CDN，不能依赖外链加载。
         由 rsbuild 从 public/ 复制到产物根，经 assetPrefix /miniapp/ 引用。
         经典脚本同步执行，模块脚本默认 defer，因此 main.tsx 启动时 SDK 已就绪；
         telegram.ts 仍保留轮询兜底。
         注意：本标签必须留在 <head>，rsbuild 注入的入口脚本是 defer 的模块，
         不会抢在它前面执行。 -->
    <script src="/telegram-web-app.js"></script>
  </body>
</html>
```

`web/public.html` 改为：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>门神</title>
  </head>
  <body>
    <div id="root"></div>
    <!-- 公开网页入口：申诉验证（ap）、原文查看（v）、申诉详情（apv）。
         数据走 _w 下的 ?json=1 接口，壳由 Go 在页面路由上直接托管。 -->
  </body>
</html>
```

- [ ] **Step 2: 建 Tailwind 入口占位**

`web/tailwind.css`：

```css
@import "tailwindcss";

/* Phase 1 会在这里加 @theme inline 与 token import（设计文档 §3、§4）。
   本阶段只求 Tailwind 管线跑通。 */
```

- [ ] **Step 3: 建 rsbuild 配置**

**先注意环境变量**：现有代码用 `import.meta.env.VITE_MOCK` 与 `import.meta.env.BASE_URL`（Vite 专有）。rsbuild 默认只暴露 `PUBLIC_` 前缀的变量，**不改配置的话 `VITE_MOCK` 恒为 undefined —— 开发 mock 静默失效**，表现是页面空白但不报错。所以配置里要显式声明 `VITE_` 前缀。

`web/rsbuild.config.ts`：

```ts
import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RsbuildPlugin } from '@rsbuild/core'

const OUT_DIR = resolve(import.meta.dirname, '../internal/panel/webdist')

// 产物目录要始终保留一个占位文件：go:embed all:webdist 要求目录非空，而
// 产物本身不入库；没有它时全新克隆的 go build / go test 会直接编译失败。
// 本配置的 cleanDistPath 会清空整个目录，所以必须构建结束时把 .gitkeep 写回。
function keepWebdistPlaceholder(): RsbuildPlugin {
  return {
    name: 'menshen-webdist-placeholder',
    setup(api) {
      api.onAfterBuild(() => {
        mkdirSync(OUT_DIR, { recursive: true })
        writeFileSync(resolve(OUT_DIR, '.gitkeep'), '')
      })
    },
  }
}

export default defineConfig(({ envMode }) => {
  // 现有代码用 import.meta.env.VITE_MOCK 控制开发 mock（msw）。rsbuild 默认
  // 只暴露 PUBLIC_ 前缀，不显式声明 VITE_ 的话它恒为 undefined，mock 静默失效。
  const { publicVars } = loadEnv({ mode: envMode, prefixes: ['VITE_'] })

  return {
    plugins: [pluginReact(), pluginTailwindcss({ optimize: false }), keepWebdistPlaceholder()],
    source: {
      // 两个入口：main 是 Telegram Mini App；public 是申诉验证、原文查看、
      // 申诉详情等公开网页（_w 路由），单独分包避免公开页加载整个管理端。
      entry: {
        main: './src/main.tsx',
        public: './src/public/main.tsx',
      },
      define: publicVars,
    },
    html: {
      // 每个入口用各自的模板；缺省回落到 index.html。
      template({ entryName }) {
        return entryName === 'public' ? './public.html' : './index.html'
      },
    },
    output: {
      // 产物直接落到 Go 侧 go:embed 的目录（该目录不入库，由 Docker/CI 或本地
      // npm run build 生成）。
      distPath: { root: OUT_DIR },
      // Mini App 先构建：清空是安全的，还能清掉上次构建的陈旧文件。
      // 桌面面板（rsbuild.admin.config.ts）必须为 false，否则会删掉这里的产物。
      cleanDistPath: true,
      assetPrefix: '/miniapp/',
      // public/ 随产物复制：telegram-web-app.js 与 mockServiceWorker.js（见 Task 4）。
      copy: [{ from: 'public', to: '' }],
    },
    server: {
      // 本地开发把 API 代理到 Go 服务（默认监听 127.0.0.1:8081）。
      proxy: { '/miniapp/api': 'http://127.0.0.1:8081' },
    },
  }
})
```

**`import.meta.env.BASE_URL` 无处可去**：rsbuild 不提供它（等价物是 `import.meta.env.PUBLIC_PATH`，但仅当配置 `output.assetPrefix` 时可读）。`src/mocks/index.ts` 的用法在 Task 4 Step 2 改成常量。

- [ ] **Step 4: 加构建脚本并验证**

`web/package.json` 的 scripts 加一行（先加 miniapp，Task 4 再统一）：

```json
"build:miniapp": "rsbuild build -c rsbuild.config.ts"
```

```bash
cd web && npm run build:miniapp
ls ../internal/panel/webdist/
```

Expected: 存在 `index.html`、`public.html`、`.gitkeep`、`telegram-web-app.js`、`static/`（或 `assets/`）。

- [ ] **Step 5: 验证 assetPrefix 与 SDK 顺序**

```bash
cd /Users/ll/code/menshen
# 资源引用必须是 /miniapp/ 前缀
grep -o 'src="[^"]*"' internal/panel/webdist/index.html | head -3
grep -o 'href="[^"]*"' internal/panel/webdist/index.html | head -3
```

Expected: 引用形如 `/miniapp/static/...`。

```bash
# SDK 必须出现在入口脚本之前
grep -n 'telegram-web-app.js\|static/' internal/panel/webdist/index.html
```

Expected: `telegram-web-app.js` 所在行号 **小于** 入口脚本所在行号。

- [ ] **Step 6: 验证 Go 侧托管正常**

```bash
cd /Users/ll/code/menshen
CGO_ENABLED=0 go build -o /tmp/menshen-probe .
go test ./internal/panel/ -run TestMiniApp -count=1
```

Expected: 编译通过、测试通过。

- [ ] **Step 7: Commit**

```bash
cd /Users/ll/code/menshen
git add web/rsbuild.config.ts web/tailwind.css web/index.html web/public.html web/package.json
git commit -m "web: Mini App 与公开页改用 rsbuild 构建"
```

---

## Task 3: 桌面面板的 Rsbuild 配置

**Files:**
- Create: `web/rsbuild.admin.config.ts`
- Modify: `web/admin.html`（去掉手写 script）

**Interfaces:**
- Consumes: Task 2 的 `webdist`（本任务必须**不动**它的产物）
- Produces: `npm run build:admin` 产出 `webdist/admin.html`

- [ ] **Step 1: 改造 admin.html**

`web/admin.html` 改为：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>门神管理面板</title>
  </head>
  <body>
    <div id="root"></div>
    <!-- 桌面端管理面板的独立入口：不加载 Telegram SDK，鉴权走会话 cookie。
         产物由 Go 在 /admin 下托管（internal/panel/admin_panel.go）。 -->
  </body>
</html>
```

- [ ] **Step 2: 建桌面配置**

`web/rsbuild.admin.config.ts`：

```ts
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RsbuildPlugin } from '@rsbuild/core'

const OUT_DIR = resolve(import.meta.dirname, '../internal/panel/webdist')

// 与 rsbuild.config.ts 同一份产物目录；本配置不清理目录（见 cleanDistPath），
// 所以 .gitkeep 由 Mini App 那次构建负责写回，这里只在它缺失时补一次，
// 保证单独跑 `npm run build:admin` 时目录也非空（go:embed 需要）。
function ensureWebdistPlaceholder(): RsbuildPlugin {
  return {
    name: 'menshen-admin-webdist-placeholder',
    setup(api) {
      api.onAfterBuild(() => {
        mkdirSync(OUT_DIR, { recursive: true })
        writeFileSync(resolve(OUT_DIR, '.gitkeep'), '')
      })
    },
  }
}

export default defineConfig({
  plugins: [pluginReact(), pluginTailwindcss({ optimize: false }), ensureWebdistPlaceholder()],
  source: { entry: { admin: './src/admin/main.tsx' } },
  html: { template: './admin.html' },
  output: {
    // outDir 与 Mini App 共用 webdist（Go 只 go:embed 一个目录），所以
    // cleanDistPath 必须为 false —— 否则会把先构建好的 index.html 清掉。
    // package.json 里保证先跑 Mini App 构建（build:miniapp），再跑本配置。
    distPath: { root: OUT_DIR },
    cleanDistPath: false,
    assetPrefix: '/admin/',
    // public/ 不复制：那里只有 Mini App 自托管的 telegram-web-app.js。
  },
  server: {
    proxy: { '/admin/api': 'http://127.0.0.1:8081' },
  },
})
```

- [ ] **Step 3: 加脚本并验证「不清掉 Mini App 产物」**

`web/package.json` 加：

```json
"build:admin": "rsbuild build -c rsbuild.admin.config.ts"
```

```bash
cd web
npm run build:miniapp && npm run build:admin
ls ../internal/panel/webdist/
```

Expected: `index.html`、`public.html`、`admin.html` **三者同时存在**。
**若 `index.html` 消失** → Task 1 的结论被推翻，检查 `cleanDistPath` 是否为 `false`。

- [ ] **Step 4: 验证桌面 panel 的 assetPrefix**

```bash
cd /Users/ll/code/menshen
grep -o 'src="[^"]*"\|href="[^"]*"' internal/panel/webdist/admin.html | head -5
```

Expected: 引用形如 `/admin/static/...`。

- [ ] **Step 5: 跑 Go 侧的桌面面板测试**

```bash
cd /Users/ll/code/menshen
go test ./internal/panel/ -run TestAdmin -count=1
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
cd /Users/ll/code/menshen
git add web/rsbuild.admin.config.ts web/admin.html web/package.json
git commit -m "web: 桌面管理面板改用 rsbuild 构建，共享 webdist"
```

---

## Task 4: 切换 build 脚本、删除 Vite 配置

**Files:**
- Modify: `web/package.json`（`build` 串两次构建；删 vite 相关依赖与脚本）
- Delete: `web/vite.config.ts`、`web/vite.admin.config.ts`
- Modify: `web/src/mocks/index.ts`（若 MSW worker 依赖 Vite 中间件，改走 `public/`）

**Interfaces:**
- Consumes: Task 2/3 的 `build:miniapp`、`build:admin`
- Produces: 一条 `npm run build` 产出全部三个入口页 —— Dockerfile/CI 依赖这个契约

- [ ] **Step 1: 写 `build` 脚本**

`web/package.json` 的 scripts 改成：

```json
"scripts": {
  "dev": "rsbuild dev -c rsbuild.config.ts",
  "dev:admin": "rsbuild dev -c rsbuild.admin.config.ts",
  "build:miniapp": "rsbuild build -c rsbuild.config.ts",
  "build:admin": "rsbuild build -c rsbuild.admin.config.ts",
  "build": "tsc -b && npm run build:miniapp && npm run build:admin",
  "lint": "oxlint",
  "typecheck": "tsc -b",
  "test": "vitest run",
  "test:watch": "vitest",
  "preview": "rsbuild preview -c rsbuild.config.ts"
}
```

顺序不能调换：`build:miniapp` 负责清目录，`build:admin` 不能清。

- [ ] **Step 2: 处理 MSW worker 与 import.meta.env 类型**

三处依赖 Vite 专有设施，都要改：

**(a) `import.meta.env` 的类型来源**。`web/tsconfig.app.json` 当前是：

```json
"types": ["vite/client"],
```

删掉 vite 后这个类型包消失，`import.meta.env.VITE_MOCK` 会直接变成**类型错误**（`tsc -b` 挂 → `npm run build` 挂 → CI 挂）。改成 rsbuild 的等价物：

```json
"types": ["@rsbuild/core/types"],
```

并在 `web/src/env.d.ts`（新建）声明我们实际用到的变量：

```ts
/// <reference types="@rsbuild/core/types" />

// 开发期 mock 开关（VITE_MOCK=1），由 rsbuild.config.ts 的 loadEnv 注入。
interface ImportMetaEnv {
  readonly VITE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

**(b) MSW worker 文件不进产物**。现有 `vite.config.ts` 的 `mswWorkerPlugin` 把一个不存在于 `public/` 的 worker 文件从依赖里送到 `/miniapp/mockServiceWorker.js`。rsbuild 的 `copy` 只复制真实存在的文件，所以把它拷进 `public/`：

```bash
cd web
cp node_modules/msw/mockServiceWorker.js public/mockServiceWorker.js
```

`public/` 下的文件会随 `copy: [{ from: 'public', to: '' }]` 进产物根，开发与构建都可用。

**入库决策**：这是 msw 依赖里的生成文件。选择入库（与现有 `telegram-web-app.js` 入库的自托管思路一致），代价是升级 msw 时要知道它不会自动更新 —— 在文件头部加一行注释说明来源与更新方式。

**(c) `BASE_URL` 改写**。`web/src/mocks/index.ts` 当前：

```ts
serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
```

rsbuild 不提供 `BASE_URL`。Mini App 的 assetPrefix 是固定常量 `/miniapp/`，直接写死比读环境变量更稳：

```ts
// rsbuild 不提供 Vite 的 BASE_URL；Mini App 的 assetPrefix 固定为 /miniapp/
// （见 rsbuild.config.ts），这里写常量即可。
serviceWorker: { url: '/miniapp/mockServiceWorker.js' },
```

- [ ] **Step 3: 删除 Vite 配置与依赖**

```bash
cd web
rm -f vite.config.ts vite.admin.config.ts
npm uninstall vite @vitejs/plugin-react
```

注意 `vitest` 仍在用（Phase 1-4 都要跑测试），**不要**卸载 vitest。vitest 不再从 `vite.config.ts` 读配置，所以要在 `package.json` 加最小 vitest 配置（见 Step 4）。

- [ ] **Step 4: 迁移 vitest 配置**

原 `vite.config.ts` 里有：

```ts
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test/setup.ts'],
}
```

新建 `web/vitest.config.ts` **完整内容**（`@vitejs/plugin-react` 已在 Step 3 卸载，测试走 vitest 自带的 esbuild transform，不需要 React 插件）：

```ts
import { defineConfig } from 'vitest/config'

// 测试环境配置：environment 与 setupFiles 与原 vite.config.ts 一致。
// 测试不依赖 rsbuild（vitest 自带 transform），所以这里只声明环境。
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

同时删掉 `web/tsconfig.node.json:23` 里对已删文件的引用 —— 当前的 include 是：

```json
"include": ["vite.config.ts", "vite.admin.config.ts"]
```

改成指向新的构建配置：

```json
"include": ["rsbuild.config.ts", "rsbuild.admin.config.ts", "vitest.config.ts"]
```

不改进程的话 `tsc -b` 会报找不到文件。`tsconfig.app.json` 的 `types` 改动见 Step 2(a)。

- [ ] **Step 5: 跑全套验证**

```bash
cd web
npm run build 2>&1 | tail -20
ls ../internal/panel/webdist/ | grep -E 'index.html|public.html|admin.html'
npm run typecheck
npm run test 2>&1 | tail -15
npm run lint
```

Expected:
- build 成功，三个 html 全在
- typecheck 无错
- test 全绿（51 个文件，本阶段组件未改，测试应当**一个都不用改**）
- lint 无错

**若测试变红** → 多半是 `import.meta.env.BASE_URL` 之类的 Vite 专有环境变量在测试里失效。搜索 `BASE_URL`、`import.meta.env` 并替换。

- [ ] **Step 6: 验证 Dockerfile / CI 契约**

```bash
cd /Users/ll/code/menshen
# Dockerfile 的两条断言
test -f internal/panel/webdist/index.html && echo "index OK"
test -f internal/panel/webdist/admin.html && echo "admin OK"
# 未构建时的编译兜底（.gitkeep 在位）
git stash list >/dev/null; ls internal/panel/webdist/.gitkeep
```

Expected: 两条 OK + `.gitkeep` 存在。

- [ ] **Step 7: Commit**

```bash
cd /Users/ll/code/menshen
git add -A web/
git commit -m "web: build 脚本切到 rsbuild，删除 vite 配置"
```

---

## Task 5: 端到端验收（构建链）

**Files:**
- 无新增；只做验证与文档更新

**Interfaces:**
- Consumes: Task 1-4 的全部产出
- Produces: Phase 0 的验收结论 —— 决定 Phase 1 能否开始

- [ ] **Step 1: 全新克隆模拟（最重要的一条）**

`.gitkeep` 是「未构建也能编译」的唯一保障，必须验证它还在且未被 gitignore 掉：

```bash
cd /Users/ll/code/menshen
git ls-files internal/panel/webdist/
cat .gitignore | grep -n webdist
```

Expected: `.gitkeep` 在 git 索引里；`.gitignore` 排除了 `webdist/*` 但**保留了 `.gitkeep`**（若是 `webdist/` 整体排除，`.gitkeep` 也进不去，需要加 `!internal/panel/webdist/.gitkeep`）。

- [ ] **Step 2: 无产物状态下编译**

```bash
cd /Users/ll/code/menshen
mv internal/panel/webdist /tmp/webdist-backup
mkdir -p internal/panel/webdist && touch internal/panel/webdist/.gitkeep
CGO_ENABLED=0 go build -o /tmp/menshen-noasse t . && echo "无产物编译 OK"
rm -rf internal/panel/webdist && mv /tmp/webdist-backup internal/panel/webdist
```

Expected: 编译成功（这正是「全新克隆」的状态）。

- [ ] **Step 3: 起服务实测三个面**

```bash
cd /Users/ll/code/menshen
CGO_ENABLED=0 go build -o /tmp/menshen-phase0 .
# 用一份最小配置起服务（webhook 模式，public_url 指向本地）
```

用 agent-browser（CloakBrowser）或 curl 验证：

```bash
# Mini App 入口页
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/miniapp
curl -s http://127.0.0.1:8081/miniapp | grep -o 'static/[^"]*' | head -3
# 静态资源可达
# 桌面面板入口页
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/admin
# 公开页
curl -s -o /dev/null -w "%{http_code}\n" 'http://127.0.0.1:8081/_w/demo/1/x'
```

Expected: 三个都 200，Mini App 页面里的资源引用是 `/miniapp/static/...`。

- [ ] **Step 4: 浏览器实测（功能不变的基线）**

用 agent-browser 打开 `/admin`，登录后确认：概览、机器人、群组、记录、设置页都能正常打开与操作 —— **本阶段 UI 应当与改造前完全一致**。

```bash
cd /Users/ll/code/menshen
# 起一个带 mock 的前端 dev server 做冒烟（不依赖 TG 会话）
cd web && VITE_MOCK=1 npm run dev &
sleep 8
```

用 agent-browser 打开 `http://127.0.0.1:3000/miniapp/`，确认页面渲染、console 无错误。

- [ ] **Step 5: 更新设计文档的验收记录**

在 `docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md` 的 §8.2 表格下方补一段「Phase 0 实测结论」，记录：

- 五条前提各自的实测结果（成立 / 走了哪条退路）
- 构建耗时对比（Vite vs Rsbuild，各跑一次取秒数）
- 遇到的所有坑

- [ ] **Step 6: Commit**

```bash
cd /Users/ll/code/menshen
git add docs/superpowers/specs/2026-11-05-frontend-rewrite-design.md
git commit -m "docs: 记录前端 Phase 0 构建链迁移的实测结论"
```

---

## Phase 0 完成标准

全部满足才能进 Phase 1：

1. `npm run build` 一条命令产出 `index.html` + `public.html` + `admin.html`
2. `npm run typecheck` / `npm run test` / `npm run lint` 全绿（**测试文件一个都不用改**）
3. `CGO_ENABLED=0 go build .` 在有产物与无产物（只剩 `.gitkeep`）两种状态下都成功
4. `/miniapp`、`/admin`、`/_w/*` 三个面在浏览器里打开正常，**功能与改造前一致**
5. `web/vite.config.ts`、`web/vite.admin.config.ts` 已删除；`vite`、`@vitejs/plugin-react` 已从依赖移除
6. `internal/panel/webdist/.gitkeep` 在 git 索引中，`.gitignore` 未把它排掉
7. 设计文档 §8.2 已写入实测结论

## 本阶段之后

Phase 1（设计系统：token / 玻璃层 / shadcn 基础组件）的计划单独写 —— 它定义 Phase 2/3 所有页面要 import 的组件接口，等 Phase 0 落地、`tailwind.css` 就位后再写，避免凭空猜测接口名。
