import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { server } from './mocks/server.js'

const realFetch = globalThis.fetch

beforeAll(() => {
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return realFetch(`http://localhost${input}`, init)
    }
    return realFetch(input, init)
  }
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(() => {
  localStorage.setItem('wes_token', 'test-token')
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  vi.restoreAllMocks()
})

afterAll(() => {
  server.close()
  globalThis.fetch = realFetch
})
