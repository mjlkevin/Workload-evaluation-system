import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import useCurrentUser, { resetCurrentUserCache } from '../hooks/useCurrentUser.js'

/**
 * 打开 `/` 时 App / Shell / HomePage 三个消费者各发一次 /auth/me —— 同一份
 * 身份信息请求三遍。本文件守的是**在途合流**：同时挂载只打一次网。
 *
 * 同时守住边界的另一半：**不做结果缓存**。身份会变（改角色、禁用、换账号），
 * 留住结果就等于把上一次的身份发给下一个消费者。先前写成结果缓存时，既有的
 * 「非管理员应被挡回」四条用例直接挂掉。所以「重新挂载会重新取」是有意为之，
 * 不是遗漏——下面第二条用例把这个意图钉住，防止后来人「顺手加个缓存」。
 */
function Consumer({ label }) {
  const { user, loading } = useCurrentUser({ enabled: true })
  if (loading) return <div>{label}:loading</div>
  return <div>{label}:{user?.username || 'none'}</div>
}

const ADMIN = { code: 0, data: { user: { id: 1, username: 'kevin', role: 'admin' } } }
const OTHER = { code: 0, data: { user: { id: 2, username: 'other', role: 'user' } } }

const meCallCount = (get) => get.mock.calls.filter(([url]) => url === '/auth/me').length

describe('useCurrentUser 的请求共享', () => {
  beforeEach(() => {
    resetCurrentUserCache()
    localStorage.setItem('wes_token', 'token-a')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    resetCurrentUserCache()
  })

  test('三个并发消费者只触发一次 /auth/me', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(ADMIN)

    render(
      <>
        <Consumer label="a" />
        <Consumer label="b" />
        <Consumer label="c" />
      </>,
    )

    expect(await screen.findByText('a:kevin')).toBeInTheDocument()
    expect(await screen.findByText('b:kevin')).toBeInTheDocument()
    expect(await screen.findByText('c:kevin')).toBeInTheDocument()
    expect(meCallCount(get)).toBe(1)
  })

  test('重新挂载会重新取（刻意不缓存结果，身份可能已变）', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(ADMIN)

    const first = render(<Consumer label="a" />)
    expect(await screen.findByText('a:kevin')).toBeInTheDocument()
    first.unmount()

    // 同一 token，但服务端换了人（改角色 / 换账号等价场景）
    get.mockResolvedValue(OTHER)
    render(<Consumer label="d" />)

    // 必须拿到新身份，不能复用上一次的结果
    expect(await screen.findByText('d:other')).toBeInTheDocument()
    expect(meCallCount(get)).toBe(2)
  })

  test('取数失败不影响后续消费者重新尝试', async () => {
    const get = vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('boom'))

    const first = render(<Consumer label="a" />)
    expect(await screen.findByText('a:none')).toBeInTheDocument()
    first.unmount()

    get.mockResolvedValue(ADMIN)
    render(<Consumer label="f" />)
    expect(await screen.findByText('f:kevin')).toBeInTheDocument()

    await waitFor(() => {
      expect(meCallCount(get)).toBe(2)
    })
  })
})
