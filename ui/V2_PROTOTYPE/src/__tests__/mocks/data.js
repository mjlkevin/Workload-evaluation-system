export const mockUsers = [
  { id: 'u1', username: 'admin', role: 'admin', businessRole: 'admin', email: 'admin@wes.local' },
  { id: 'u2', username: 'pm', role: 'sub_admin', businessRole: 'pm', email: 'pm@wes.local' },
  { id: 'u3', username: 'arch', role: 'user', businessRole: 'pre_sales', email: 'arch@wes.local' },
]

export const mockAiSessions = []

export const mockProjectEvaluations = [
  {
    projectId: 'project-1',
    projectName: '利民集团数字化二期',
    customerName: '利民集团',
    industry: '制造业',
    currentStage: 'rough_estimate',
    status: 'draft',
    ownerUsername: 'arch',
    participantUserIds: ['u3'],
    createdAt: '2026-04-20T08:00:00Z',
    updatedAt: '2026-04-20T08:00:00Z',
    totalDays: 120,
  },
]

export const mockVersions = [
  {
    id: 'GV-1',
    type: 'global',
    versionCode: 'GL-04001',
    baseCode: 'GL-04001',
    status: 'published',
    checkoutStatus: 'checked_in',
    versionDocStatus: 'reviewed',
    updatedByUsername: 'admin',
    updatedAt: '2026-04-20T08:00:00Z',
    payload: { projectName: '利民集团数字化二期', totalDays: 120 },
  },
  {
    id: 'ASM-018',
    type: 'assessment',
    versionCode: 'IA-04003',
    baseCode: 'GL-04001',
    status: 'draft',
    checkoutStatus: 'checked_in',
    versionDocStatus: 'reviewed',
    updatedByUsername: 'pm',
    updatedAt: '2026-04-21T08:00:00Z',
    payload: { projectName: '利民集团数字化二期', totalDays: 31.6 },
  },
  {
    id: 'REQ-1',
    type: 'requirementImport',
    versionCode: 'RQ-04001',
    baseCode: 'GL-04001',
    status: 'draft',
    checkoutStatus: 'checked_in',
    versionDocStatus: 'drafting',
    updatedByUsername: 'arch',
    updatedAt: '2026-04-22T08:00:00Z',
    payload: { projectName: '利民集团数字化二期' },
  },
  {
    id: 'ASM-AI-001',
    type: 'assessment',
    versionCode: 'IA-AI-DRAFT-001',
    baseCode: 'GL-AI-001',
    status: 'draft',
    checkoutStatus: 'checked_in',
    versionDocStatus: 'drafting',
    updatedByUsername: 'ai',
    updatedAt: '2026-06-18T08:00:00Z',
    payload: {
      projectName: 'AI 生成项目评估草稿',
      productLine: '金蝶AI星空',
      totalDays: 0,
      draftStatus: 'draft_from_ai',
      draftSource: 'harness',
      harnessRunId: 'run-ai-001',
      harnessActionId: 'enter_formal_estimation',
    },
  },
]

export const mockTemplate = {
  templateId: 'tmpl-1',
  templateName: '实施评估标准版',
  templateVersion: '2026.04',
  groups: [
    { groupId: 'g1', groupName: '财务云' },
    { groupId: 'g2', groupName: '供应链云' },
  ],
  items: [
    { templateItemId: 'i1', groupId: 'g1', itemName: '总账初始化', standardDays: 5, defaultIncluded: true, deliveryModule: '总账', deliveryDesc: '科目体系', evalDesc: '标准实施' },
    { templateItemId: 'i2', groupId: 'g1', itemName: '应收应付', standardDays: 4, defaultIncluded: true, deliveryModule: '往来', deliveryDesc: '往来管理', evalDesc: '需确认账期' },
    { templateItemId: 'i3', groupId: 'g2', itemName: '库存管理', standardDays: 6, defaultIncluded: false, deliveryModule: '库存', deliveryDesc: '库存核算', evalDesc: '二期范围' },
  ],
}

export const mockRuleSet = {
  ruleSetId: 'DSL-2026-Q2',
  ruleVersion: '2026.04',
  pipelineVersion: 'p-1.8',
  pipeline: ['base', 'user', 'difficulty', 'org'],
  baseRule: { userCountTiers: [{ min: 0, max: 500, factor: 0.04 }], difficultyFactorList: [0.2] },
  orgIncrementRule: { enabled: true, factor: 0.1 },
  rules: [],
}

export const mockEstimateResult = {
  templateId: 'tmpl-1',
  ruleSetId: 'DSL-2026-Q2',
  templateVersion: '2026.04',
  ruleVersion: '2026.04',
  pipelineVersion: 'p-1.8',
  baseDays: 9,
  userIncrementDays: 4,
  difficultyIncrementDays: 2,
  orgIncrementDays: 1,
  totalDays: 16,
  calculationBreakdown: {},
  groupSubtotals: [
    { groupId: 'g1', groupName: '财务云', subtotalDays: 9 },
    { groupId: 'g2', groupName: '供应链云', subtotalDays: 0 },
  ],
  itemResults: [
    { templateItemId: 'i1', included: true, standardDays: 5, effectiveStandardDays: 5, itemSubtotalDays: 5 },
    { templateItemId: 'i2', included: true, standardDays: 4, effectiveStandardDays: 4, itemSubtotalDays: 4 },
    { templateItemId: 'i3', included: false, standardDays: 6, effectiveStandardDays: 6, itemSubtotalDays: 0 },
  ],
}

