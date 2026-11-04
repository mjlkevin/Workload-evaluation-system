import { useCallback, useEffect, useState } from 'react'
import { skillsApi } from '../api/skills.js'

export default function useSkillManagement() {
  const [records, setRecords] = useState([])
  const [metadata, setMetadata] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [list, meta] = await Promise.all([skillsApi.list(), skillsApi.metadata()])
      setRecords(list.data.items)
      setMetadata(meta.data)
    } catch (cause) { setError(`Skill 加载失败：${cause.message}`) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const accept = (record) => setRecords((items) => items.some((item) => item.skillId === record.skillId)
    ? items.map((item) => item.skillId === record.skillId ? record : item) : [record, ...items])
  return { records, metadata, loading, error, load, accept }
}
