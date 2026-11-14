// token 契约测试：读 CSS 源文件，断言亮暗两套与关键 token 齐全。
// jsdom 不解析 oklch，所以这里断的是**源文件结构**，真机效果由预览页人工验收。
//
// 本文件用 node:fs 读源文件，所以显式引入 node 类型。**故意不把它加进
// tsconfig.app.json 的 types** —— 那会让浏览器侧代码也能通过 node API 的类型检查，
// 从而把一个「打包时才会炸」的错误推迟到运行时。测试用文件级引用即可。
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokenCss = readFileSync(resolve(import.meta.dirname, 'token.css'), 'utf-8')

/** 必需的语义 token（设计文档 §3：颜色走 oklch 语义 token）。 */
const REQUIRED = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--muted', '--muted-foreground',
  '--primary', '--primary-foreground', '--destructive', '--success',
  '--warning', '--border', '--input', '--ring',
]

describe('设计 token', () => {
  it('亮色定义在 :root', () => {
    expect(tokenCss).toMatch(/:root\s*\{/)
  })

  it('暗色定义在 .dark', () => {
    expect(tokenCss).toMatch(/\.dark\s*\{/)
  })

  it.each(REQUIRED)('%s 在亮暗中都有定义', (name) => {
    const hits = tokenCss.match(new RegExp(`${name}:`, 'g')) ?? []
    expect(hits.length, `${name} 应定义两次（亮+暗）`).toBeGreaterThanOrEqual(2)
  })

  it('颜色值用 oklch', () => {
    expect(tokenCss).toMatch(/--background:\s*oklch\(/)
    expect(tokenCss).toMatch(/--primary:\s*oklch\(/)
  })

  it('圆角 token 齐全', () => {
    for (const r of ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl']) {
      expect(tokenCss).toContain(`${r}:`)
    }
  })
})
