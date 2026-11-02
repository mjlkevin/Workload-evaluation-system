import { apiClient } from './client.js'
const path = id => `/workflows/${encodeURIComponent(id)}`
export const workflowsApi = {
  list: () => apiClient.get('/workflows', { includeArchived: true }),
  metadata: () => apiClient.get('/workflows/metadata'),
  get: id => apiClient.get(path(id)),
  create: definition => apiClient.post('/workflows', { definition }),
  save: (id, revision, definition) => apiClient.patch(`${path(id)}/save-draft`, { revision, definition }),
  status: (id, revision, status) => apiClient.patch(`${path(id)}/status`, { revision, ...status }),
  action: (id, action, revision, payload = {}) => apiClient.post(`${path(id)}/${action}`, { revision, ...payload }),
  release: id => apiClient.get(`${path(id)}/release`),
  dependencies: (id, versionId) => apiClient.get(`${path(id)}/dependencies`, { versionId }),
}
