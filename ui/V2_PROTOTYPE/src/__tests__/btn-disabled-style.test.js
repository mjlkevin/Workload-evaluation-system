import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// AGENTS §7 的 CSS 冻结令（2026-08-25）下，架构侧 2026-08-29 单点解冻
// components.css 的 .btn:disabled 一个规则块。这几条断言就是那次解冻的边界：
// 规则必须在规范位置、必须真能看出来是禁用态、不得偷偷扩面。
const componentsCss = readFileSync(join(process.cwd(), 'components.css'), 'utf-8')
const rule = componentsCss.match(/\.btn:disabled[^{]*\{([^}]*)\}/)?.[1] ?? ''

describe('.btn 禁用态规则块', () => {
  test('存在于 components.css 的 .btn 规则区', () => {
    expect(rule).not.toBe('')
  })

  test('禁用态在观感上区别于可点态：灰底灰字、禁止光标、取消位移与投影', () => {
    expect(rule).toMatch(/cursor:\s*not-allowed/)
    expect(rule).toMatch(/background:\s*var\(--bg-soft\)/)
    expect(rule).toMatch(/color:\s*var\(--ink-3\)/)
    expect(rule).toMatch(/transform:\s*none/)
    expect(rule).toMatch(/box-shadow:\s*none/)
  })

  // 禁用按钮靠 title 说明「为什么点不了」（如 DevAssessmentDetail 的 disabledTip），
  // pointer-events:none 会让这段提示读不到。
  test('不得用 pointer-events 屏蔽 hover', () => {
    expect(rule).not.toMatch(/pointer-events/)
  })

  // 架构侧解冻条件之一：只用既有 token，不新增自定义属性。
  test('未新增 token', () => {
    expect(rule).not.toMatch(/--[a-z0-9-]+\s*:/)
  })

  // .btn-pri / .btn-dan:hover 与 .btn:disabled 特异度相同（0,2,0），
  // 谁能生效取决于谁在后面。
  test('排在各变体及其 hover 之后，等特异度下按源序胜出', () => {
    const disabledAt = componentsCss.search(/\.btn:disabled/)
    for (const ref of ['.btn-pri{', '.btn-pri:hover', '.btn-dan:hover', '.btn:hover']) {
      expect(disabledAt).toBeGreaterThan(componentsCss.indexOf(ref))
    }
  })
})
