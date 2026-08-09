import { http, HttpResponse } from 'msw'
import {
  mockAdminAiSessions,
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
  // RP-047 Batch D：默认无活跃异步任务；场景测试用 server.use 覆盖。
  // 消除 Shell 层 BackgroundRunProvider 在既有测试中的 unhandled-request 噪音。
  http.get(`${BASE}/ai-runs`, () => HttpResponse.json({ success: true, data: { items: [] } })),
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
  http.delete(`${BASE}/ai-sessions/:sessionId`, ({ params }) => HttpResponse.json({
    success: true,
    data: { deletedSessionId: params.sessionId },
  })),
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
  http.patch(`${BASE}/auth/users/:userId/role`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        user: {
          id: params.userId,
          role: body.role,
        },
      },
    })
  }),
  http.patch(`${BASE}/auth/users/:userId/status`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        user: {
          id: params.userId,
          status: body.status,
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
  http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
    code: 0,
    message: 'ok',
    data: {
      code: {
        code: 'WES-TEST',
        status: 'active',
        createdAt: '2026-07-26T01:00:00.000Z',
      },
    },
  })),
  http.post(`${BASE}/ai/parse-basic-info`, () => HttpResponse.json({
    success: true,
    data: {
      basicInfo: {
        projectName: '测试项目',
        customerName: '测试客户',
        customerIndustry: '制造业',
        productLines: ['金蝶云星空'],
      },
      requirementImportData: {
        businessItems: [
          { topic: '测试需求', description: '测试附件解析结果' },
        ],
        productModuleRows: [
          {
            productLine: '金蝶云星空',
            moduleName: '供应链云',
            requirementDescription: '测试模块线索',
          },
        ],
      },
      sourceSheets: ['Sheet1'],
      model: 'rule-fallback',
    },
  })),
  http.post(`${BASE}/harness/runs`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        run: {
          harnessRunId: 'harness-run-1',
          title: body.title || 'Harness Run',
          mode: body.mode || 'interactive',
          stage: 'uploaded',
          status: 'waiting',
          aiSessionId: body.aiSessionId || null,
        },
      },
    })
  }),
  http.post(`${BASE}/harness/runs/:runId/files`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        run: {
          harnessRunId: params.runId,
          title: body.fileName,
          stage: 'parsing',
          status: 'running',
        },
        file: {
          harnessFileId: 'harness-file-1',
          harnessRunId: params.runId,
          attachmentId: body.attachmentId,
          fileName: body.fileName,
          fileSize: body.fileSize,
          mimeType: body.mimeType,
          role: body.role,
          createdAt: '2026-06-14T00:00:00.000Z',
        },
      },
    })
  }),
  http.post(`${BASE}/harness/runs/:runId/parse-result`, async ({ params, request }) => {
    const body = await request.json()
    return HttpResponse.json({
      success: true,
      data: {
        run: {
          harnessRunId: params.runId,
          title: body.sourceFile,
          stage: 'evidence_ready',
          status: 'waiting',
        },
        files: [],
        evidences: [
          { harnessEvidenceId: 'ev-1', sourceId: body.sourceFile, evidenceType: 'block' },
          { harnessEvidenceId: 'ev-2', sourceId: 'Sheet1', evidenceType: 'item' },
        ],
        artifacts: [{
          harnessArtifactId: 'artifact-file-understanding',
          artifactType: 'file_understanding',
          title: '文件理解结果 v1',
          version: 'v1',
          status: 'ready',
          content: {
            version: 'v1',
            sourceFile: body.sourceFile,
            sourceSheets: body.sheets || ['Sheet1'],
            project: body.summary || { projectName: '测试项目', customerName: '测试客户', industry: '制造业' },
            extractedItemCount: body.items?.length || 1,
          },
        }],
        modelRuns: [],
        toolEvents: [],
      },
    })
  }),
  http.post(`${BASE}/harness/runs/:runId/answers`, ({ params }) => HttpResponse.json({
    success: true,
    data: {
      run: {
        harnessRunId: params.runId,
        title: '测试项目',
        stage: 'clarifying',
        status: 'waiting',
      },
    },
  })),
  http.post(`${BASE}/harness/runs/:runId/report-v2`, ({ params }) => HttpResponse.json({
    success: true,
    data: {
      run: {
        harnessRunId: params.runId,
        title: '测试项目',
        stage: 'report_v2_ready',
        status: 'waiting',
      },
      files: [],
      evidences: [],
      artifacts: [{
        harnessArtifactId: 'artifact-report-v2',
        artifactType: 'requirement_report_v2',
        title: '需求解析报告 v2',
        version: 'v2',
        status: 'ready',
        content: {
          version: 'v2',
          sourceFile: '测试需求.xlsx',
          project: { projectName: '测试项目', customerName: '测试客户', industry: '制造业' },
          sourceSheets: ['Sheet1'],
          requirementFindings: [
            { domain: '财务核算', scenario: '测试需求', moduleHint: '总账', confidence: 0.92, evidenceRefs: ['Sheet1'] },
          ],
          missingFields: [],
          clarificationQuestions: [],
          answeredQuestions: [
            { question: '实施组织范围包含几个法人？', answer: '3 个法人', source: 'user_chat' },
          ],
          risks: [
            { title: '范围风险', assumption: '已通过补充信息锁定', impact: '可控' },
          ],
          nextActions: [
            { label: '进入正式评估', actionType: 'enter_formal_estimation' },
          ],
          clarificationSummary: '已补充实施组织范围。',
        },
      }],
      modelRuns: [{ harnessModelRunId: 'model-run-2', provider: 'kimi', model: 'moonshot-v1-128k' }],
      toolEvents: [],
    },
  })),
  http.post(`${BASE}/harness/runs/:runId/actions/:actionId/confirm`, ({ params }) => HttpResponse.json({
    code: 0,
    message: 'ok',
    data: {
      run: {
        harnessRunId: params.runId,
        stage: 'ready_for_estimation',
        status: 'waiting',
        projectEvaluationId: 'project-new',
        metadata: { links: { assessmentVersionId: 'assessment-new', assessmentVersionCode: 'IA-AI-DRAFT-001' } },
      },
      event: {
        harnessToolEventId: 'event-1',
        actionId: params.actionId,
        toolName: params.actionId,
        eventType: 'confirmation',
        status: 'confirmed',
        output: {
          project: { projectId: 'project-new', projectName: '测试项目', status: 'draft' },
          assessmentDraft: { recordId: 'assessment-new', versionCode: 'IA-AI-DRAFT-001', status: 'draft_from_ai' },
        },
      },
    },
    requestId: 'mock-harness-confirm',
  })),
  http.post(`${BASE}/harness/runs/:runId/report-v1`, ({ params }) => HttpResponse.json({
    success: true,
    data: {
      run: {
        harnessRunId: params.runId,
        title: '测试项目',
        stage: 'report_v1_ready',
        status: 'waiting',
      },
      files: [],
      evidences: [],
      artifacts: [{
        harnessArtifactId: 'artifact-file-understanding',
        artifactType: 'file_understanding',
        title: '文件理解结果 v1',
        version: 'v1',
        status: 'ready',
        content: {},
      }, {
        harnessArtifactId: 'artifact-report-v1',
        artifactType: 'requirement_report_v1',
        title: '需求解析报告 v1',
        version: 'v1',
        status: 'ready',
        content: {
          version: 'v1',
          sourceFile: '测试需求.xlsx',
          project: { projectName: '测试项目', customerName: '测试客户', industry: '制造业' },
          sourceSheets: ['Sheet1'],
          requirementFindings: [
            { domain: '财务核算', scenario: '测试需求', moduleHint: '总账', confidence: 0.82, evidenceRefs: ['Sheet1'] },
          ],
          missingFields: [
            { field: '实施组织范围', reason: '文件未明确', priority: 'must' },
          ],
          clarificationQuestions: [
            { question: '实施组织范围包含几个法人？', targetRole: '客户项目负责人', reason: '影响工作量边界' },
          ],
          risks: [
            { title: '范围风险', assumption: '组织范围未锁定', impact: '可能增加实施人天' },
          ],
          nextActions: [
            { label: '补充项目信息', actionType: 'supplement_project_info' },
            { label: '进入正式评估', actionType: 'enter_formal_estimation' },
          ],
        },
      }],
      modelRuns: [{ harnessModelRunId: 'model-run-1', provider: 'kimi', model: 'moonshot-v1-128k' }],
      toolEvents: [],
    },
  })),
  http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
    const body = await request.json()
    const lastMessage = body.messages?.at?.(-1)
    const userText = lastMessage?.content || ''
    const hasAttachment = (lastMessage?.attachments || []).some((a) => a.parsedSummary)
    // Phase 1G: 模拟意图路由返回
    let intent = 'domain_qa'
    let suggestedActions = []
    if (/你能做什么|能做什么|帮助/.test(userText)) {
      intent = 'capability_discovery'
      suggestedActions = [
        { id: 'upload_file', label: '上传需求文件', actionType: 'send_message', requiresConfirm: false },
        { id: 'query_projects', label: '查看我的项目', actionType: 'open_project_list', requiresConfirm: false },
        { id: 'lookup_customer', label: '检索客户主体', actionType: 'company_lookup', requiresConfirm: false },
      ]
    } else if (/我之前.*项目|创建过哪些项目|我的项目/.test(userText)) {
      intent = 'wes_data_query'
    } else if (hasAttachment) {
      intent = 'attachment_qa'
      suggestedActions = [{ id: 'generate_requirement_report', label: '生成需求解析报告', actionType: 'generate_requirement_report', requiresConfirm: false }]
    }
    const answer = `模型回复：${userText || '收到'}`
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
        intent,
        answer,
        businessRole: 'pre_sales',
        roleLabel: '售前顾问',
        model: 'kimi-k2.5',
        suggestedActions,
        trace: { intentConfidence: 0.8, routingRule: 'mock', contextRefs: [] },
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
              // 与真实后端 workbench-chat.handler.ts 对齐：suggestedActions 持久化进消息 metadata，
              // 否则前端会话同步重映射（mapSessionMessages）会丢弃建议动作按钮。
              ...(suggestedActions.length ? { metadata: { suggestedActions, intent } } : {}),
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

  // O5 Sprint 3A：统一视图接口 mock——默认返回空视图
  http.get(`${BASE}/ai/home-workbench/view`, () => HttpResponse.json({
    code: 0,
    message: 'ok',
    data: {
      sessions: [],
      runs: [],
      tasks: [],
      artifacts: [],
      failedRuns: [],
    },
  })),

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
  http.get(`${BASE}/system/role-capabilities`, () => HttpResponse.json({
    success: true,
    data: {
      roles: [
        { role: 'admin', capabilities: ['estimates:create', 'estimates:read', 'estimates:write', 'system:manage', 'user:manage'] },
        { role: 'presales', capabilities: ['estimates:create', 'estimates:read', 'contract:initiate'] },
        { role: 'pm', capabilities: ['estimates:read', 'assessment:handoff', 'deliverable:generate'] },
      ],
      legacyMapping: [
        { legacyRole: 'admin', label: '超级管理员', v2Roles: ['admin'] },
        { legacyRole: 'sub_admin', label: '管理员', v2Roles: ['admin', 'presales'] },
        { legacyRole: 'user', label: '普通用户', v2Roles: ['presales', 'pm'] },
      ],
      capabilityLabels: {
        'estimates:create': '创建评估包',
        'estimates:read': '查看评估包',
        'estimates:write': '编辑评估包',
        'contract:initiate': '发起合同',
        'assessment:handoff': '交接评估包',
        'deliverable:generate': '生成交付物',
        'system:manage': '系统管理',
        'user:manage': '管理用户',
      },
    },
  })),
  http.get(`${BASE}/system/requirement-settings`, () => HttpResponse.json({ success: true, data: {
    version: 1,
    draft: {
      kimiEvaluation: { enabled: true, model: 'kimi-k2.5', temperature: 0.3, maxTokens: 4000, timeoutMs: 120000, fallbackToRule: true, promptProfile: 'default', promptTemplate: '' },
      fileParsing: { enabled: true, model: 'kimi-k2.6', allowedExtensions: ['.xlsx', '.xls', '.csv'], maxFileSizeMb: 20, maxSheetCount: 20, strictMode: false, ocrEnabled: false },
      kimiGeneration: { enabled: true, model: 'kimi-k2.5', temperature: 0.5, maxTokens: 6000, outputStyle: 'balanced', includeRiskHints: true, includeAssumptions: true },
      kimiCredentials: { apiKey: '', hint: null, envFallbackAvailable: false, resolvedFrom: 'none' },
    },
    active: {
      kimiEvaluation: { enabled: true, model: 'kimi-k2.5', temperature: 0.3, maxTokens: 4000, timeoutMs: 120000, fallbackToRule: true, promptProfile: 'default', promptTemplate: '' },
      fileParsing: { enabled: true, model: 'kimi-k2.6', allowedExtensions: ['.xlsx', '.xls', '.csv'], maxFileSizeMb: 20, maxSheetCount: 20, strictMode: false, ocrEnabled: false },
      kimiGeneration: { enabled: true, model: 'kimi-k2.5', temperature: 0.5, maxTokens: 6000, outputStyle: 'balanced', includeRiskHints: true, includeAssumptions: true },
      kimiCredentials: { apiKey: '', hint: null, envFallbackAvailable: false, resolvedFrom: 'none' },
    },
    updatedAt: '2026-01-15T08:00:00Z',
    effectiveAt: '2026-01-15T08:00:00Z',
  } })),
  http.patch(`${BASE}/system/requirement-settings/draft`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ success: true, data: { version: 2, draft: body, updatedAt: new Date().toISOString() } })
  }),
  http.get(`${BASE}/system/knowledge-base-config`, () => HttpResponse.json({ success: true, data: {
    version: 1,
    draft: {
      model: 'glm-4.6',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      credentials: { apiKey: '', apiHint: null, knowledgeId: '' },
      knowledgeBases: [{
        id: 'solutions', name: '金蝶解决方案知识库', description: '产品方案与实施边界',
        knowledgeId: 'kb-solutions', routingKeywords: ['产品方案'], allowedBusinessRoles: [],
        enabled: true, isDefault: true, priority: 100,
      }],
    },
    active: {
      model: 'glm-4.6',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      credentials: { apiKey: '', apiHint: null, knowledgeId: '', resolvedFrom: 'none' },
      knowledgeBases: [{
        id: 'solutions', name: '金蝶解决方案知识库', description: '产品方案与实施边界',
        knowledgeId: 'kb-solutions', routingKeywords: ['产品方案'], allowedBusinessRoles: [],
        enabled: true, isDefault: true, priority: 100,
      }],
    },
    probes: {},
    updatedAt: '2026-01-15T08:00:00Z',
    effectiveAt: '2026-01-15T08:00:00Z',
  } })),
  http.patch(`${BASE}/system/knowledge-base-config/draft`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ success: true, data: { version: 2, draft: body, updatedAt: new Date().toISOString() } })
  }),
  http.post(`${BASE}/system/knowledge-base-config/activate`, () => HttpResponse.json({ success: true, data: { version: 2 } })),
  http.post(`${BASE}/system/knowledge-base-config/test`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ success: true, data: { ok: true, profileId: body.profileId, testedSource: 'mock', retrievalTriggered: true } })
  }),
  http.get(`${BASE}/system/implementation-dependency-rules`, () => HttpResponse.json({ success: true, data: mockDslRules })),
  http.get(`${BASE}/system/ai-sessions`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const domain = url.searchParams.get('domain')
    const q = (url.searchParams.get('q') || '').toLowerCase()
    const items = mockAdminAiSessions
      .filter((session) => !status || session.status === status)
      .filter((session) => !domain || session.domain === domain)
      .filter((session) => !q
        || [session.sessionId, session.title, session.ownerUsername, session.workflowKey]
          .some((value) => String(value || '').toLowerCase().includes(q)))
      .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
    return HttpResponse.json({ success: true, data: { items } })
  }),
  http.get(`${BASE}/harness/test-results`, () => HttpResponse.json({ success: true, data: { items: [] } })),
  http.get(`${BASE}/templates`, () => HttpResponse.json({ success: true, data: [{ templateId: 'T1', templateName: '实施评估标准版', description: '标准模板', tags: ['标准'] }] })),
  http.post(`${BASE}/system/version-code-rules/:id/activate`, () => HttpResponse.json({ success: true, data: {} })),

  http.post(`${BASE}/versions/:id/checkout`, () => HttpResponse.json({ success: true, data: { checkoutStatus: 'checked_out' } })),
  http.post(`${BASE}/versions/:id/checkin`, () => HttpResponse.json({ success: true, data: { checkoutStatus: 'checked_in' } })),
  http.post(`${BASE}/versions/:id/promote`, () => HttpResponse.json({ success: true, data: {} })),
]
