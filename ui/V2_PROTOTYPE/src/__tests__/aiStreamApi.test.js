import { describe, expect, test, vi } from 'vitest'
import { streamHomeWorkbenchChat } from '../api/ai.js'

describe('streamHomeWorkbenchChat', () => {
  test('passes the abort signal into fetch so pre-response stop cancels the request', async () => {
    const controller = new AbortController()
    const onEvent = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { answer: '收到' },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await streamHomeWorkbenchChat({ messages: [{ role: 'user', content: '你好' }] }, {
      signal: controller.signal,
      onEvent,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ai/home-workbench/chat/stream', expect.objectContaining({
      signal: controller.signal,
    }))
    expect(onEvent).toHaveBeenCalledWith('done', expect.objectContaining({ answer: '收到' }))
  })

  test('marks fetch abort errors distinctly from network failures', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError)
    controller.abort()

    await expect(streamHomeWorkbenchChat({ messages: [{ role: 'user', content: '停止' }] }, {
      signal: controller.signal,
      onEvent: vi.fn(),
    })).rejects.toMatchObject({ aborted: true })
  })

  test('retries without signal when the test fetch runtime rejects a foreign AbortSignal brand', async () => {
    const controller = new AbortController()
    const onEvent = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { answer: '兼容响应' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await streamHomeWorkbenchChat({ messages: [{ role: 'user', content: '你好' }] }, {
      signal: controller.signal,
      onEvent,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/ai/home-workbench/chat/stream', expect.objectContaining({
      signal: controller.signal,
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/ai/home-workbench/chat/stream', expect.not.objectContaining({
      signal: controller.signal,
    }))
    expect(onEvent).toHaveBeenCalledWith('done', expect.objectContaining({ answer: '兼容响应' }))
  })

  test('parses the trailing SSE event when the stream ends without a blank-line delimiter', async () => {
    const onEvent = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: done\ndata: {"content":"尾包响应"}'))
          controller.close()
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ))

    await streamHomeWorkbenchChat({ messages: [{ role: 'user', content: '你好' }] }, {
      onEvent,
    })

    expect(onEvent).toHaveBeenCalledWith('done', expect.objectContaining({ content: '尾包响应' }))
  })
})
