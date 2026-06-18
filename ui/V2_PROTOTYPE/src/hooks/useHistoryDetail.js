import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrapSingle } from '../api/utils.js'
import { mapHistoryProjectToVM } from './useHistoryProjects.js'

export default function useHistoryDetail(id, { enabled = isAuthenticated(), fallbackData = null } = {}) {
  const fallbackProject = useMemo(() => fallbackData ? mapHistoryProjectToVM(fallbackData) : null, [fallbackData])
  const [project, setProject] = useState(fallbackProject)
  const [loading, setLoading] = useState(Boolean(enabled && id))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id || !enabled) {
      setProject(fallbackProject)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    apiClient.get(`/history/projects/${id}`)
      .then((payload) => {
        if (cancelled) return
        const raw = unwrapSingle(payload)
        setProject(raw ? mapHistoryProjectToVM(raw) : fallbackProject)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setProject(fallbackProject)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [id, enabled, fallbackProject])

  return { project, loading, error }
}
