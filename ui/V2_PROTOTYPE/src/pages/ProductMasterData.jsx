import React, { useCallback, useMemo, useState } from 'react'

import ListPage from '../components/ListPage.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import { getBaseManagementSectionById } from '../config/baseManagementSections.js'
import { useProductMasterData } from '../hooks/useProductMasterData.js'

// ============================================================
// 批次 10b · 【基础管理 → 产品主数据】
// ============================================================
// 列表用 ListPage，行级编辑走弹窗；不提供删除（只停用）。

const FILTER_TAGS = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '启用中', predicate: (r) => r.status === 'active' },
  { key: 'inactive', label: '已停用', predicate: (r) => r.status === 'inactive' },
]

const BULK_ACTIONS = [
  { key: 'edit', label: '✏ 修改', mode: 'single' },
  { key: 'disable', label: '⏸ 停用', mode: 'single' },
  { key: 'enable', label: '▶ 启用', mode: 'single' },
]

const FIELD_LABEL = 'block text-[11px] text-ink-3 mb-1 font-semibold'
const FIELD_INPUT =
  'w-full px-[10px] py-2 border border-line rounded-md text-[13px] outline-none bg-surface text-ink'

function StatusBadge({ status }) {
  const active = status === 'active'
  return (
    <span className={`bdg ${active ? 'ci' : 'muted'}`}>
      <span className="dot" />
      {active ? '启用中' : '已停用'}
    </span>
  )
}

const ENTITY_TYPES = [
  { key: 'line', label: '产品' },
  { key: 'sku', label: 'SKU' },
  { key: 'module', label: '模块' },
]

