// assessment-detail mock data — 对齐 v3 设计稿 §2–§5
export const assessment = {
  id: 'ASM-018',
  projectName: '利民集团 · 财务供应链一期',
  status: 'checked-out',
  statusLabel: '已检出',
  versionCode: 'IA-GL000-02',
  versionLabel: 'v07',
  model: 'kimi-k2.5',
  productLines: ['金蝶AI星空'],
  requirementSource: {
    code: 'RR-LM-2026-04',
    version: 'v3',
    title: 'SRM 供应商协同门户',
  },
  vcs: {
    checkedOutBy: 'mjlkevin',
    checkedOutAt: '2026-04-18T14:33:00Z',
    isReadonly: false,
    hasLocalChanges: 1,
  },
  params: {
    userCount: 100,
    userCountMax: 500,
    difficultyFactor: 0.2,
    orgCount: 1,
    orgSimilarity: 0.8,
  },
  context: {
    template: '实施评估标准版',
    ruleSet: 'DSL-2026-Q2',
    globalVersion: 'GL-04001',
  },
  dsl: {
    passed: false,
    issues: [
      { ruleId: 'R-001', type: 'requires_all', message: '流程编排缺少全部依赖项。', blocking: true },
      { ruleId: 'R-003', type: 'combo', message: '组合包与专项包存在互斥折扣。', blocking: false },
    ],
  },
  kpi: {
    totalDays: 31.6,
    baseDays: 23,
    userIncrementDays: 4,
    difficultyIncrementDays: 4.6,
    orgIncrementDays: 0,
    selectedCount: 7,
    totalItemCount: 23,
    cloudDistribution: [
      { name: '财务云', percentage: 65.2 },
      { name: '差旅与费用', percentage: 34.8 },
    ],
  },
  path: {
    quoteMode: '模块报价',
    preset: '标准财务供应链',
    cloudProducts: ['财务云', '差旅与费用'],
    allCloudProducts: [
      '差旅与费用管理', '人人业务云', '财务云', '供应链云', '制造云',
      '质量云', '条码云', '渠道云', '项目云', 'PLM 云', '银企云',
      '税务云', 'SRM 云', 'IPO 中心', '合同中心 (CM)', '电子档案',
      '系统服务云', '移动应用', '多组织协同云', '数据中台', 'AI 智能助手',
    ],
  },
  skuGroups: [
    {
      name: '差旅与费用管理',
      module: '模块 1',
      selected: 1,
      total: 7,
      days: 8,
      children: [
        { name: '人人差旅基本业务处理', module: '差旅模块', description: '出差申请、出差申请单（借）、差旅报销 / 流程 / 标准 / 路线 / 城市 / 班次', baseDays: 3, customDays: 4, delta: 1, reasonStatus: 'saved', assessmentNote: '需结合差旅标准策略，每个组织的流程不一致，致时…根据项目实际情况评估。' },
        { name: '人人差旅基础数据', module: '基础数据', description: '差旅标准、出差申请单类型、差旅城市、差旅路线…', baseDays: 2, customDays: 0, delta: 0, reasonStatus: 'none', assessmentNote: '组织流程统一时随财务一起推广。' },
        { name: '非差旅费用报销', module: '报销模块', description: '日常报销、专项报销、对公付款单据…', baseDays: 6, customDays: 0, delta: 0, reasonStatus: 'none', assessmentNote: '需评估专项报销使用场景与额度控制。' },
        { name: '第三方差旅平台对接', module: '集成模块', description: '携程 / 滴滴 / 出行平台 API 对接 + 单据回写', baseDays: 15, customDays: 0, delta: 0, reasonStatus: 'pending', assessmentNote: '对接深度与回写策略需现场确认。' },
      ],
    },
    {
      name: '财务云',
      module: '模块 2',
      selected: 2,
      total: 5,
      days: 12,
      children: [
        { name: '总账初始化', module: '总账', description: '科目体系、期初余额、凭证模板', baseDays: 5, customDays: 5, delta: 0, reasonStatus: 'none', assessmentNote: '标准实施，按组织规模调整。' },
        { name: '应收应付管理', module: '往来', description: '客户/供应商档案、账期策略、对账流程', baseDays: 4, customDays: 0, delta: 0, reasonStatus: 'none', assessmentNote: '需确认对账频率与预警规则。' },
      ],
    },
  ],
  multiOrg: {
    incompleteCount: 2,
    rows: [
      { org: '总部', strategy: '标准', increment: 0 },
      { org: '华东工厂', strategy: '差异化', increment: 8 },
      { org: '华南工厂', strategy: '差异化', increment: 6 },
    ],
  },
  exportHistory: [
    { id: 'EXP-1', type: 'pdf', fileName: 'ASM-018-v07.pdf', createdAt: '2026-04-18T10:00:00Z' },
    { id: 'EXP-2', type: 'xlsx', fileName: 'ASM-018-v07.xlsx', createdAt: '2026-04-18T10:10:00Z' },
    { id: 'EXP-3', type: 'md', fileName: 'ASM-018-v07.md', createdAt: '2026-04-18T10:20:00Z' },
  ],
  aiCopilot: {
    suggestion: '检测到 2 条 DSL 违反，建议优先修复「流程编排缺少全部依赖项」后再签入。可多组织推广中补充华东工厂差异项。',
    actions: ['应用建议', '查看依据'],
  },
  summary: {
    ruleVersion: '2026.04',
    pipelineVersion: 'p-1.8',
    lastRun: '2026-04-18 14:33',
  },
}
