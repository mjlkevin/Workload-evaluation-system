import { describe, expect, test } from 'vitest'
import { mapUserToVM } from '../hooks/useUsers.js'

describe('mapUserToVM', () => {
  test('maps explicit businessRole from backend', () => {
    const vm = mapUserToVM({
      id: 'u-sales',
      username: 'sales01',
      role: 'user',
      businessRole: 'sales',
      status: 'active',
    })

    expect(vm.businessRole).toBe('sales')
    expect(vm.businessRoleLabel).toBe('销售员')
    expect(vm.role).toBe('user')
  })

  test('falls back businessRole from system role when missing', () => {
    expect(mapUserToVM({ username: 'root', role: 'admin' }).businessRole).toBe('admin')
    expect(mapUserToVM({ username: 'pm01', role: 'sub_admin' }).businessRole).toBe('pm')
    expect(mapUserToVM({ username: 'presales01', role: 'user' }).businessRole).toBe('pre_sales')
  })
})
