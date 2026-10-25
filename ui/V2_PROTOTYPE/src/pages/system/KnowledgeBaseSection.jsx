import { useRef, useState } from 'react'
import KnowledgeBaseProfilesPanel from '../../components/system/KnowledgeBaseProfilesPanel.jsx'
import SystemObjectDialog, { SystemObjectFacts } from '../../components/system/SystemObjectDialog.jsx'
import { systemButton, systemInput, systemPrimaryButton } from '../../components/system/SystemObjectList.jsx'

export default function KnowledgeBaseSection({ config, loading, error, busy, testingProfileId, onRetry, onChange, onTest, onClearKey }) {
  const [editor, setEditor] = useState(null)
  const [original, setOriginal] = useState('')
  const [validation, setValidation] = useState('')
  const opener = useRef(null)
  const open = () => {
    const candidate = { model: config.model, apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey, retrievalParams: { ...config.retrievalParams } }
    setEditor(candidate); setOriginal(JSON.stringify(candidate)); setValidation('')
  }
  const field = (key, value) => setEditor((current) => ({ ...current, [key]: value }))
  const param = (key, value) => setEditor((current) => ({ ...current, retrievalParams: { ...current.retrievalParams, [key]: value } }))
  const apply = () => {
    const params = editor.retrievalParams
    if (!editor.model.trim() || !/^https?:\/\//i.test(editor.apiBaseUrl.trim()) || !Number.isInteger(params.topK) || params.topK < 1 || params.topK > 50 || !Number.isInteger(params.topN) || params.topN < 1 || params.topN > 100 || !Number.isFinite(params.fractionalThreshold) || params.fractionalThreshold < 0 || params.fractionalThreshold > 1) {
      setValidation('请填写模型、有效的 API Base URL，并检查检索参数范围'); return
    }
    onChange({ ...editor, model: editor.model.trim(), apiBaseUrl: editor.apiBaseUrl.trim() }); setEditor(null)
  }
  if (loading) return <div role="status" className="rounded-lg border border-solid border-line bg-surface p-8 text-center text-sm text-ink-2">正在加载知识库配置…</div>
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-solid border-err/30 bg-err-soft p-4 text-sm text-err-ink"><span>{error}</span><button type="button" className={systemButton} onClick={onRetry}>重试</button></div>
  return <div className="space-y-6">
    <section aria-label="共享接入配置" className="space-y-4 rounded-lg border border-solid border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-sm font-semibold text-ink">智谱共享接入配置</h3><div className="flex flex-wrap gap-2">{config.apiHint && !config.apiKey && <button type="button" className={systemButton} disabled={busy} onClick={onClearKey}>清除已保存密钥</button>}<button ref={opener} type="button" className={systemButton} disabled={busy} onClick={open}>编辑共享接入</button></div></div>
      <SystemObjectFacts items={[{ label: '模型', value: config.model }, { label: 'API Base URL', value: config.apiBaseUrl }, { label: 'API Key', value: config.apiKey ? '有本地密钥待保存' : config.apiHint || '未配置' }, { label: '检索参数', value: `Top K ${config.retrievalParams.topK} · Top N ${config.retrievalParams.topN} · ${config.retrievalParams.rerankStatus === 1 ? '已启用重排' : '未启用重排'}` }]} />
    </section>
    <KnowledgeBaseProfilesPanel profiles={config.knowledgeBases} probes={config.probes} disabled={busy} testingProfileId={testingProfileId} onChange={(knowledgeBases) => onChange({ knowledgeBases })} onTest={onTest} />
    <SystemObjectDialog open={Boolean(editor)} title="编辑共享接入" description="应用到本地草稿后，需保存草稿并测试再生效。" onClose={() => setEditor(null)} dirty={Boolean(editor) && JSON.stringify(editor) !== original} busy={busy} fallbackFocusRef={opener}
      footer={(requestClose) => <><button type="button" className={systemButton} onClick={requestClose} disabled={busy}>取消</button><button type="button" className={systemPrimaryButton} onClick={apply} disabled={busy}>应用到本地草稿</button></>}>
      {editor && <div className="space-y-4">
        {validation && <div role="alert" className="text-sm text-err-ink">{validation}</div>}
        <label className="block space-y-1 text-sm text-ink">API Key<input type="password" className={systemInput} autoComplete="new-password" placeholder="输入智谱 API Key" value={editor.apiKey} onChange={(event) => field('apiKey', event.target.value)} /><span className="block text-xs text-ink-2">留空保留已保存密钥{config.apiHint ? ` ${config.apiHint}` : ''}</span></label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm text-ink">模型<input className={systemInput} value={editor.model} onChange={(event) => field('model', event.target.value)} /></label><label className="space-y-1 text-sm text-ink">API Base URL<input className={systemInput} value={editor.apiBaseUrl} onChange={(event) => field('apiBaseUrl', event.target.value)} /></label></div>
        <fieldset className="m-0 rounded-md border border-solid border-line p-4"><legend className="px-1 text-sm font-semibold text-ink">检索参数</legend><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-ink">Top K<input className={systemInput} type="number" min="1" max="50" value={editor.retrievalParams.topK} onChange={(event) => param('topK', Number(event.target.value))} /></label>
          <label className="space-y-1 text-sm text-ink">Top N<input className={systemInput} type="number" min="1" max="100" value={editor.retrievalParams.topN} onChange={(event) => param('topN', Number(event.target.value))} /></label>
          <label className="space-y-1 text-sm text-ink">召回方式<select className={systemInput} value={editor.retrievalParams.recallMethod} onChange={(event) => param('recallMethod', event.target.value)}><option value="mixed">混合检索</option><option value="vector">向量检索</option><option value="keyword">关键词检索</option></select></label>
          <label className="space-y-1 text-sm text-ink">相似度阈值<input className={systemInput} type="number" min="0" max="1" step="0.05" value={editor.retrievalParams.fractionalThreshold} onChange={(event) => param('fractionalThreshold', Number(event.target.value))} /></label>
          <label className="space-y-1 text-sm text-ink">重排模型<input className={systemInput} value={editor.retrievalParams.rerankModel} onChange={(event) => param('rerankModel', event.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={editor.retrievalParams.rerankStatus === 1} onChange={(event) => param('rerankStatus', event.target.checked ? 1 : 0)} />启用检索重排</label>
        </div><p className="mb-0 mt-3 text-xs leading-5 text-ink-2">开启需账号具备重排权限且填写供应商认可的重排模型名，否则连通性测试会失败。</p></fieldset>
      </div>}
    </SystemObjectDialog>
  </div>
}
