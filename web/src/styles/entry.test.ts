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

  it('glass.css 的 .glass 规则在 @layer components 内', () => {
    // 无 layer 的声明胜过任何 layer 内的声明（与源码顺序无关）。若 .glass 的
    // position: relative 处于无 layer 状态，调用方传的 fixed/absolute 工具类
    // 会被它压掉 —— 底部栏不固定、弹层不限位，且无任何告警。
    const css = readFileSync(resolve(webRoot, 'src/styles/glass.css'), 'utf-8')
    const layerIdx = css.indexOf('@layer components')
    const glassIdx = css.indexOf('.glass {')
    expect(layerIdx, 'glass.css 应有 @layer components').toBeGreaterThan(-1)
    expect(glassIdx, 'glass.css 应有 .glass 规则').toBeGreaterThan(-1)
    expect(glassIdx, '.glass 必须在 @layer components 之后（即在其内部）').toBeGreaterThan(layerIdx)
  })

  it('glass-refract.css 不写 -webkit- 前缀副本（lightningcss 去前缀会让折射失效）', () => {
    const css = readFileSync(resolve(webRoot, 'src/styles/glass-refract.css'), 'utf-8')
    const decls = css.replace(/\/\*[\s\S]*?\*\//g, '') // 去掉注释再查，注释里提到的前缀不算
    expect(decls, '不得写 -webkit-backdrop-filter（会被去重成只剩前缀那条，Chromium 不认 url() 前缀形式）')
      .not.toContain('-webkit-backdrop-filter')
  })
})
