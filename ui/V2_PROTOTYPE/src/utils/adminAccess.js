export function isAdminUser(user) {
  return user?.role === 'admin'
}

/** 精确匹配的管理页路径（父路由本身） */
const ADMIN_EXACT_PATHS = ['/users', '/api-keys', '/agent', '/system']

/** 前缀匹配的管理页路径（各管理区下的全部子页；批次 10a 增 /base-data/） */
const ADMIN_PATH_PREFIXES = ['/system/', '/base-data/']

export function isAdminOnlyPath(path) {
  const purePath = String(path || '/').split('?')[0] || '/'
  return ADMIN_EXACT_PATHS.includes(purePath) || ADMIN_PATH_PREFIXES.some((prefix) => purePath.startsWith(prefix))
}
