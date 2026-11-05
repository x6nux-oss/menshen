/// <reference types="@rsbuild/core/types" />

// rsbuild 通过 tsconfig.app.json 的 "types": ["@rsbuild/core/types"] 提供
// ImportMeta.env 的类型（MODE / DEV / PROD / ASSET_PREFIX 等）。这里只补充
// 我们自己在 rsbuild.config.ts 里额外注入的变量。
//
// VITE_MOCK 的 VITE_ 前缀是刻意的：rsbuild 默认只暴露 PUBLIC_ 前缀，配置里用
// loadEnv({ prefixes: ['VITE_'] }) 显式声明，让既有的 VITE_MOCK=1 用法继续可用。
interface ImportMetaEnv {
  /** 开发期 mock 开关（VITE_MOCK=1）：启动 msw worker，数据来自 src/mocks。 */
  readonly VITE_MOCK?: string
}
