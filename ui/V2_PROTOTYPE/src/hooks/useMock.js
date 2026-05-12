import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'wes_use_mock'

/**
 * Resolve the effective mock flag from three sources (priority high → low):
 * 1. Runtime override via `window.__setUseMock(bool)`
 * 2. localStorage persisted user preference (`wes_use_mock`)
 * 3. Build-time env `VITE_USE_MOCK` ("true" / "1" / "yes" are truthy)
 *
 * @returns {boolean}
 */
function resolveMockFlag() {
  // 1. Runtime window override (highest priority — for debugging)
  if (typeof window !== 'undefined' && window.__USE_MOCK__ !== undefined) {
    return Boolean(window.__USE_MOCK__)
  }

  // 2. localStorage persisted preference
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === 'true'
  } catch {
    // localStorage may be blocked in private mode — silently fall through
  }

  // 3. Build-time env variable (Vite exposes only VITE_ prefixed vars)
  const env = import.meta.env?.VITE_USE_MOCK
  if (env !== undefined) {
    return env === 'true' || env === '1' || env === 'yes'
  }

  return false
}

/**
 * Persist the mock flag to localStorage.
 * @param {boolean} value
 */
function persistMockFlag(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // ignore quota / private-mode errors
  }
}

/**
 * Global runtime setter for debugging / e2e tests.
 * Call from browser console: `window.__setUseMock(true)`
 *
 * @param {boolean} value
 */
function setGlobalMockOverride(value) {
  if (typeof window !== 'undefined') {
    window.__USE_MOCK__ = Boolean(value)
  }
}

// Register global helper immediately so it is available before any React render.
if (typeof window !== 'undefined') {
  window.__setUseMock = setGlobalMockOverride
}

/**
 * React hook that tracks whether the app is in mock mode.
 *
 * @returns {{ isMock: boolean, setMock: (v: boolean) => void, toggleMock: () => void }}
 */
export function useMock() {
  const [isMock, setIsMock] = useState(() => resolveMockFlag())

  const setMock = useCallback((value) => {
    const next = Boolean(value)
    setGlobalMockOverride(next)
    persistMockFlag(next)
    setIsMock(next)
  }, [])

  const toggleMock = useCallback(() => {
    setMock(!isMock)
  }, [isMock, setMock])

  // Listen for storage changes from other tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === STORAGE_KEY) {
        const next = e.newValue === 'true'
        setGlobalMockOverride(next)
        setIsMock(next)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { isMock, setMock, toggleMock }
}

/**
 * Conditional executor: calls the real API when mock is off,
 * otherwise resolves with the supplied mock data.
 *
 * Optionally supports a `delay` to simulate network latency,
 * and an `errorRate` (0-1) to simulate occasional failures.
 *
 * @template T
 * @param {() => Promise<T>} apiCall    Real API call (lazy — only invoked when needed)
 * @param {T | (() => T)} mockData      Static mock data or factory function
 * @param {Object} [options]
 * @param {number} [options.delay=0]     Artificial delay in ms
 * @param {number} [options.errorRate=0] Chance (0-1) to throw a mock network error
 * @returns {Promise<T>}
 */
export async function withMock(apiCall, mockData, options = {}) {
  const { delay = 0, errorRate = 0 } = options

  if (!resolveMockFlag()) {
    return apiCall()
  }

  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay))
  }

  if (errorRate > 0 && Math.random() < errorRate) {
    throw new Error('[Mock] simulated network error')
  }

  return typeof mockData === 'function' ? mockData() : mockData
}

/**
 * Read-only helper for non-React contexts (e.g. api/client.js interceptors).
 * @returns {boolean}
 */
export function isMockMode() {
  return resolveMockFlag()
}
