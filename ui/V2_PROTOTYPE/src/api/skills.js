import { apiClient } from './client.js'

export const skillsApi = {
  // Admin management loads archived records so they remain recoverable after reload.
  list: () => apiClient.get('/skills', { includeArchived: true }),
  metadata: () => apiClient.get('/skills/metadata'),
  get: (id) => apiClient.get(`/skills/${encodeURIComponent(id)}`),
  create: (definition) => apiClient.post('/skills', { definition }),
  saveDraft: (id, revision, definition) => apiClient.patch(`/skills/${encodeURIComponent(id)}/save-draft`, { revision, definition }),
  action: (id, action, revision) => apiClient.post(`/skills/${encodeURIComponent(id)}/${action}`, { revision }),
  status: (id, revision, status) => apiClient.patch(`/skills/${encodeURIComponent(id)}/status`, { revision, ...status }),
  validate: (definition) => apiClient.post('/skills/validate', { definition }),
}
