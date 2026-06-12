import { http, HttpResponse } from 'msw'
import {
  mockAssessmentVersion,
  mockComments,
  mockDeliverables,
  mockDslRules,
  mockEstimateResult,
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
