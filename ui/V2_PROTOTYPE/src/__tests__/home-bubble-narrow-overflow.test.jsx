import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import MessageBubble from '../pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx'

/**
 * 前端优化线批 6：窄屏（360/390/414）消息气泡右边界越出视口
 * 浏览器实测（playwright-core + page.route 打桩，批 6 收工报告附三档数据）确认的根因链：
 *   MessageList 的 grid 容器隐式 auto 列按行内容 min-content 撑到 ~880px，
 *   气泡行/气泡盒没有任何最小宽度收敛与断词约束，长 URL / 不可断词整行不换行，
 *   叠加 html/body overflow-x:hidden 后窄屏上内容永久不可达。
 * 本用例守住修复落地所需的两个布局契约（jsdom 无布局引擎，断的是 DOM 契约而非几何值）：
 *   1) .ai-msg-row（grid item）必须带 min-w-0 —— 阻断 auto 轨按 min-content 撑爆；
 *   2) .ai-bubble-wrap 必须带 break-words（overflow-wrap:break-word，可继承）——
 *      长 URL/不可断词在窄气泡内换行，内容完整可读。
 */

const LONG_URL_TEXT = '见附件 https://erp.example.com/attachments/2026/very-long-signed-download-link-token-abcdefghijklmnopqrstuvwxyz0123456789.pdf'

describe('批6 窄屏气泡越界守卫（AiHomeWorkbench MessageBubble）', () => {
  test('用户消息行携带 min-w-0（阻断 grid auto 轨按 min-content 撑爆）', () => {
    const { container } = render(
      <MessageBubble
        message={{ id: 'u-narrow-1', role: 'user', text: LONG_URL_TEXT, createdAt: '2026-09-01T10:00:00' }}
        sending={false}
      />,
    )
    const row = container.querySelector('article.ai-msg-row')
    expect(row).toBeTruthy()
    expect(row.classList.contains('min-w-0')).toBe(true)
  })

  test('用户气泡盒携带 break-words（长 URL 可断行而非越出视口）', () => {
    const { container } = render(
      <MessageBubble
        message={{ id: 'u-narrow-2', role: 'user', text: LONG_URL_TEXT, createdAt: '2026-09-01T10:00:00' }}
        sending={false}
      />,
    )
    const bubble = container.querySelector('.ai-bubble-wrap')
    expect(bubble).toBeTruthy()
    expect(bubble.classList.contains('break-words')).toBe(true)
  })

  test('AI 消息行与气泡盒同样具备 min-w-0 / break-words 双契约', () => {
    const { container } = render(
      <MessageBubble
        message={{ id: 'a-narrow-1', role: 'assistant', text: `结论详见 ${LONG_URL_TEXT}`, createdAt: '2026-09-01T10:00:30' }}
        sending={false}
      />,
    )
    const row = container.querySelector('article.ai-msg-row')
    const bubble = container.querySelector('.ai-bubble-wrap')
    expect(row.classList.contains('min-w-0')).toBe(true)
    expect(bubble.classList.contains('break-words')).toBe(true)
  })

  test('error 消息（左色条分支）不丢双契约', () => {
    const { container } = render(
      <MessageBubble
        message={{ id: 'e-narrow-1', role: 'assistant', text: '请求失败：UnrecoverableLongErrorMessageTokenWithoutSpacesAtAll', error: true }}
        sending={false}
      />,
    )
    const row = container.querySelector('article.ai-msg-row')
    const bubble = container.querySelector('.ai-bubble-wrap')
    expect(row.classList.contains('min-w-0')).toBe(true)
    expect(bubble.classList.contains('break-words')).toBe(true)
    expect(bubble.classList.contains('border-l-2')).toBe(true)
  })
})
