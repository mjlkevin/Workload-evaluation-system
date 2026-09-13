import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * ISS-2026-09-04-001 · 窄屏 composer 发送按钮被永久裁切
 *
 * 守的是 CSS 契约，不是几何：jsdom 没有布局引擎，量不出 right/宽度，
 * 所以本文件不假装测几何。几何证据来自真实浏览器实测
 * （scripts/measure-composer.mjs，360/390/414 三档，改前 2 个越界元素
 *  → 改后 0 个；发送按钮右边界 375 → 310）。
 *
 * 已知局限（与批 6 的守卫同型，已登记）：本守卫只能保证这条声明还在，
 * 不能保证上游布局改动后溢出不复发；浏览器实测未进 CI。
 */
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const css = readFileSync(path.join(uiRoot, 'src', 'index.css'), 'utf8')

function ruleBlock(selector) {
  const start = css.indexOf(selector + ' {')
  if (start === -1) return null
  const end = css.indexOf('}', start)
  if (end === -1) return null
  return css.slice(start, end + 1)
}

describe('ai-composer 窄屏可达性契约', () => {
  test('.ai-composer__row 规则块存在', () => {
    expect(ruleBlock('.ai-composer__row')).toBeTruthy()
  })

  test('.ai-composer__row 解除了网格项默认 min-width:auto', () => {
    const block = ruleBlock('.ai-composer__row')
    expect(block).toBeTruthy()
    // 这条一旦被删，360 档下本行会重新被钉在 min-content(261px)，
    // 发送按钮右边界回到 375 并被 overflow-x:hidden 的祖先裁掉。
    expect(/min-width:\s*0\b/.test(block)).toBe(true)
  })

  test('.ai-composer__inner 仍是 grid（本修复的前提，换了布局模型需重新实测）', () => {
    const block = ruleBlock('.ai-composer__inner')
    expect(block).toBeTruthy()
    expect(/display:\s*grid\b/.test(block)).toBe(true)
  })

  test('发送与附件按钮仍为不可压缩的定宽控件（收窄的是输入框，不是按钮）', () => {
    const send = ruleBlock('.ai-composer__send')
    const attach = ruleBlock('.ai-composer__attach')
    expect(send).toBeTruthy()
    expect(attach).toBeTruthy()
    expect(/flex-shrink:\s*0\b/.test(send)).toBe(true)
    expect(/flex-shrink:\s*0\b/.test(attach)).toBe(true)
  })
})
