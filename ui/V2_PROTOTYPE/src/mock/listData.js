export const assessments = [
  { id: 1, projectName: '利民集团数字化二期', productLine: '金蝶AI星空', globalVersion: 'GL-04001', assessmentVersion: 'IA-04003', quoteMode: '标准实施', totalDays: 232.8, orgCount: 3, difficultyFactor: 1.1, status: '已检出', owner: '张鹏', updatedAt: '2026-04-18' },
  { id: 2, projectName: '巨三集团星空套件', productLine: '金蝶AI星空', globalVersion: 'GL-04002', assessmentVersion: 'IA-04004', quoteMode: '快速交付', totalDays: 186.5, orgCount: 2, difficultyFactor: 0.9, status: '已检入', owner: '李雷', updatedAt: '2026-04-20' },
  { id: 3, projectName: '华鑫制造 MES 升级', productLine: '金蝶云·星瀚', globalVersion: 'GL-04003', assessmentVersion: 'IA-04005', quoteMode: '标准实施', totalDays: 312.0, orgCount: 5, difficultyFactor: 1.3, status: '进行中', owner: '王芳', updatedAt: '2026-04-21' },
  { id: 4, projectName: '蓝海物流 TMS 集成', productLine: '金蝶云·苍穹', globalVersion: 'GL-04004', assessmentVersion: 'IA-04006', quoteMode: '定制开发', totalDays: 156.4, orgCount: 1, difficultyFactor: 1.0, status: '待评审', owner: '赵强', updatedAt: '2026-04-22' },
  { id: 5, projectName: '金桥电子 PLM 实施', productLine: '金蝶AI星空', globalVersion: 'GL-04005', assessmentVersion: 'IA-04007', quoteMode: '标准实施', totalDays: 278.6, orgCount: 4, difficultyFactor: 1.2, status: '已归档', owner: '刘洋', updatedAt: '2026-04-23' },
  { id: 6, projectName: '银海财务共享中心', productLine: '金蝶云·星瀚', globalVersion: 'GL-04006', assessmentVersion: 'IA-04008', quoteMode: '快速交付', totalDays: 198.3, orgCount: 2, difficultyFactor: 0.8, status: '进行中', owner: '陈静', updatedAt: '2026-04-24' },
]

export const requirements = [
  { id: 'RQ-GLOBAL-20260404-0053', globalVersion: 'GL-04002', versionCode: 'RQ-GLOBAL-20260404-0053-V01', projectName: '巨三集团星空套件', productLine: '金蝶AI星空', customer: '巨三集团', status: '进行中', creator: '张鹏', updater: '张鹏', updatedAt: '2026-04-18' },
  { id: 'RQ-GLOBAL-20260404-0054', globalVersion: 'GL-04001', versionCode: 'RQ-GLOBAL-20260404-0054-V02', projectName: '利民集团数字化二期', productLine: '金蝶AI星空', customer: '利民集团', status: '已发布', creator: '李雷', updater: '李雷', updatedAt: '2026-04-19' },
  { id: 'RQ-GLOBAL-20260404-0055', globalVersion: 'GL-04003', versionCode: 'RQ-GLOBAL-20260404-0055-V03', projectName: '华鑫制造 MES 升级', productLine: '金蝶云·星瀚', customer: '华鑫制造', status: '评审中', creator: '王芳', updater: '王芳', updatedAt: '2026-04-20' },
]

export const devAssessments = [
  { id: 1, projectName: '利民集团数字化二期', globalVersion: 'GL-04001', devVersion: 'DV-04001', assessor: '张伟', totalDays: 128.5, status: '已检入', owner: '张伟', updatedAt: '2026-04-18' },
  { id: 2, projectName: '巨三集团星空套件', globalVersion: 'GL-04002', devVersion: 'DV-04002', assessor: '李娜', totalDays: 96.3, status: '进行中', owner: '李娜', updatedAt: '2026-04-20' },
]

