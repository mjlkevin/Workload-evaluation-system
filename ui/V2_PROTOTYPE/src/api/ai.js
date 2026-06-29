import { apiClient } from './client'
import { unwrap } from './utils'

export async function summarizeCompanyProfile(payload) {
  return unwrap(await apiClient.post('/ai/company-profile-summary', payload, { suppressUnauthorizedRedirect: true }))
}

export async function sendHomeWorkbenchMessage(payload) {
  return unwrap(await apiClient.post('/ai/home-workbench/chat', payload, { suppressUnauthorizedRedirect: true }))
}
