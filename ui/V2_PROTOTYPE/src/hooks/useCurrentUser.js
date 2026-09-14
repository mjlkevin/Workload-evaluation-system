import { useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'
import { getToken, isAuthenticated } from '../api/auth.js'
import { unwrap } from '../api/utils.js'
import { businessRoleLabel, defaultBusinessRoleForSystemRole } from './useUsers.js'

// 这个 hook 有多个消费者（App / Shell / HomePage），此前每个消费者各自
// 发一次 /auth/me：打开 `/` 就是三次同样的请求。这里只做**在途合流**——
// 同一 token 下、同一时刻还没落地的请求共用一个 promise，三个消费者
// 一起挂载时只打一次网。
//
// 刻意**不做结果缓存**：身份是会变的（改角色、禁用、换账号），把结果留住
// 就等于把上一次的身份发给下一个消费者。实测代价是真的——先前写成结果缓存时，
// 既有的「非管理员应被挡回」四条用例直接挂掉，因为它们在同一 token 下换了返回的人。
// 省三次请求不值得拿身份正确性换，所以请求一落地就把合流句柄丢掉，重新挂载照常重取。
let inflightToken = null
let inflightPromise = null

function normalizeUser(payload) {
  const data = unwrap(payload) || {}
  const raw = data.user || payload?.user || {}
  const businessRole = raw.businessRole || defaultBusinessRoleForSystemRole(raw.role)
  return { ...raw, businessRole, businessRoleLabel: businessRoleLabel(businessRole) }
}

export function fetchCurrentUser(token) {
  if (inflightPromise && inflightToken === token) return inflightPromise

  inflightToken = token
  inflightPromise = apiClient.get('/auth/me')
    .then(normalizeUser)
    .finally(() => {
      inflightPromise = null
      inflightToken = null
    })

  return inflightPromise
}

// 只有测试需要在用例之间抹掉在途句柄。
export function resetCurrentUserCache() {
  inflightToken = null
  inflightPromise = null
}

export default function useCurrentUser({ enabled = isAuthenticated() } = {}) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setUser(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCurrentUser(getToken())
      .then((value) => {
        if (cancelled) return
        setUser(value)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled])

  return { user, loading, error }
}