export const resourceCosts = [
  { id: 1, projectName: '利民集团数字化二期', globalVersion: 'GL-04001', resourceVersion: 'RS-04001', quoteMode: '标准实施', totalDays: 232.8, orgCount: 3, status: '已检入', owner: '张鹏', updatedAt: '2026-04-18' },
  { id: 2, projectName: '巨三集团星空套件', globalVersion: 'GL-04002', resourceVersion: 'RS-04002', quoteMode: '快速交付', totalDays: 186.5, orgCount: 2, status: '已检出', owner: '李雷', updatedAt: '2026-04-20' },
]

export const reviews = [
  { id: 'REV-001', projectName: '利民集团数字化二期', version: 'v07', reviewers: '张鹏,李雷', deadline: '2026-04-25', status: '待评审', updatedAt: '2026-04-18' },
  { id: 'REV-002', projectName: '巨三集团星空套件', version: 'v04', reviewers: '王芳', deadline: '2026-04-20', status: '已通过', updatedAt: '2026-04-15' },
  { id: 'REV-003', projectName: '华鑫制造 MES 升级', version: 'v02', reviewers: '赵强,刘洋', deadline: '2026-04-30', status: '驳回', updatedAt: '2026-04-16' },
]

export const wbsItems = [
  { id: 1, name: '项目启动', assignee: '张鹏', start: '2026-04-01', end: '2026-04-07', progress: 100, status: '已完成' },
  { id: 2, name: '需求分析', assignee: '李雷', start: '2026-04-08', end: '2026-04-14', progress: 80, status: '进行中' },
  { id: 3, name: '系统设计', assignee: '王芳', start: '2026-04-15', end: '2026-04-21', progress: 30, status: '进行中' },
]

export const historyItems = [
  { id: 1, projectName: '利民集团一期',         customer: '利民集团',     industry: '制造-离散', scale: '2400 人', version: 'v01', similarity: 92, totalDays: 198.5, totalAmount: 79.4,  year: 2025, status: '已归档', updatedAt: '2025-12-15' },
  { id: 2, projectName: '利民集团二期',         customer: '利民集团',     industry: '制造-离散', scale: '2800 人', version: 'v02', similarity: 88, totalDays: 210.3, totalAmount: 84.1,  year: 2026, status: '已归档', updatedAt: '2026-02-20' },
  { id: 3, projectName: '金石科技 ERP 升级',    customer: '金石科技',     industry: '制造-离散', scale: '1200 人', version: 'v03', similarity: 76, totalDays: 156.0, totalAmount: 62.4,  year: 2025, status: '已归档', updatedAt: '2025-09-08' },
  { id: 4, projectName: '华东智造供应链改造',   customer: '华东智造集团', industry: '制造-流程', scale: '3500 人', version: 'v05', similarity: 71, totalDays: 245.8, totalAmount: 98.3,  year: 2025, status: '已归档', updatedAt: '2025-11-12' },
  { id: 5, projectName: '蓝海物流 TMS 集成',    customer: '蓝海物流',     industry: '交通-物流', scale: '900 人',  version: 'v04', similarity: 68, totalDays: 132.0, totalAmount: 52.8,  year: 2024, status: '已归档', updatedAt: '2024-08-30' },
  { id: 6, projectName: '金桥电子 PLM 实施',    customer: '金桥电子',     industry: '电子-EMS',  scale: '1600 人', version: 'v07', similarity: 64, totalDays: 178.5, totalAmount: 71.4,  year: 2025, status: '已归档', updatedAt: '2025-06-22' },
  { id: 7, projectName: '新材料财务共享中心',   customer: '新材料集团',   industry: '材料-化工', scale: '2200 人', version: 'v06', similarity: 58, totalDays: 220.0, totalAmount: 88.0,  year: 2024, status: '已归档', updatedAt: '2024-12-05' },
  { id: 8, projectName: '零售集团会员中台',     customer: '零售连锁',     industry: '消费-零售', scale: '4500 人', version: 'v08', similarity: 51, totalDays: 289.6, totalAmount: 115.8, year: 2025, status: '已归档', updatedAt: '2025-04-18' },
]
