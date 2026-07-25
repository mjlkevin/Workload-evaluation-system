import { apiClient } from './client.js'
import { unwrap, unwrapUsers } from './utils.js'

export async function listUsers() {
  return unwrapUsers(await apiClient.get('/auth/users'))
}

export async function updateUserRole(id, role) {
  return unwrap(await apiClient.patch(`/auth/users/${id}/role`, { role }), 'user')
}

export async function updateUserBusinessRole(id, businessRole) {
  return unwrap(
    await apiClient.patch(`/auth/users/${id}/business-role`, { businessRole }),
    'user'
  )
}

export async function updateUserStatus(id, status) {
  return unwrap(await apiClient.patch(`/auth/users/${id}/status`, { status }), 'user')
}

export async function resetUserPassword(id, password) {
  return unwrap(await apiClient.patch(`/auth/users/${id}/password`, { password }), 'user')
}

export async function generateInviteCode() {
  return unwrap(await apiClient.post('/auth/invite-codes/generate'), 'code')
}