export default function ProductMasterData({ sectionId = 'products' }) {
  const section = getBaseManagementSectionById(sectionId)
  const {
    rows,
    options,
    loading,
    loadError,
    busy,
    refetch,
    createEntity,
    createAssignment,
    updateAssignment,
    setStatus,
  } = useProductMasterData()

  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({})
  const [error, setError] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const openDialog = useCallback((next, initial = {}) => {
    setError(null)
    setFeedback(null)
    setForm(initial)
    setDialog(next)
  }, [])

  const closeDialog = useCallback(() => setDialog(null), [])

  const kpiCards = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active').length
    const inactive = rows.filter((r) => r.status === 'inactive').length
    return [
      { ic: '产', lb: '关联条目', num: String(rows.length), pct: rows.length ? 100 : 0, sub: '(产品, SKU, 模块)' },
      { ic: '▶', lb: '启用中', num: String(active), pct: rows.length ? Math.round((active / rows.length) * 100) : 0 },
      { ic: '⏸', lb: '已停用', num: String(inactive), pct: inactive ? 100 : 0, sub: '停用只挡新单据', barColor: 'var(--warn)' },
    ]
  }, [rows])

  const report = useCallback((result, okMessage) => {
    if (result.ok) {
      setDialog(null)
      setFeedback({ message: okMessage, role: 'status' })
      return
    }
    setError(result.error)
  }, [])

  const submitEntity = useCallback(
    (event) => {
      event.preventDefault()
      const name = String(form.name || '').trim()
      if (!name) {
        setError('名称不能为空')
        return
      }
      report(createEntity(dialog.entityType, { name }), `已新增${dialog.label}「${name}」`)
    },
    [dialog, form, createEntity, report],
  )

  const submitAssignment = useCallback(
    (event) => {
      event.preventDefault()
      const productId = String(form.productId || '').trim()
      const skuId = String(form.skuId || '').trim()
      const moduleId = String(form.moduleId || '').trim()
      const standardDays = Number(form.standardDays)
      if (!productId || !skuId || !moduleId) {
        setError('产品、SKU、模块均不能为空')
        return
      }
      if (!Number.isFinite(standardDays) || standardDays < 0) {
        setError('标准人天必须大于等于 0')
        return
      }
      if (dialog?.mode === 'new-assignment') {
        report(
          createAssignment({ productId, skuId, moduleId, standardDays }),
          '已新增 (产品, SKU, 模块) 关联',
        )
      } else if (dialog?.mode === 'edit-assignment') {
        report(updateAssignment(dialog.row.id, { standardDays }), '已更新标准人天')
      }
    },
    [dialog, form, createAssignment, updateAssignment, report],
  )

  const handleBulkAction = useCallback(
    async (actionKey, selectedRows) => {
      const row = selectedRows[0]
      if (!row) return
      setFeedback(null)
      if (actionKey === 'edit') {
        openDialog({ mode: 'edit-assignment', label: '修改标准人天', row }, { standardDays: row.standardDays })
        return
      }
      if (actionKey === 'disable' || actionKey === 'enable') {
        const status = actionKey === 'disable' ? 'inactive' : 'active'
        const result = await setStatus(row, status)
        if (result.ok) {
          setFeedback({
            message:
              status === 'inactive'
                ? `已停用「${row.itemName}」：新评估选不到它。`
                : `已启用「${row.itemName}」，新评估可重新选到它。`,
            role: 'status',
          })
        } else {
          setFeedback({ message: result.error, role: 'alert' })
        }
      }
    },
    [setStatus, openDialog],
  )

  return (
    <>
      <ListPage
        crumb={`基础管理 / ${section.label}`}
        title={section.label}
        subtitle={section.subtitle}
        kpiCards={kpiCards}
        data={rows}
        loading={loading}
        loadingText="正在加载产品主数据…"
        error={loadError}
        errorText="加载产品主数据失败，请检查网络后重试"
        onRetry={refetch}
        feedback={feedback}
        rowKey="id"
        filterTags={FILTER_TAGS}
        bulkActions={BULK_ACTIONS}
        onBulkAction={handleBulkAction}
        emptyText="还没有产品主数据"
        emptyAction={
          <button type="button" className="btn btn-pri" onClick={() => openDialog({ mode: 'new-entity', label: '产品', entityType: 'line' })}>
            + 新增产品
          </button>
        }
        columns={[
          { key: 'productName', title: '产品' },
          { key: 'skuName', title: 'SKU' },
          { key: 'moduleName', title: '模块' },
          { key: 'itemName', title: '条目名' },
          { key: 'standardDays', title: '标准人天', align: 'right' },
          { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
        ]}
        actions={[
          <button
            type="button"
            key="new-line"
            className="btn btn-pri"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => openDialog({ mode: 'new-entity', label: '产品', entityType: 'line' })}
          >
            + 产品
          </button>,
          <button
            type="button"
            key="new-sku"
            className="btn btn-out"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => openDialog({ mode: 'new-entity', label: 'SKU', entityType: 'sku' })}
          >
            + SKU
          </button>,
          <button
            type="button"
            key="new-module"
            className="btn btn-out"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => openDialog({ mode: 'new-entity', label: '模块', entityType: 'module' })}
          >
            + 模块
          </button>,
          <button
            type="button"
            key="new-assignment"
            className="btn btn-out"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={busy || options.products.length === 0 || options.skus.length === 0 || options.modules.length === 0}
            onClick={() => openDialog({ mode: 'new-assignment', label: '新增关联' })}
          >
            + 关联
          </button>,
          <button
            type="button"
            key="refresh"
            className="btn btn-out"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            onClick={() => refetch()}
          >
            ⟳ 刷新
          </button>,
        ]}
      />

      <Dialog
        open={dialog?.mode === 'new-entity'}
        title={`新增${dialog?.label || ''}`}
        onClose={busy ? undefined : closeDialog}
        dismissDisabled={busy}
      >
        <form onSubmit={submitEntity}>
          <div className="mb-[10px]">
            <label className={FIELD_LABEL} htmlFor="entity-name">
              名称
            </label>
            <input
              id="entity-name"
              type="text"
              className={FIELD_INPUT}
              value={form.name || ''}
              autoFocus
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={`如：${dialog?.entityType === 'line' ? '金蝶云·星空' : dialog?.entityType === 'sku' ? '标准版' : '总账'}`}
            />
          </div>
          {error && (
            <div role="alert" className="text-[12px] text-err bg-err-soft border border-err rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogActions>
            <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={closeDialog}>
              取消
            </button>
            <button type="submit" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        open={dialog?.mode === 'new-assignment' || dialog?.mode === 'edit-assignment'}
        title={dialog?.mode === 'new-assignment' ? '新增 (产品, SKU, 模块) 关联' : '修改标准人天'}
        onClose={busy ? undefined : closeDialog}
        dismissDisabled={busy}
      >
        <form onSubmit={submitAssignment}>
          {dialog?.mode === 'new-assignment' && (
            <>
              <div className="mb-[10px]">
                <label className={FIELD_LABEL}>产品</label>
                <select
                  className={FIELD_INPUT}
                  value={form.productId || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, productId: e.target.value }))}
                >
                  <option value="">请选择…</option>
                  {options.products.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-[10px]">
                <label className={FIELD_LABEL}>SKU</label>
                <select
                  className={FIELD_INPUT}
                  value={form.skuId || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, skuId: e.target.value }))}
                >
                  <option value="">请选择…</option>
                  {options.skus.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-[10px]">
                <label className={FIELD_LABEL}>模块</label>
                <select
                  className={FIELD_INPUT}
                  value={form.moduleId || ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, moduleId: e.target.value }))}
                >
                  <option value="">请选择…</option>
                  {options.modules.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="mb-[10px]">
            <label className={FIELD_LABEL}>标准人天</label>
            <input
              type="number"
              step="0.1"
              className={FIELD_INPUT}
              value={form.standardDays ?? ''}
              autoFocus
              onChange={(e) => setForm((prev) => ({ ...prev, standardDays: e.target.value }))}
              placeholder="如：3.5"
            />
          </div>
          {error && (
            <div role="alert" className="text-[12px] text-err bg-err-soft border border-err rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <DialogActions>
            <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={closeDialog}>
              取消
            </button>
            <button type="submit" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
