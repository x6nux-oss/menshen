import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// 设计系统样式入口（Phase 1）。必须在这里 import：Tailwind 只处理被 import
// 到的 CSS，没有这一行 token/玻璃/工具类都不会进产物 —— 表现为所有新组件
// 无样式，而构建成功、无任何告警。
import '../tailwind.css'

// VITE_MOCK=1 时先启动 MSW（开发用）；生产构建里条件为假，
// mocks 目录会作为独立 chunk 被摇掉，不进首屏。
// Telegram SDK 的等待与初始化在 App 内部完成（initTelegram），这里只负责挂载。
async function bootstrap() {
  if (import.meta.env.VITE_MOCK) {
    const { startMocks } = await import('./mocks')
    await startMocks()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
