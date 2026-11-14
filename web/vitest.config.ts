import { defineConfig } from 'vitest/config'

// 测试环境配置：environment 与 setupFiles 与原 vite.config.ts 的 test 段一致。
// 测试不经过 rsbuild（vitest 自带 esbuild transform），所以这里只声明环境，
// 不需要 React 插件 —— 也未安装 @vitejs/plugin-react（随 vite 一起移除了）。
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
