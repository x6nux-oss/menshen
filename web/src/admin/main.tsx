import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setApiAuth } from '../api/client'
import { botIdFromURL } from '../telegram'
import { AdminApp } from './AdminApp'

// 设计系统样式入口（Phase 1）。桌面面板与 Mini App 共用同一套 token 与玻璃层。
import '../../tailwind.css'

// 桌面端管理面板入口。会话鉴权：登录链接已在浏览器种下 HttpOnly cookie，
// 这里只注入目标 bot 与 X-Web 标记（自定义头是 CSRF 兜底）。
// 必须在任何查询挂载之前完成，否则首个 state 请求会缺头被拒。
setApiAuth({ web: true, initData: '', botId: botIdFromURL() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)