export const mockAssessmentVersion = {
  ...mockVersions[1],
  templateId: 'tmpl-1',
  ruleSetId: 'DSL-2026-Q2',
  payload: {
    projectName: '利民集团 · 财务供应链一期',
    templateId: 'tmpl-1',
    ruleSetId: 'DSL-2026-Q2',
    productLines: ['金蝶AI星空'],
    requirementSource: { code: 'RR-LM-2026-04', version: 'v3', title: 'SRM 供应商协同门户' },
    params: { userCount: 100, difficultyFactor: 0.2, orgCount: 1, orgSimilarity: 0.8 },
    quoteMode: '模块报价',
    preset: '标准财务供应链',
    cloudProducts: ['财务云'],
    dsl: { passed: false, issues: [{ ruleId: 'R-1', type: 'requires_all', message: '缺少依赖', blocking: true }] },
  },
}

export const mockRequirement = {
  id: 'REQ-1',
  versionCode: 'RQ-04001',
  baseCode: 'GL-04001',
  checkoutStatus: 'checked_in',
  versionDocStatus: 'drafting',
  createdByUsername: '陈晨',
  createdAt: '2026-04-18T08:00:00Z',
  payload: {
    code: 'RQ-04001',
    project: '利民集团数字化二期',
    customer: '利民集团',
    location: '上海',
    industry: '制造',
    scopeRows: [
      { category: '财务', item: '总账', status: '已确认' },
      { category: '供应链', item: '库存', status: '待结构化', error: true },
      { type: 'group', label: '补充信息' },
    ],
  },
}

export const mockResourceCost = {
  id: 'RC-1',
  versionCode: 'RS-04001',
  baseCode: 'GL-04001',
  checkoutStatus: 'checked_in',
  versionDocStatus: 'reviewed',
  checkedOutByUsername: 'pm',
  payload: {
    months: ['2026-04', '2026-05'],
    groups: [
      {
        group: 'impl',
        role: '实施顾问',
        rows: [
          { name: '顾问 A', unitPrice: 3200, plannedDays: 5, travelCost: 1000, months: [2, 3] },
          { name: '顾问 B', unitPrice: 3200, plannedDays: 3, travelCost: 500, months: [1, 2] },
        ],
      },
      {
        group: 'pm',
        role: '项目经理',
        rows: [{ name: 'PM', unitPrice: 4000, plannedDays: 2, travelCost: 0, months: [1, 1] }],
      },
    ],
  },
}

export const mockReview = {
  reviewId: 'REV-1',
  assessmentVersionId: 'ASM-018',
  teamId: 'TEAM-1',
  title: 'AE-2026-0418 · 付款/库存/报表',
  reviewer: { name: '王丽', role: '后端架构师' },
  deadline: '2026-04-20',
  checklist: {
    deliverablesComplete: true,
    methodologySevenPhases: true,
    rateCardCorrect: true,
    narrativeComplete: false,
    assumptionsDocumented: false,
  },
  verdict: null,
}

export const mockDeliverables = [
  { deliverableId: 'D1', content: { title: '实施 SOW' }, deliverableType: 'sow', status: 'pending', createdAt: '2026-04-18T09:00:00Z' },
  { deliverableId: 'D2', content: { title: '实施计划' }, deliverableType: 'wbs', status: 'pending', createdAt: '2026-04-18T09:00:00Z' },
]

export const mockComments = [
  { commentId: 'C1', authorUserId: '王丽', content: '方案覆盖度较好。', createdAt: '2026-04-18T09:20:00Z' },
]

export const mockSystemRules = [
  { id: 'GL', module: '总方案', code: 'GL', prefix: 'GL-', status: 'draft' },
  { id: 'RQ', module: '需求', code: 'RQ', prefix: 'RQ-', status: 'active' },
]

export const mockDslRules = [
  { id: 'R1', type: 'blocking', message: '需求条目必须关联至少一个业务模块', enabled: true },
  { id: 'R2', type: 'warning', message: '多组织推广估算应提供相似度依据', enabled: false },
  { id: 'R3', type: 'blocking', message: '评审通过前必须完成全部 checklist', enabled: true },
]

export const mockAdminAiSessions = [
  {
    sessionId: 'sess-audit-0001',
    title: '金蝶云星空评估会话',
    ownerUserId: 'u1',
    ownerUsername: 'admin',
    businessRole: 'admin',
    domain: 'business_evaluation',
    workflowKey: 'free_chat',
    status: 'rough_estimate',
    createdAt: '2026-08-01T02:00:00.000Z',
    updatedAt: '2026-08-05T08:30:00.000Z',
    messageCount: 4,
    turnCount: 2,
    attachmentCount: 0,
    artifactCount: 0,
    firstUserMessage: '帮我评估这个项目的实施工作量',
    lastAssistantMessage: '初步评估人天为 120 人天',
  },
  {
    sessionId: 'sess-audit-0002',
    title: '标准治理评审会话',
    ownerUserId: 'u3',
    ownerUsername: 'arch',
    businessRole: 'pre_sales',
    domain: 'standard_governance',
    workflowKey: 'standard_review',
    status: 'standard_review',
    createdAt: '2026-08-02T03:00:00.000Z',
    updatedAt: '2026-08-06T09:00:00.000Z',
    messageCount: 2,
    turnCount: 1,
    attachmentCount: 1,
    artifactCount: 0,
    firstUserMessage: '请评审新增标准条目',
    lastAssistantMessage: '标准评审意见已生成',
  },
]
