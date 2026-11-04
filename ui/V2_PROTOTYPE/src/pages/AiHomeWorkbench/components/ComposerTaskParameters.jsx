import { Dialog, DialogActions } from '../../../components/ui/Dialog.jsx'
import BusinessInputForm from './BusinessInputForm.jsx'

export default function ComposerTaskParameters({ invocation }) {
  const { parameters, busy, error, templates, templatesLoading, templateError } = invocation
  return <Dialog open={!!parameters} title="补充任务参数" onClose={invocation.cancelParameters} dismissDisabled={busy} wide>
    {parameters && <form noValidate onSubmit={event => { event.preventDefault(); invocation.submitParameters() }} className="grid min-w-0 gap-4" aria-busy={busy}>
      <p className="m-0 text-sm text-ink-2">{parameters.draft.task.name}</p>
      <BusinessInputForm schema={parameters.draft.task.inputSchema} value={parameters.input} errors={parameters.errors} disabled={busy}
        resourceOptions={{ byPath: { templateId: templates.map(item => ({ id: item.templateId, name: `${item.templateName || item.templateId} · ${item.templateVersion || '当前版本'}` })) } }} onChange={invocation.changeInput} />
      {templatesLoading && <p role="status" className="m-0 text-sm text-ink-2">评估模板加载中…</p>}
      {templateError && <div role="alert" className="text-sm text-err-ink">{templateError}<button type="button" className="btn btn-out ml-2" onClick={invocation.loadTemplates}>重试加载模板</button></div>}
      {parameters.draft.file && <p className="m-0 break-words text-sm text-ink-2">附件：{parameters.draft.file.name}</p>}
      {error && <p role="alert" className="m-0 text-sm text-err-ink">{error}</p>}
      <DialogActions><button type="button" className="btn btn-out" disabled={busy} onClick={invocation.cancelParameters}>返回编辑</button><button type="submit" className="btn btn-primary" disabled={busy || templatesLoading}>{busy ? '正在发送…' : '发送任务'}</button></DialogActions>
    </form>}
  </Dialog>
}
