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

  // 开发期组件预览页（Phase 1 的人工验收载体，Phase 4 全部页面迁完后删除）。
  // `import.meta.env.DEV` 在生产构建里恒为 false，整个分支会被摇掉，不进产物。
  // 只在 dev server 下可达：设计系统的大半质量（玻璃、暗色、对比度、焦点环）
  // jsdom 测不到，只能在真浏览器里看，所以给它一条独立入口。
  if (import.meta.env.DEV && location.pathname.startsWith('/miniapp/_preview')) {
    const { PreviewPage } = await import('./components/preview')
    createRoot(document.getElementById('root')!).render(<PreviewPage />)
    return
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
