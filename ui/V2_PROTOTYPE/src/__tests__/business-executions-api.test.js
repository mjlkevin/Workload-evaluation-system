import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import { listExecutionCatalog, listBusinessRuns, startBusinessExecution, submitBusinessInput, decideBusinessAction, retryBusinessExecution, uploadExecutionSource, listExecutionTemplates, recommendBusinessExecutions } from '../api/businessExecutions.js'
vi.mock('../api/client.js', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), upload: vi.fn() } }))
beforeEach(() => { vi.clearAllMocks(); apiClient.get.mockResolvedValue({ data: { items: [] } }); apiClient.post.mockResolvedValue({ data: { runId: 'r1' } }) })
describe('工作台业务执行API命令', () => {
  it('推荐仅向现有鉴权客户端发送goal，不创建会话或业务Run', async () => {
    apiClient.post.mockResolvedValue({ data: { outcome: 'no_match', items: [] } })
    expect(await recommendBusinessExecutions('拆解需求')).toEqual({ outcome: 'no_match', items: [] })
    expect(apiClient.post).toHaveBeenCalledWith('/ai-executions/recommendations', { goal: '拆解需求' }, { suppressUnauthorizedRedirect: true })
    expect(apiClient.get).not.toHaveBeenCalled(); expect(apiClient.upload).not.toHaveBeenCalled()
  })
  it('从已鉴权客户端读取目录与当前会话Run', async () => {
    await listExecutionCatalog(); await listBusinessRuns('session-a')
    expect(apiClient.get.mock.calls.map(call => call.slice(0, 2))).toEqual([['/ai-executions/catalog', undefined], ['/ai-executions/runs', { sessionId: 'session-a' }]])
  })
  it('启动仅发送业务选择和输入，排除客户端authority字段', async () => {
    await startBusinessExecution('session-a', { submissionKey: 'key-a', content: '需求整理', execution: { kind: 'workflow', workflowId: 'flow-a', input: { title: '订单' }, versionId: 'forbidden', ownerId: 'forbidden', approved: true } })
    expect((apiClient.post.mock.calls[0] || []).slice(0, 2)).toEqual(['/ai-sessions/session-a/runs', { submissionKey: 'key-a', content: '需求整理', execution: { kind: 'workflow', workflowId: 'flow-a', input: { title: '订单' } } }])
  })
  it('输入逐字携带服务器等待标识，批准/拒绝区分workflow和operation摘要', async () => {
    const input = { actionId: 'server/a', kind: 'userInput', stepId: 'step-a', contentHash: 'input-hash', outputSchema: { type: 'object' } }
    await submitBusinessInput('r1', input, { answer: '同意范围' })
    await decideBusinessAction('r1', { actionId: 'server/b', kind: 'confirmation', stepId: 'step-b', contentHash: 'confirm-hash' }, 'confirm')
    await decideBusinessAction('r1', { actionId: 'server/c', confirmationHash: 'operation-hash' }, 'reject')
    expect(apiClient.post.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['/ai-runs/r1/inputs', { actionId: 'server/a', kind: 'userInput', stepId: 'step-a', contentHash: 'input-hash', input: { answer: '同意范围' } }],
      ['/ai-runs/r1/actions/server%2Fb/confirm', { stepId: 'step-b', contentHash: 'confirm-hash' }],
      ['/ai-runs/r1/actions/server%2Fc/reject', { confirmationHash: 'operation-hash' }],
    ])
  })
  it('重试只发送明确原因及幂等key', async () => {
    await retryBusinessExecution('r1', { submissionKey: 'retry-a', reason: '重新执行失败步骤', approved: true })
    expect((apiClient.post.mock.calls[0] || []).slice(0, 2)).toEqual(['/ai-runs/r1/retry', { submissionKey: 'retry-a', reason: '重新执行失败步骤' }])
  })
})

  it('上传真实FormData到当前会话，不通过JSON post且不启动Run', async () => {
    const file = new File(['需求正文'], '需求.md', { type: 'text/markdown' })
    apiClient.upload.mockResolvedValue({ data: { attachmentId: 'file-server', sourceAvailable: true } })
    expect(await uploadExecutionSource('session/a', file)).toEqual({ attachmentId: 'file-server', sourceAvailable: true })
    const [path, body, options] = apiClient.upload.mock.calls[0]
    expect(path).toBe('/ai-sessions/session%2Fa/execution-sources')
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file')).toBe(file)
    expect(options).toEqual({ suppressUnauthorizedRedirect: true })
    expect(apiClient.post).not.toHaveBeenCalled()
  })
  it('解包实际模板list并只发送允许的模板资产引用', async () => {
    const templates = [{ templateId: 'actual-template', templateVersion: 'V3', templateName: '交付评估' }]
    apiClient.get.mockResolvedValue({ data: { list: templates } })
    expect(await listExecutionTemplates()).toEqual(templates)
    await startBusinessExecution('session-a', { submissionKey: 'key-assets', execution: { kind: 'skill', skillId: 'skill-a', input: { templateId: 'actual-template' }, assets: [{ kind: 'assessment-catalog', templateId: 'actual-template', catalog: ['forged'], grants: ['forged'] }, { kind: 'unknown', templateId: 'forged' }] } })
    expect(apiClient.post.mock.calls[0][1].execution.assets).toEqual([{ kind: 'assessment-catalog', templateId: 'actual-template' }])
  })
