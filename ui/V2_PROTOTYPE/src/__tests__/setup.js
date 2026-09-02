import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest'
import { server } from './mocks/server.js'

const realFetch = globalThis.fetch

// DEF-2026-09-02-001 取证：vitest jsdom 环境把 jsdom 版 AbortController/AbortSignal
// 覆盖到全局，而 msw fetchProxy 构造 undici Request 时校验 signal 必须是同 realm
// 的 AbortSignal 实例——两者 realm 不同，任何带 timeoutMs 的请求都在 Request
// 构造处抛 TypeError，表现为「网络请求失败」（既有 503 用例因此一直假绿，
// 只断言标题未断言内容）。测试环境 msw 即时响应，超时语义不可测（已由
// apiClient.test.js 直接 spy fetch 覆盖 abort 断言），故在 fetchProxy 之上再包
// 一层剥离 signal 规避类型校验。

// ISS-2026-08-18-001（MSW 逃逸，架构侧 2026-08-18 裁决：收集器 + 框架层断言）：
// 原 onUnhandledRequest:'error' 抛出的 reject 会被应用代码的 .catch(() => {}) 吞掉，
// 导致未匹配请求静默通过（前端源码共 17 处吞错点，见 ISS-2026-08-18-005）。
// 现改为收集器回调：未匹配请求（method + url）记入模块级数组、不抛出；
// afterEach 在测试框架层断言数组为空，非空以清单形式失败并清空——
// 断言不在任何应用代码可触及的 promise 链上，无法被吞错 catch 架空。
const unhandledRequests = []

beforeAll(() => {
  server.listen({
    onUnhandledRequest: (request) => {
      unhandledRequests.push(`${request.method} ${request.url}`)
    },
  })
  // 必须在 server.listen() 之后包装：此时 globalThis.fetch 已是 msw fetchProxy，
  // 相对 URL 由它自行解析；此前直接赋值的包装会被 msw patch 覆盖成死代码。
  const proxiedFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const { signal: _signal, ...rest } = init || {}
    return proxiedFetch(input, rest)
  }
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
