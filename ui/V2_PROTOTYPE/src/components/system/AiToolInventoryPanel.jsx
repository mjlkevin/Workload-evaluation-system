import { useEffect } from 'react'
import { useAiToolInventory } from '../../hooks/useAiToolInventory.js'

/**
 * 批次 6a：AI 工具清单（系统管理 · 只读）。
 * 数据每次来自 GET /system/ai-tools，即后端运行时 ToolRegistry 的派生视图；
 * 本页不提供启用/停用与审批策略开关（批次 6b）。
 */
export default function AiToolInventoryPanel() {
  const { tools, loading, error, loadTools } = useAiToolInventory()

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const writerCount = tools.filter((tool) => tool.mutates).length
  const callableCount = tools.filter((tool) => tool.callable).length

  return (
    <div>
      <div className="sys-toolbar">
        <span className="meta">
          共 {tools.length} 个工具 · 其中 {writerCount} 个会写数据 · 你本人可调用 {callableCount} 个
          {loading ? ' · 加载中...' : ''}
        </span>
        <button type="button" className="btn btn-out btn-sm" onClick={loadTools} disabled={loading}>
          ↻ 刷新
        </button>
      </div>

      <p className="sys-field__v--dim" style={{ margin: '0 0 12px', fontSize: 12 }}>
        当前工具清单来自代码，不可在此编辑；清单列出系统注册的全部工具，「不可调用」只表示你本人缺少对应权限。启用/停用与审批策略将在后续版本提供。
      </p>

      {error ? (
        <div className="sys-empty">{error}</div>
      ) : tools.length === 0 && !loading ? (
        <div className="sys-empty">暂无已注册的工具</div>
      ) : (
        <div className="sys-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>工具</th>
                <th>说明</th>
                <th>所需权限</th>
                <th>写入</th>
                <th>本人可调用</th>
                <th>分类</th>
                <th>注入方式</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <span className="mono" style={{ fontWeight: 600 }}>{tool.name}</span>
                  </td>
                  <td>
                    <span className="sys-cell-clip" title={tool.description}>{tool.description || '—'}</span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11 }}>{tool.capability || '—'}</span>
                  </td>
                  <td>
                    <span className={`bdg ${tool.mutates ? 'warn' : 'muted'}`}>
                      <span className="dot" />
                      {tool.mutates ? '会写数据' : '只读'}
                    </span>
                  </td>
                  <td>
                    {/* 权限差异不是错误态：不可调用只给中性品牌色，与「会写数据」的琥珀告警区分开 */}
                    <span
                      className={`bdg ${tool.callable ? 'muted' : 'brd'}`}
                      title={
                        tool.callable
                          ? `你本人持有 ${tool.capability}，可直接调用`
                          : `工具已在系统中注册，但你本人缺少 ${tool.capability}，无法调用`
                      }
                    >
                      <span className="dot" />
                      {tool.callable ? '可调用' : '不可调用'}
                    </span>
                  </td>
                  <td>{tool.category ? <span className="tag brd">{tool.category}</span> : '—'}</td>
                  <td>
                    <span className={`tag ${tool.discoverable ? 'brd' : 'acc'}`}>
                      {tool.discoverable ? '按需发现' : '常驻注入'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
