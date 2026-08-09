import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client.js'
import { useToast } from '../../hooks/useToast.jsx'

const STATUS_MAP = {
  draft: { label: '待确认', cls: 'warn' },
  active: { label: '已生效', cls: 'ci' },
  archived: { label: '已归档', cls: 'muted' },
}

export default function MemoryManagementPanel() {
  const [atoms, setAtoms] = useState([])
  const [scenes, setScenes] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const toast = useToast()

  const fetchMemory = async () => {
    setLoading(true)
    try {
      const status = filter === 'all' ? undefined : filter
      const res = await apiClient.get('/memory', { status, page: 1, pageSize: 50 })
      const data = res?.data || {}
      setAtoms(data.atoms || [])
      setScenes(data.scenes || [])
    } catch (err) {
      toast.error(err?.message || '记忆数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMemory()
  }, [filter])

  const handleConfirm = async (kind, ids) => {
    try {
      const endpoint = kind === 'atom' ? '/memory/atoms/confirm' : '/memory/scenes/confirm'
      await apiClient.post(endpoint, { memoryIds: ids })
      toast.success('已确认生效')
      fetchMemory()
    } catch (err) {
      toast.error(err?.message || '确认失败')
    }
  }

  const handleArchive = async (kind, ids) => {
    try {
      const endpoint = kind === 'atom' ? '/memory/atoms/archive' : '/memory/scenes/archive'
      await apiClient.post(endpoint, { memoryIds: ids })
      toast.success('已归档')
      fetchMemory()
    } catch (err) {
      toast.error(err?.message || '归档失败')
    }
  }

  return (
    <div>
      <div className="sys-toolbar">
        <span className="meta">
          共 {atoms.length} 条原子事实 · {scenes.length} 个场景块
        </span>
        <select className="input" style={{ width: 120 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="draft">待确认</option>
          <option value="active">已生效</option>
          <option value="archived">已归档</option>
        </select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={fetchMemory} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {scenes.length === 0 && atoms.length === 0 && !loading && (
        <div className="sys-empty">暂无记忆数据</div>
      )}

      {scenes.length > 0 && (
        <div className="sys-grid">
          {scenes.map((s) => {
            const st = STATUS_MAP[s.status] || STATUS_MAP.draft
            return (
              <div key={s.memorySceneId} className="sys-card">
                <div className="sys-card__hd">
                  <span className="sys-card__title">{s.sceneTitle}</span>
                  <span className={`bdg ${st.cls}`}>
                    <span className="dot" />
                    {st.label}
                  </span>
                </div>
                <div className="sys-card__bd sys-card__bd--col">
                  <div className="sys-field">
                    <span className="sys-field__v" style={{ fontWeight: 500, lineHeight: 1.6 }}>
                      {s.sceneSummary}
                    </span>
                  </div>
                  <div className="sys-field">
                    <span className="sys-field__lb">关联原子</span>
                    <span className="sys-field__v mono">{(s.atomIds || []).length} 条</span>
                  </div>
                </div>
                <div className="sys-card__ft">
                  {s.status === 'draft' && (
                    <button
                      type="button"
                      className="btn btn-pri btn-sm"
                      onClick={() => handleConfirm('scene', [s.memorySceneId])}
                    >
                      确认生效
                    </button>
                  )}
                  {s.status !== 'archived' && (
                    <button
                      type="button"
                      className="btn btn-dan btn-sm"
                      onClick={() => handleArchive('scene', [s.memorySceneId])}
                    >
                      归档
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {atoms.length > 0 && (
        <div className="sys-grid" style={{ marginTop: scenes.length > 0 ? 16 : 0 }}>
          {atoms.map((a) => {
            const st = STATUS_MAP[a.status] || STATUS_MAP.draft
            return (
              <div key={a.memoryAtomId} className="sys-card">
                <div className="sys-card__hd">
                  <span className="sys-card__title mono">{a.factKey}</span>
                  <span className={`bdg ${st.cls}`}>
                    <span className="dot" />
                    {st.label}
                  </span>
                </div>
                <div className="sys-card__bd sys-card__bd--col">
                  <div className="sys-field">
                    <span className="sys-field__v" style={{ fontWeight: 500, lineHeight: 1.6 }}>
                      {a.factText}
                    </span>
                  </div>
                  <div className="sys-field">
                    <span className="sys-field__lb">置信度</span>
                    <span className="sys-field__v">{a.confidence}%</span>
                  </div>
                </div>
                <div className="sys-card__ft">
                  {a.status === 'draft' && (
                    <button
                      type="button"
                      className="btn btn-pri btn-sm"
                      onClick={() => handleConfirm('atom', [a.memoryAtomId])}
                    >
                      确认生效
                    </button>
                  )}
                  {a.status !== 'archived' && (
                    <button
                      type="button"
                      className="btn btn-dan btn-sm"
                      onClick={() => handleArchive('atom', [a.memoryAtomId])}
                    >
                      归档
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
