import { useCallback, useEffect, useRef, useState } from 'react'
import { workflowsApi } from '../api/workflows.js'
export default function useWorkflowManagement() {
  const [records, setRecords] = useState([])
  const [metadata, setMetadata] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const [list, meta] = await Promise.all([workflowsApi.list(), workflowsApi.metadata()])
      if (generation.current === request) { setRecords(list.data.items); setMetadata(meta.data) }
    } catch (e) { if (generation.current === request) { setMetadata(null); setError(`Workflow 加载失败：${e.message}`) } }
    finally { if (generation.current === request) setLoading(false) }
  }, [])
  useEffect(() => { load(); return () => { generation.current++ } }, [load])
  const accept = record => setRecords(items => items.some(r => r.workflowId === record.workflowId) ? items.map(r => r.workflowId === record.workflowId ? record : r) : [record, ...items])
  return { records, metadata, loading, error, load, accept }
}
