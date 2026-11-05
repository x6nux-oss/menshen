import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RsbuildPlugin } from '@rsbuild/core'

const OUT_DIR = resolve(import.meta.dirname, '../internal/panel/webdist')

// dev 专用的产物目录：与 rsbuild.config.ts 同一考量 —— 开发不应往 go:embed 的
// webdist 里写东西。本配置 cleanDistPath: false 不会清目录，但 dev 仍会把
// admin.html 与 dev 模式的 assets 写进 webdist，之后 `go build` 就会把带开发
// overlay 的产物嵌进二进制。指到 node_modules 下的临时目录即可避免。
const DEV_OUT_DIR = resolve(import.meta.dirname, 'node_modules/.rsbuild-dev-admin')

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

export default defineConfig(({ command }) => ({
  plugins: [pluginReact(), pluginTailwindcss({ optimize: false }), ensureWebdistPlaceholder()],
  source: {
    // 单入口：管理面板。入口名必须是 admin —— rsbuild 按入口名产出 HTML
    // （[name].html），而 Go 侧硬编码读 webdist/admin.html（admin_panel.go 的
    // adminIndex），Dockerfile 也断言 test -f admin.html。
    // Mini App 的 index/public 由 rsbuild.config.ts 构建。
    entry: { admin: './src/admin/main.tsx' },
  },
  html: { template: './admin.html' },
  output: {
    // outDir 与 Mini App 共用 webdist（Go 只 go:embed 一个目录），所以
    // cleanDistPath 必须为 false —— 否则会把先构建好的 index.html 清掉。
    // package.json 里保证先跑 Mini App 构建（build:miniapp），再跑本配置。
    // dev 走 DEV_OUT_DIR（见文件头的说明），不碰 go:embed 的产物目录。
    distPath: {
      root: command === 'dev' ? DEV_OUT_DIR : OUT_DIR,
      // 目录布局落在扁平的 assets/ 下，与 rsbuild.config.ts 一致：Go 侧只对
      // /admin/assets/* 走 immutable 强缓存（admin_panel.go 的 adminAsset），
      // 其余路径只有 max-age=3600。沿用 rsbuild 默认的 static/js 会让带内容
      // 哈希的产物失去长缓存的意义。两份产物共用 assets/ 目录无冲突：
      // 文件名带内容哈希，同内容同名同内容，覆盖无副作用。
      js: 'assets',
      jsAsync: 'assets',
      css: 'assets',
      cssAsync: 'assets',
      assets: 'assets',
    },
    cleanDistPath: false,
    assetPrefix: '/admin/',
    // public/ 不做任何显式配置：rsbuild 默认把 public/ 复制到产物根，所以
    // telegram-web-app.js 也会出现在这里 —— 与 Mini App 那次构建的产物同名
    // 同内容，被覆盖无副作用（该文件只由 Mini App 的 index.html 引用）。
  },
  server: {
    // dev server 的 URL 基路径。与 output.assetPrefix 是两回事（Vite 的 base
    // 一个选项管两端，rsbuild 拆成两个）：只设 assetPrefix 会让 dev 下应用挂在
    // 根路径 /，与运行时代码硬编码的 /admin/ 前缀不匹配。
    base: '/admin/',
    // 入口名是 admin，rsbuild dev 按入口名给 URL（/admin/admin），而 /admin/ 会 404。
    // 生产由 Go 做同样的回退（admin_panel.go 的 adminDistFile + adminIndex），
    // 所以 dev 也要有：否则本地开发打不开 /admin/，刷新与深链全部 404。
    historyApiFallback: { index: '/admin.html' },
    // 本地开发把面板 API 代理到 Go 服务（默认监听 127.0.0.1:8081）。
    proxy: { '/admin/api': 'http://127.0.0.1:8081' },
  },
}))
