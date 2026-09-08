import React, { useCallback, useMemo, useState } from 'react'
import ListPage from '../components/ListPage.jsx'
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
import { getBaseManagementSectionById } from '../config/baseManagementSections.js'
import { useIndustryMasterData } from '../hooks/useIndustryMasterData.js'

// ============================================================
// 批次 10a · 【基础管理 → 行业】
// ============================================================
// 列表用现成 ListPage（自带搜索与筛选），行级编辑走弹窗——
// AGENTS.md §7：表格行级编辑默认弹窗，不在列表上方插临时编辑容器。
//
// 界面上**没有删除按钮**：行业主数据禁止硬删（历史记录按名称文本引用行业）。
// 这只是三层禁止里的第一层，真正的拒绝落在数据层与契约层，见
// apps/api/src/db/schema/industry.ts 文件头。这里不给入口是为了不让用户
// 以为「能删但删了会出事」，而不是靠界面兜住规矩。

const LEVEL_TAGS = [
  { key: 'all', label: '全部' },
  { key: 'level1', label: '一级大类', predicate: (r) => r.level === 1 },
  { key: 'level2', label: '二级细分', predicate: (r) => r.level === 2 },
  { key: 'inactive', label: '已停用', predicate: (r) => r.status === 'inactive' },
]

// 不提供 delete：批量动作里根本没有这一项
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

function LevelBadge({ level }) {
  return <span className={`bdg ${level === 1 ? 'brd' : 'draft'}`}>{level === 1 ? '一级' : '二级'}</span>
}

