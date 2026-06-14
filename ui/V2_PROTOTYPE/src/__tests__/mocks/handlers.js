import { http, HttpResponse } from 'msw'
import {
  mockAssessmentVersion,
  mockAiSessions,
  mockComments,
  mockDeliverables,
  mockDslRules,
  mockEstimateResult,
  mockProjectEvaluations,
  mockRequirement,
  mockResourceCost,
  mockReview,
  mockRuleSet,
  mockSystemRules,
  mockTemplate,
  mockUsers,
  mockVersions,
} from './data.js'

const BASE = '/api/v1'

export const handlers = [
  http.get(`${BASE}/versions`, ({ request }) => {
    const url = new URL(request.url)
    const type = url.searchParams.get('type')
    const baseCode = url.searchParams.get('baseCode')
    let rows = mockVersions
    if (type) rows = rows.filter((record) => record.type === type)
    if (baseCode) rows = rows.filter((record) => record.baseCode === baseCode || record.id === baseCode)
    return HttpResponse.json({ success: true, data: rows })
  }),
  http.get(`${BASE}/auth/users`, () => HttpResponse.json({ success: true, data: { users: mockUsers } })),
  http.get(`${BASE}/auth/me`, () => HttpResponse.json({ success: true, data: { user: mockUsers[2] } })),
  http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: mockAiSessions } })),
  http.get(`${BASE}/project-evaluations`, () => HttpResponse.json({ success: true, data: { items: mockProjectEvaluations } })),
  http.post(`${BASE}/project-evaluations`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        project: {
          projectId: 'project-new',
          projectName: body.projectName || '新建项目评估',
          customerName: body.customerName || '',
          industry: body.industry || '',
          currentStage: body.currentStage || 'rough_estimate',
          status: body.projectStatus || 'draft',
          ownerUsername: 'arch',
          participantUserIds: ['u3'],
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
          totalDays: body.totalDays || 0,
        },
      },
    })
  }),
  http.post(`${BASE}/ai-sessions`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        session: {
          sessionId: 'session-new',
          title: body.title || 'AI 工作台会话',
          domain: body.domain || 'business_evaluation',
          workflowKey: body.workflowKey || 'free_chat',
          businessRole: 'pre_sales',
          status: body.status || 'temporary_chat',
          summary: '',
          messages: [],
          attachments: [],
          artifacts: [],
          pendingActions: [],
          linkedRecords: {},
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
        },
      },
    })
  }),
  http.post(`${BASE}/ai-sessions/:sessionId/standard-drafts`, async ({ params, request }) => {
    const body = await request.json()
    const fileName = body.fileName || '金蝶官方评估文件'
    return HttpResponse.json({
      success: true,
      data: {
        session: {
          sessionId: params.sessionId,
          title: fileName,
          domain: 'standard_governance',
          workflowKey: 'standard_governance',
          businessRole: 'admin',
          status: 'standard_review',
          summary: '',
          messages: [],
          attachments: [],
          artifacts: [{
            artifactId: 'std-art-1',
            type: 'standard_draft',
            title: '标准差异草稿',
            content: `已接收 ${fileName}，识别新增模块 2 个，人天基准变更 3 项。`,
            status: 'generated',
            createdAt: '2026-06-14T00:00:00.000Z',
          }],
          pendingActions: [{
            actionId: 'std-action-1',
            actionType: 'publish_standard_version',
            title: '发布标准版本',
            riskLevel: 'high',
            status: 'pending',
            payload: { fileName },
            createdAt: '2026-06-14T00:00:00.000Z',
          }],
          linkedRecords: {},
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
        },
        artifact: {
          artifactId: 'std-art-1',
          type: 'standard_draft',
          title: '标准差异草稿',
          content: `已接收 ${fileName}，识别新增模块 2 个，人天基准变更 3 项。`,
          status: 'generated',
        },
      },
    })
  }),
  http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        user: {
          id: params.userId,
          username: 'patched-user',
          role: 'user',
          businessRole: body.businessRole,
          status: 'active',
        },
      },
    })
  }),
  http.patch(`${BASE}/auth/users/:userId/password`, ({ params }) => HttpResponse.json({
    success: true,
    data: {
      user: {
        id: params.userId,
        username: 'patched-user',
        role: 'user',
        businessRole: 'pre_sales',
        status: 'active',
      },
    },
  })),
  http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
    const body = await request.json()
    const answer = `模型回复：${body.messages?.at?.(-1)?.content || '收到'}`
    const attachments = []
    const messages = (body.messages || []).map((message, index) => {
      const attachmentIds = (message.attachments || []).map((attachment, attachmentIndex) => {
        const attachmentId = `att-${index + 1}-${attachmentIndex + 1}`
        attachments.push({
          attachmentId,
          name: attachment.name,
          size: attachment.size,
          type: attachment.type,
          createdAt: '2026-06-14T00:00:00.000Z',
        })
        return attachmentId
      })
      return {
        messageId: `msg-${index + 1}`,
        role: message.role,
        content: message.content,
        attachmentIds,
        createdAt: '2026-06-14T00:00:00.000Z',
      }
    })
    return HttpResponse.json({
      success: true,
      data: {
        answer,
        businessRole: 'pre_sales',
        roleLabel: '售前顾问',
        model: 'kimi-k2.5',
        session: {
          sessionId: body.sessionId || 'session-new',
          title: 'AI 工作台会话',
          domain: 'business_evaluation',
          workflowKey: body.workflowKey || 'free_chat',
          businessRole: 'pre_sales',
          status: 'temporary_chat',
          summary: '',
          messages: [
            ...messages,
            {
              messageId: 'msg-assistant',
              role: 'assistant',
              content: answer,
              createdAt: '2026-06-14T00:00:01.000Z',
            },
          ],
          attachments,
          artifacts: [],
          pendingActions: [],
          linkedRecords: {},
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:01.000Z',
        },
      },
    })
  }),

  http.get(`${BASE}/versions/:id`, ({ params }) => {
    const data = String(params.id).startsWith('RC') ? mockResourceCost : mockAssessmentVersion
    return HttpResponse.json({ success: true, data })
  }),
  http.get(`${BASE}/templates/:id`, () => HttpResponse.json({ success: true, data: mockTemplate })),
  http.get(`${BASE}/rule-sets/active`, () => HttpResponse.json({ success: true, data: mockRuleSet })),
  http.get(`${BASE}/rule-sets/meta`, () => HttpResponse.json({ success: true, data: { pipeline: mockRuleSet.pipeline, baseRule: mockRuleSet.baseRule } })),
  http.post(`${BASE}/estimates/calculate`, () => HttpResponse.json({ success: true, data: mockEstimateResult })),

  http.get(`${BASE}/pm/reviews/:id`, () => HttpResponse.json({ success: true, data: mockReview })),
  http.get(`${BASE}/pm/versions/:versionId/deliverables`, () => HttpResponse.json({ success: true, data: mockDeliverables })),
  http.get(`${BASE}/pm/handoffs`, () => HttpResponse.json({ success: true, data: [{ fromRole: '售前架构师', fromName: '王丽', toRole: '项目经理', toName: '刘洋', deadline: '2026-04-26T18:00:00Z' }] })),
  http.get(`${BASE}/teams/:teamId/reviews/:reviewId/comments`, () => HttpResponse.json({ success: true, data: mockComments })),
  http.get(`${BASE}/pm/versions/:versionId/seal`, () => HttpResponse.json({ success: true, data: [{ id: 'S1', name: 'WES 公章 · 标准', scope: '通用' }] })),
  http.patch(`${BASE}/pm/reviews/:id`, async ({ request }) => HttpResponse.json({ success: true, data: await request.json() })),
  http.post(`${BASE}/pm/deliverables/generate`, () => HttpResponse.json({ success: true, data: mockDeliverables })),
  http.post(`${BASE}/teams/:teamId/reviews/:reviewId/comments`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ success: true, data: { commentId: 'C2', authorUserId: '当前用户', content: body.text || body.content, createdAt: '2026-04-18T11:00:00Z' } })
  }),

  http.get(`${BASE}/presales/requirement-packs/:id`, () => HttpResponse.json({ success: true, data: mockRequirement })),
  http.get(`${BASE}/reviews`, () => HttpResponse.json({ success: true, data: [] })),

  http.get(`${BASE}/system/version-code-rules`, () => HttpResponse.json({ success: true, data: mockSystemRules })),
  http.get(`${BASE}/system/requirement-settings`, () => HttpResponse.json({ success: true, data: { models: [{ name: 'KIMI 评估', status: 'online' }], apiKey: 'sk-test' } })),
  http.get(`${BASE}/system/implementation-dependency-rules`, () => HttpResponse.json({ success: true, data: mockDslRules })),
  http.get(`${BASE}/templates`, () => HttpResponse.json({ success: true, data: [{ templateId: 'T1', templateName: '实施评估标准版', description: '标准模板', tags: ['标准'] }] })),
  http.post(`${BASE}/system/version-code-rules/:id/activate`, () => HttpResponse.json({ success: true, data: {} })),

  http.post(`${BASE}/versions/:id/checkout`, () => HttpResponse.json({ success: true, data: { checkoutStatus: 'checked_out' } })),
  http.post(`${BASE}/versions/:id/checkin`, () => HttpResponse.json({ success: true, data: { checkoutStatus: 'checked_in' } })),
  http.post(`${BASE}/versions/:id/promote`, () => HttpResponse.json({ success: true, data: {} })),
]
