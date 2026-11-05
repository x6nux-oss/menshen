// 设计系统样式入口的契约测试。
//
// 为什么需要它：Tailwind 只处理**被 import 到**的 CSS。Phase 1 一度建好了
// token/玻璃层，但三个入口都没 import 它们 —— 构建成功、产物里却没有任何
// CSS，所有新组件无样式，且没有任何告警。这个缺陷溜过了两轮人工审查，
// 所以在这里用断言钉住：三个入口都必须 import 样式入口文件。
//
// 断的是**源码结构**（import 语句），不是运行时行为 —— jsdom 不会真的加载
// 并解析 Tailwind。真正的验证是构建产物里有 CSS，那由 Task 7 的构建检查覆盖。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '../..')

/** 三个前端面各自的入口文件（相对 web/）。顺序与目录一致，便于报错时定位。 */
const ENTRIES = [
  'src/main.tsx',
  'src/public/main.tsx',
  'src/admin/main.tsx',
] as const

describe('设计系统样式入口', () => {
  it.each(ENTRIES)('%s 导入了 tailwind.css', (entry) => {
    const src = readFileSync(resolve(webRoot, entry), 'utf-8')
    expect(src, `${entry} 必须 import 设计系统样式，否则 token/玻璃层不进产物`).toMatch(
      /import\s+['"][^'"]*tailwind\.css['"]/,
    )
  })

  it('tailwind.css 确实指向 styles/index.css（不是空壳）', () => {
    const css = readFileSync(resolve(webRoot, 'tailwind.css'), 'utf-8')
    expect(css).toMatch(/@import\s+['"][^'"]*styles\/index\.css['"]/)
  })

  it('index.css 引入了 token 与玻璃层', () => {
    const css = readFileSync(resolve(webRoot, 'src/styles/index.css'), 'utf-8')
    for (const dep of ['./token.css', './glass.css', './glass-refract.css']) {
      expect(css, `index.css 应 @import ${dep}`).toContain(dep)
    }
  })
})
