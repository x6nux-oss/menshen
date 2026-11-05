import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RsbuildPlugin } from '@rsbuild/core'

const OUT_DIR = resolve(import.meta.dirname, '../internal/panel/webdist')

// 产物目录要始终保留一个占位文件：go:embed all:webdist 要求目录非空，而
// 产物本身不入库；没有它时全新克隆的 go build / go test 会直接编译失败。
// 本配置的 cleanDistPath 会清空整个目录（连 .gitkeep 一起删），所以必须
// 构建结束时把它写回。
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
  // 只暴露 PUBLIC_ 前缀，不显式声明 VITE_ 的话它恒为 undefined，开发 mock 会
  // 静默失效（页面空白但不报错）。
  const { publicVars } = loadEnv({ mode: envMode, prefixes: ['VITE_'] })

  return {
    plugins: [pluginReact(), pluginTailwindcss({ optimize: false }), keepWebdistPlaceholder()],
    source: {
      // 两个入口：index 是 Telegram Mini App；public 是申诉验证、原文查看、
      // 申诉详情等公开网页（_w 路由），单独分包避免公开页加载整个管理端。
      //
      // 入口名必须是 index：rsbuild 按入口名产出 HTML（[name].html），而 Go 侧
      // 硬编码找 webdist/index.html（见 internal/panel/miniapp_embed.go）。
      // 叫 main 会产出 main.html，Go 那边就找不到入口页。
      entry: {
        index: './src/main.tsx',
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
      //
      // 目录布局必须落在 assets/ 下，不能沿用 rsbuild 默认的 static/js 与
      // static/css：Go 侧只对 /miniapp/assets/* 走 immutable 强缓存
      // （internal/panel/miniapp.go 的 miniAppAsset，其余路径只有 max-age=3600），
      // 且 miniapp_test.go 断言 fs.Glob(dist, "assets/*") 里有真实文件。
      //
      // 必须是**扁平**的（jsAsync 不能是 assets/async 这样的子目录）：测试取
      // assets[0] 去 GET，若命中子目录会 404（目录不算普通文件）。
      distPath: {
        root: OUT_DIR,
        js: 'assets',
        jsAsync: 'assets',
        css: 'assets',
        cssAsync: 'assets',
        assets: 'assets',
      },
      // Mini App 先构建：清空是安全的，还能清掉上次构建的陈旧文件。
      // 桌面面板（rsbuild.admin.config.ts）必须为 false，否则会删掉这里的产物。
      cleanDistPath: true,
      assetPrefix: '/miniapp/',
      // public/ 不显式配置 copy：rsbuild 默认就会把它复制到产物根
      // （telegram-web-app.js，以及 Task 4 加入的 mockServiceWorker.js）。
    },
    server: {
      // 本地开发把 API 代理到 Go 服务（默认监听 127.0.0.1:8081）。
      proxy: { '/miniapp/api': 'http://127.0.0.1:8081' },
    },
  }
})
