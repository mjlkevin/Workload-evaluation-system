import { useRef, useState } from 'react'
import SystemObjectList, { SystemBadge, systemButton, systemInput, systemPrimaryButton, systemTextButton } from '../../components/system/SystemObjectList.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'
const statuses = { passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过' }
const blank = { executorName: '', environment: '', account: '', testCaseKey: '', resultStatus: 'passed', screenshotUrl: '', notes: '' }
function screenshotLink(value) {
  if (!value) return null
  try { const url = new URL(value, window.location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}
export default function TestResultsSection({ rows, loading, error, moreLoading, hasMore, onRetry, onLoadMore, onCreate, onDelete }) {
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const search = useRef(null)
  const busyRef = useRef(false)
  const label = (row) => row.testCaseKey || row.manualTestResultId
  const open = (kind, row) => { setDialog({ kind, row }); setActionError(''); if (kind === 'create') setForm({ ...blank }) }
  const close = () => { if (!busyRef.current) { setDialog(null); setActionError('') } }
  const perform = async () => {
    if (busyRef.current) return
    if (dialog.kind === 'create' && (!form.executorName.trim() || !form.environment.trim())) { setActionError('执行人和环境必填'); return }
    busyRef.current = true; setBusy(true); setActionError('')
    try {
      if (dialog.kind === 'create') {
        const result = await onCreate({ ...form, executorName: form.executorName.trim(), environment: form.environment.trim() })
        if (result?.success === false) throw new Error(result.error || '创建失败')
      } else await onDelete(dialog.row.harnessRunId, dialog.row.manualTestResultId)
      setDialog(null)
    } catch (failure) { setActionError(`${dialog.kind === 'create' ? '创建' : '删除'}失败：${failure?.message || '请重试'}`) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const row = dialog?.row
  const imageUrl = screenshotLink(row?.screenshotUrl)
  return <div className="space-y-3">
    <p className="m-0 text-xs leading-6 text-ink-2">已加载 {rows.length} 条人工测试结果 · 每批读取 20 条，搜索与筛选仅针对已加载记录</p>
    <SystemObjectList title="人工测试结果" rows={rows} rowKey="manualTestResultId" loading={loading} error={error} onRetry={onRetry} searchInputRef={search}
      searchText={(item) => [item.testCaseKey, item.manualTestResultId, item.harnessRunId, item.executorName, item.environment, item.account, item.notes].join(' ')}
      filters={Object.entries(statuses).map(([value, name]) => ({ value, label: name, matches: (item) => item.resultStatus === value }))}
      actions={<button type="button" className={systemPrimaryButton} onClick={() => open('create')} disabled={loading || Boolean(error) || moreLoading || busy}>+ 新建</button>}
      columns={[
        { key: 'testCaseKey', label: '用例', render: (item) => <span className="font-medium wrap-anywhere">{label(item)}</span> },
        { key: 'executorName', label: '执行人', hideBelow: 'md' },
        { key: 'environment', label: '环境', hideBelow: 'lg' },
        { key: 'resultStatus', label: '结果', render: (item) => <SystemBadge tone={item.resultStatus === 'passed' ? 'ok' : item.resultStatus === 'failed' || item.resultStatus === 'blocked' ? 'warn' : 'neutral'}>{statuses[item.resultStatus] || item.resultStatus || '未知'}</SystemBadge> },
        { key: 'createdAt', label: '登记时间', hideBelow: 'lg', render: (item) => <span className="text-xs text-ink-2">{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '—'}</span> },
        { key: 'actions', label: '操作', className: 'w-28 whitespace-nowrap', render: (item) => <div className="flex items-center justify-end"><button type="button" aria-label={`查看 ${label(item)}`} className={systemTextButton} onClick={() => open('detail', item)}>查看</button><button type="button" aria-label={`删除 ${label(item)}`} className={systemTextButton} disabled={busy || moreLoading} onClick={() => open('delete', item)}>删除</button></div> },
      ]} />
    {!loading && !error && hasMore && <button type="button" className={systemButton} disabled={moreLoading || busy} onClick={onLoadMore}>{moreLoading ? '加载更多中…' : '加载更多记录'}</button>}
    <SystemObjectDialog open={Boolean(dialog)} title={dialog?.kind === 'create' ? '新建人工测试结果' : dialog?.kind === 'delete' ? '删除人工测试结果' : '人工测试结果详情'} onClose={close} busy={busy}
      dirty={dialog?.kind === 'create' && JSON.stringify(form) !== JSON.stringify(blank)} fallbackFocusRef={search}
      footer={(requestClose) => dialog?.kind === 'detail' ? <button type="button" className={systemButton} onClick={requestClose}>关闭</button> : <><button type="button" className={systemButton} disabled={busy} onClick={requestClose}>取消</button><button type="button" className={systemPrimaryButton} disabled={busy} onClick={perform}>{dialog?.kind === 'create' ? busy ? '保存中…' : '确定' : busy ? '删除中…' : '确认删除'}</button></>}>
      {actionError && <div role="alert" className="mb-4 rounded-md bg-err-soft p-3 text-sm leading-6 text-err-ink">{actionError}</div>}
      {dialog?.kind === 'create' ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Object.entries({ executorName: '执行人 *', environment: '环境 *', account: '账号', testCaseKey: '用例编号', screenshotUrl: '截图 URL' }).map(([key, title]) => <label key={key} className="space-y-1 text-sm text-ink">{title}<input className={systemInput} value={form[key]} disabled={busy} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <label className="space-y-1 text-sm text-ink">结果状态 *<select className={systemInput} disabled={busy} value={form.resultStatus} onChange={(event) => setForm((current) => ({ ...current, resultStatus: event.target.value }))}>{Object.entries(statuses).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
        <label className="space-y-1 text-sm text-ink sm:col-span-2">备注<textarea className={`${systemInput.replace('h-9', 'min-h-24')} py-2`} disabled={busy} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      </div> : dialog?.kind === 'delete' ? <p className="m-0 text-sm leading-6 text-ink">确认删除用例 {label(row)} 的人工测试结果？</p> : row && <SystemObjectFacts items={[
        { label: '用例', value: row.testCaseKey }, { label: '结果', value: statuses[row.resultStatus] || row.resultStatus }, { label: '执行人', value: row.executorName }, { label: '环境', value: row.environment }, { label: '账号', value: row.account }, { label: '截图', value: imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" className="text-brand-ink underline">查看截图</a> : row.screenshotUrl || '—' },
        { label: '备注', value: <span className="whitespace-pre-wrap">{row.notes || '—'}</span> }, { label: '结果 ID', value: row.manualTestResultId }, { label: '运行 ID', value: row.harnessRunId }, { label: '工具事件 ID', value: row.harnessToolEventId }, { label: '附加信息', value: row.metadata == null ? '—' : <span className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(row.metadata, null, 2)}</span> }, { label: '登记时间', value: row.createdAt }, { label: '更新时间', value: row.updatedAt },
      ]} />}
    </SystemObjectDialog>
  </div>
}
