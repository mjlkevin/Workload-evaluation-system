import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'
import { server } from './mocks/server.js'

const realFetch = globalThis.fetch

// ISS-2026-08-18-001（MSW 逃逸，架构侧 2026-08-18 裁决：收集器 + 框架层断言）：
// 原 onUnhandledRequest:'error' 抛出的 reject 会被应用代码的 .catch(() => {}) 吞掉，
// 导致未匹配请求静默通过（前端源码共 17 处吞错点，见 ISS-2026-08-18-005）。
// 现改为收集器回调：未匹配请求（method + url）记入模块级数组、不抛出；
// afterEach 在测试框架层断言数组为空，非空以清单形式失败并清空——
// 断言不在任何应用代码可触及的 promise 链上，无法被吞错 catch 架空。
const unhandledRequests = []

beforeAll(() => {
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return realFetch(`http://localhost${input}`, init)
    }
    return realFetch(input, init)
  }
  server.listen({
    onUnhandledRequest: (request) => {
      unhandledRequests.push(`${request.method} ${request.url}`)
    },
  })
})

beforeEach(() => {
  localStorage.setItem('wes_token', 'test-token')
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  const leaked = unhandledRequests.splice(0, unhandledRequests.length)
  expect(
    leaked,
    `检测到 ${leaked.length} 个未匹配 mock 的请求（需补 handler 或修调用点，不得静默放行）：\n${leaked.join('\n')}`,
  ).toEqual([])
})

afterAll(() => {
  server.close()
  globalThis.fetch = realFetch
})
