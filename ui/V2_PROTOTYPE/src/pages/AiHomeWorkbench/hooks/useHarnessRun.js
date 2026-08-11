import { useState } from 'react'
import { apiClient } from '../../../api/client.js'
import {
  bindHarnessFile,
  confirmHarnessAction,
  createHarnessRun,
  generateHarnessReportV1,
  generateHarnessReportV2,
  submitHarnessAnswers,
  submitHarnessParseResult,
} from '../../../api/harness.js'
import { unwrap } from '../../../api/utils.js'
import { buildHarnessParseResult, pickArray, pickObject } from '../utils/harnessPayload.js'
import { mergeAttachmentUnderstanding } from '../utils/reportParser.js'

/**
 * Harness Run 生命周期：显式报告请求的 v1 流程、下一步动作确认、
 * 卡片补充生成 v2、项目评估创建确认。入口由 useChatMessages 的
 * isExplicitReportRequest 闸门把守，本 hook 不自行触发 Run。
 */
export default function useHarnessRun(workbench, chat) {
  const [confirmingActionId, setConfirmingActionId] = useState('')

  async function runExplicitReportFlow({ text, fileSnapshot, selectedFile, parsed, userMessage, loadingId, localAttachmentUnderstanding }) {
    const workflowKey = workbench.activeWorkflowKey || workbench.activeSession?.workflowKey || 'parse_requirement_file'
    const session = workbench.activeSession || await workbench.createSession({
      title: text.slice(0, 40) || fileSnapshot?.name || 'AI 工作台会话',
      workflowKey,
      status: workflowKey === 'free_chat' ? 'temporary_chat' : 'rough_estimate',
    })
    chat.patchMessage(loadingId, { text: '正在沉淀 evidence 并调用大模型生成需求解析报告' })
    const createdRun = await createHarnessRun({
      title: fileSnapshot.name,
      mode: 'interactive',
      aiSessionId: session?.sessionId,
    })
    const run = createdRun?.run || createdRun
    const bound = await bindHarnessFile(run.harnessRunId, {
      attachmentId: `${Date.now()}-${fileSnapshot.name}`,
      fileName: fileSnapshot.name,
      fileSize: fileSnapshot.size,
      mimeType: fileSnapshot.type,
      role: 'requirement_source',
    })
    await submitHarnessParseResult(run.harnessRunId, {
      fileId: bound?.file?.harnessFileId,
      ...buildHarnessParseResult(selectedFile, parsed),
    })
    const reportDetail = await generateHarnessReportV1(run.harnessRunId, { force: false })
    const reportArtifact = pickArray(reportDetail?.artifacts).find((artifact) => artifact.artifactType === 'requirement_report_v1')
    const understandingArtifact = pickArray(reportDetail?.artifacts).find((artifact) => artifact.artifactType === 'file_understanding')
    if (reportArtifact) {
      reportArtifact.harnessRunId = run.harnessRunId
      reportArtifact.fileUnderstanding = mergeAttachmentUnderstanding(
        localAttachmentUnderstanding,
        pickObject(understandingArtifact?.content),
        pickObject(reportArtifact?.content),
      )
    }
    const assistantMessage = {
      id: `ai-harness-${Date.now()}`,
      role: 'assistant',
      text: '已生成《需求解析报告 v1》，请先补充关键缺失信息。',
      artifacts: reportArtifact ? [reportArtifact] : [],
      model: pickArray(reportDetail?.modelRuns).at(-1)?.model,
      createdAt: new Date().toISOString(),
    }
    chat.replaceMessage(loadingId, assistantMessage)
    if (session) {
      const attachmentId = `harness-att-${Date.now()}`
      const artifactId = reportArtifact?.harnessArtifactId || reportArtifact?.artifactId || `harness-art-${Date.now()}`
      workbench.upsertSession({
        ...session,
        title: session.title || fileSnapshot.name,
        messages: [
          ...(Array.isArray(session.messages) ? session.messages : []),
          {
            messageId: `harness-user-${Date.now()}`,
            role: 'user',
            content: userMessage.text,
            attachmentIds: [attachmentId],
            createdAt: new Date().toISOString(),
          },
          {
            messageId: `harness-ai-${Date.now()}`,
            role: 'assistant',
            content: assistantMessage.text,
            artifactIds: reportArtifact ? [artifactId] : [],
            createdAt: new Date().toISOString(),
          },
        ],
        attachments: [
          ...(Array.isArray(session.attachments) ? session.attachments : []),
          {
            attachmentId,
            name: fileSnapshot.name,
            size: fileSnapshot.size,
            type: fileSnapshot.type,
            createdAt: new Date().toISOString(),
          },
        ],
        artifacts: reportArtifact
          ? [
              ...(Array.isArray(session.artifacts) ? session.artifacts : []),
              {
                artifactId,
                type: reportArtifact.artifactType || reportArtifact.type,
                ...reportArtifact,
              },
            ]
          : (Array.isArray(session.artifacts) ? session.artifacts : []),
        updatedAt: new Date().toISOString(),
      })
    }
  }

  async function handleHarnessAction(artifact, action) {
    if (!artifact?.harnessRunId || !action?.actionType || confirmingActionId) return
    const actionKey = `${artifact.harnessRunId}-${action.actionType}`
    setConfirmingActionId(actionKey)
    try {
      const result = await confirmHarnessAction(artifact.harnessRunId, action.actionType, { confirmed: true, actionType: action.actionType })
      const project = result?.event?.output?.project || {}
      const assessmentDraft = result?.event?.output?.assessmentDraft || {}
      const hasDraft = project.projectId || assessmentDraft.recordId
      const successText = hasDraft
        ? [
            `已生成项目评估草稿：${project.projectName || project.projectId || '未命名项目'}`,
            assessmentDraft.versionCode ? `实施评估草稿：${assessmentDraft.versionCode}` : '',
            '请在传统工作台中人工确认/编辑后再进入正式评估。',
          ].filter(Boolean).join('\n')
        : `已确认「${action.label || action.actionType}」，Harness Run 阶段已推进。`
      const actions = hasDraft && assessmentDraft.recordId
        ? [
            { label: '查看评估草稿', to: `/assessments/${encodeURIComponent(assessmentDraft.recordId)}` },
            { label: '返回实施评估列表', to: '/assessments' },
          ]
        : undefined
      chat.appendMessage({
        id: `ai-harness-action-${Date.now()}`,
        role: 'assistant',
        text: successText,
        actions,
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      chat.appendMessage({
        id: `ai-harness-action-err-${Date.now()}`,
        role: 'assistant',
        text: `动作确认失败：${err.message || '请求失败'}`,
        error: true,
        createdAt: new Date().toISOString(),
      })
    } finally {
      setConfirmingActionId('')
    }
  }

  async function handleStructuredSupplement(artifact, answers) {
    const runId = artifact?.harnessRunId
    if (!runId || !answers?.length) return
    const loadingId = `ai-harness-inline-${Date.now()}-${Math.random().toString(36).slice(2)}`
    chat.setSending(true)
    chat.appendMessage({
      id: loadingId,
      role: 'assistant',
      text: '正在保存卡片补充信息并生成需求解析报告 v2',
      loading: true,
      createdAt: new Date().toISOString(),
    })
    try {
      await submitHarnessAnswers(runId, { answers })
      const reportDetail = await generateHarnessReportV2(runId, { force: false })
      const v2Artifact = pickArray(reportDetail?.artifacts).find((item) => item.artifactType === 'requirement_report_v2')
      if (v2Artifact) v2Artifact.harnessRunId = runId
      const assistantMessage = {
        id: `ai-harness-v2-inline-${Date.now()}`,
        role: 'assistant',
        text: '已基于卡片补充信息生成《需求解析报告 v2》。',
        artifacts: v2Artifact ? [v2Artifact] : [],
        model: pickArray(reportDetail?.modelRuns).at(-1)?.model,
        createdAt: new Date().toISOString(),
      }
      chat.replaceMessage(loadingId, assistantMessage)
      if (workbench.activeSession) {
        const artifactId = v2Artifact?.harnessArtifactId || v2Artifact?.artifactId || `harness-art-v2-inline-${Date.now()}`
        workbench.upsertSession({
          ...workbench.activeSession,
          messages: [
            ...(Array.isArray(workbench.activeSession.messages) ? workbench.activeSession.messages : []),
            {
              messageId: `harness-user-inline-${Date.now()}`,
              role: 'user',
              content: `卡片补充信息：${answers.map((item) => `${item.field}=${item.value}`).join('；')}`,
              createdAt: new Date().toISOString(),
            },
            {
              messageId: `harness-ai-v2-inline-${Date.now()}`,
              role: 'assistant',
              content: assistantMessage.text,
              artifactIds: v2Artifact ? [artifactId] : [],
              createdAt: new Date().toISOString(),
            },
          ],
          artifacts: v2Artifact
            ? [
                ...(Array.isArray(workbench.activeSession.artifacts) ? workbench.activeSession.artifacts : []),
                {
                  artifactId,
                  type: v2Artifact.artifactType || v2Artifact.type,
                  ...v2Artifact,
                },
              ]
            : (Array.isArray(workbench.activeSession.artifacts) ? workbench.activeSession.artifacts : []),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      chat.replaceMessage(loadingId, {
        id: loadingId,
        role: 'assistant',
        text: `卡片补充暂未完成：${err.message || '请求失败'}`,
        error: true,
        createdAt: new Date().toISOString(),
      })
      throw err
    } finally {
      chat.setSending(false)
    }
  }

  async function confirmPendingAction(action) {
    if (action?.actionType !== 'create_project_evaluation') return
    if (confirmingActionId) return
    setConfirmingActionId(action.actionId || action.title || 'confirming')
    const payload = action.payload || {}
    try {
      const response = await apiClient.post('/project-evaluations', {
        projectName: payload.projectName || workbench.activeSession?.title || '未命名项目评估',
        customerName: payload.customerName || '',
        industry: payload.industry || '',
        currentStage: payload.currentStage || 'project_discovery',
        projectStatus: 'draft',
        createdFromSessionId: workbench.activeSession?.sessionId,
      }, { suppressUnauthorizedRedirect: true })
      const project = unwrap(response)?.project
      if (!project) throw new Error('接口未返回项目记录')
      if (workbench.activeSession) {
        workbench.upsertSession({
          ...workbench.activeSession,
          pendingActions: (workbench.activeSession.pendingActions || []).map((item) => (
            item.actionId === action.actionId ? { ...item, status: 'executed', result: { projectId: project.projectId } } : item
          )),
          linkedRecords: {
            ...(workbench.activeSession.linkedRecords || {}),
            projectId: project.projectId,
            projectName: project.projectName,
          },
          updatedAt: new Date().toISOString(),
        })
      }
      chat.appendMessage({
        id: `project-created-${Date.now()}`,
        role: 'assistant',
        text: `项目已创建并关联：${project.projectName || project.projectId}`,
        createdAt: new Date().toISOString(),
      })
      window.dispatchEvent(new CustomEvent('wes-project-evaluation-created', { detail: { project } }))
    } catch (err) {
      const detailReason = err.details?.[0]?.reason || ''
      const errorText = err.status === 401
        ? '项目创建失败：登录已过期，请重新登录后再确认创建。'
        : err.status === 403
          ? `项目创建失败：权限不足${detailReason ? `（${detailReason}）` : ''}。请联系管理员开通项目创建权限。`
          : `项目创建失败：${err.message || '请求失败'}`
      chat.appendMessage({
        id: `project-create-error-${Date.now()}`,
        role: 'assistant',
        text: errorText,
        error: true,
        createdAt: new Date().toISOString(),
      })
    } finally {
      setConfirmingActionId('')
    }
  }

  return {
    confirmingActionId,
    runExplicitReportFlow,
    handleHarnessAction,
    handleStructuredSupplement,
    confirmPendingAction,
  }
}
