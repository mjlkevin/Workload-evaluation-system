import { describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'

describe('apiClient timeout', () => {
  test('aborts a request after the configured timeout', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    )

    await expect(apiClient.post('/slow', {}, { timeoutMs: 10 }))
      .rejects.toThrow('请求超时，请稍后重试')
    expect(fetchSpy.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
