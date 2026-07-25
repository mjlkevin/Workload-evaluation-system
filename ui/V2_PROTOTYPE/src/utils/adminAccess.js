export function isAdminUser(user) {
  return user?.role === 'admin'
}

export function isAdminOnlyPath(path) {
  const purePath = String(path || '/').split('?')[0] || '/'
  return purePath === '/users' || purePath === '/api-keys' || purePath === '/agent' || purePath === '/system' || purePath.startsWith('/system/')
}