export default function IndustryMasterData({ sectionId = 'industries' }) {
  const section = getBaseManagementSectionById(sectionId)
  const { tree, rows, categoryChoices, loading, loadError, busy, refetch, createCategory, createSubcategory, rename, setStatus } =
    useIndustryMasterData()
  // dialog: null | { mode: 'new-category' } | { mode: 'new-subcategory' } | { mode: 'rename', row }
  const [dialog, setDialog] = useState(null)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const openDialog = useCallback((next) => {
    setError(null)
    setFeedback(null)
    setName('')
    setParentId('')
    setDialog(next)
  }, [])

  const closeDialog = useCallback(() => setDialog(null), [])

  const kpiCards = useMemo(() => {
    const categories = tree.length
    const subs = tree.reduce((sum, c) => sum + (c.children?.length ?? 0), 0)
    const inactive =
      tree.filter((c) => c.status !== 'active').length +
      tree.reduce((sum, c) => sum + (c.children ?? []).filter((s) => s.status !== 'active').length, 0)
    return [
      { ic: '▦', lb: '行业大类', num: String(categories), pct: categories ? 100 : 0, sub: '一级节点' },
      { ic: '└', lb: '行业细分', num: String(subs), pct: categories ? Math.min(100, (subs / categories) * 50) : 0, sub: '二级节点（首批留空，由你维护）' },
      { ic: '⏸', lb: '已停用', num: String(inactive), pct: inactive ? 100 : 0, sub: '停用只挡新单据，不影响历史记录', barColor: 'var(--warn)' },
    ]
  }, [tree])

  const report = useCallback((result, okMessage) => {
    if (result.ok) {
      setDialog(null)
      setFeedback({ message: okMessage, role: 'status' })
      return
    }
    // 失败留在弹窗里让人改，不关窗不回显——关掉就等于「刚刚那下白点了」
    setError(result.error)
  }, [])

  const submit = useCallback(
    (event) => {
      event.preventDefault()
      const trimmed = name.trim()
      if (!trimmed) {
        setError('名称不能为空')
        return
      }
      if (dialog?.mode === 'new-category') {
        report(createCategory({ name: trimmed }), `已新增行业大类「${trimmed}」`)
        return
      }
      if (dialog?.mode === 'new-subcategory') {
        if (!parentId) {
          setError('请选择所属行业大类')
          return
        }
        report(createSubcategory({ categoryId: parentId, name: trimmed }), `已新增行业细分「${trimmed}」`)
        return
      }
      if (dialog?.mode === 'rename') {
        report(rename(dialog.row, trimmed), `已改名为「${trimmed}」`)
      }
    },
    [dialog, name, parentId, createCategory, createSubcategory, rename, report],
  )

  const handleBulkAction = useCallback(
    async (actionKey, selectedRows) => {
      const row = selectedRows[0]
      if (!row) return
      setFeedback(null)
      if (actionKey === 'edit') {
        setName(row.name)
        setDialog({ mode: 'rename', row })
        return
      }
      if (actionKey === 'disable' || actionKey === 'enable') {
        const status = actionKey === 'disable' ? 'inactive' : 'active'
        const result = await setStatus(row, status)
        if (result.ok) {
          setFeedback({
            message:
              status === 'inactive'
                ? `已停用「${row.name}」：新单据选不到它，历史记录照常显示这个值。`
                : `已启用「${row.name}」，新单据可重新选到它。`,
            role: 'status',
          })
        } else {
          setFeedback({ message: result.error, role: 'alert' })
        }
      }
    },
    [setStatus],
  )

  const newSubDisabled = busy || categoryChoices.length === 0

  return (
    <>
      <ListPage
        crumb={`基础管理 / ${section.label}`}
        title={section.label}
        subtitle={section.subtitle}
        kpiCards={kpiCards}
        data={rows}
        loading={loading}
        loadingText="正在加载行业主数据…"
        error={loadError}
        errorText="加载行业主数据失败，请检查网络后重试"
        onRetry={refetch}
        feedback={feedback}
        rowKey="key"
        filterTags={LEVEL_TAGS}
        bulkActions={BULK_ACTIONS}
        onBulkAction={handleBulkAction}
        emptyText="还没有行业数据"
        emptyAction={
          <button type="button" className="btn btn-pri" onClick={() => openDialog({ mode: 'new-category' })}>
            + 新增行业大类
          </button>
        }
        columns={[
          { key: 'level', title: '层级', nowrap: true, render: (r) => <LevelBadge level={r.level} /> },
          {
            key: 'name',
            title: '名称',
            render: (r) => (
              <div>
                <b className={r.level === 2 ? 'pl-4 text-ink-2' : ''}>{r.level === 2 ? `└ ${r.name}` : r.name}</b>
              </div>
            ),
          },
          { key: 'categoryName', title: '所属大类', render: (r) => r.categoryName ?? '—' },
          { key: 'childCount', title: '细分数', align: 'right', render: (r) => (r.level === 1 ? r.childCount : '—') },
          { key: 'status', title: '状态', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'sortOrder', title: '排序', align: 'right' },
        ]}
        actions={[
          <button
            type="button"
            key="new-cat"
            className="btn btn-pri"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={busy}
            onClick={() => openDialog({ mode: 'new-category' })}
          >
            + 新增大类
          </button>,
          <button
            type="button"
            key="new-sub"
            className="btn btn-out"
            style={{ height: 32, padding: '0 14px', fontSize: 13 }}
            disabled={newSubDisabled}
            title={categoryChoices.length === 0 ? '需先有一个启用中的行业大类' : undefined}
            onClick={() => openDialog({ mode: 'new-subcategory' })}
          >
            + 新增细分
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
        open={dialog !== null}
        title={
          dialog?.mode === 'new-category'
            ? '新增行业大类'
            : dialog?.mode === 'new-subcategory'
              ? '新增行业细分'
              : '修改名称'
        }
        description={
          dialog?.mode === 'new-subcategory'
            ? '细分挂在某个大类之下；本系统只到两层，细分下面不能再挂分类。'
            : undefined
        }
        onClose={busy ? undefined : closeDialog}
        dismissDisabled={busy}
      >
        <form onSubmit={submit}>
          {dialog?.mode === 'new-subcategory' && (
            <div className="mb-[10px]">
              <label className={FIELD_LABEL} htmlFor="industry-parent">
                所属行业大类
              </label>
              <select
                id="industry-parent"
                className={FIELD_INPUT}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">请选择…</option>
                {categoryChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="mb-[10px]">
            <label className={FIELD_LABEL} htmlFor="industry-name">
              名称
            </label>
            <input
              id="industry-name"
              type="text"
              className={FIELD_INPUT}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={dialog?.mode === 'new-subcategory' ? '如：离散制造' : '如：零售业'}
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
            <button
              type="submit"
              className="btn btn-pri"
              style={{ height: 30, fontSize: 12, padding: '0 14px' }}
              disabled={busy}
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  )
}
