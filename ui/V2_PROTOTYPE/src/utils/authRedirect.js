// 登录后的落地页解析。
// 背景：ProtectedLayout 拦截受保护路由时会把原始目标写进 history state（App.jsx），
// 但此前没有任何消费方，登录成功后固定落首页，用户回不到原页面。
const AUTH_ONLY_PATHS = new Set(['/login', '/reset-password'])

// 只允许同源相对路径。协议相对（//host）、反斜杠变体、绝对 URL 一律拒绝，
// 避免回跳目标被改造成开放重定向出口。
export function isSafeInternalRedirect(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  if (path.includes('://')) return false
  const [pathname] = path.split(/[?#]/)
  if (AUTH_ONLY_PATHS.has(pathname)) return false
  return true
}

// 优先用 router state（受保护路由拦截时写入，信息最全，含 search/hash）；
// 退化到 ?from= 查询串（401 拦截器在整页跳转前无法携带 state，只能走 URL）。
export function resolvePostLoginRedirect({ state, search } = {}) {
  const from = state?.from
  if (from?.pathname) {
    const target = `${from.pathname}${from.search || ''}${from.hash || ''}`
    if (isSafeInternalRedirect(target)) return target
  }

  const query = new URLSearchParams(search || '')
  const fallback = query.get('from')
  if (fallback && isSafeInternalRedirect(fallback)) return fallback

  return '/'
}

// 登录成功后的落地动作。收敛成一个具名出口有两个原因：
// 一是“去哪”与“怎么去”同属一个关注点，不该散在 hook 里；
// 二是 jsdom 的 window.location 不可重定义，没有这个接缝就无法对跳转目标下断言。
export function navigateAfterLogin(target) {
  window.location.assign(target)
}

// 登录页地址。401 拦截器在整页跳转前带不上 router state，只能用 ?from= 把原始页交给登录页。
// 当前地址虽是同源取到的，仍过一遍安全校验：pathname 理论上可以是 //host 形态。
export function buildLoginUrl(current) {
  if (!current || !isSafeInternalRedirect(current)) return '/login'
  return `/login?from=${encodeURIComponent(current)}`
}

export function goToLogin(current) {
  window.location.assign(buildLoginUrl(current))
}
