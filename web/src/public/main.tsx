import { createRoot } from 'react-dom/client'
import { PublicApp } from './PublicApp'

// 设计系统样式入口（Phase 1）。公开页与另两面共用同一套 token 与玻璃层。
import '../../tailwind.css'

createRoot(document.getElementById('root')!).render(<PublicApp />)
