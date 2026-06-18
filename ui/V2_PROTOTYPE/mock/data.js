/**
 * V2_PROTOTYPE mock data
 * 字段对齐 apps/api/src/types + ui/V0_SAAS/lib/workload-types.ts
 * 状态覆盖： drafting / reviewed / 评审中 / DSL 违反 / 系统账号
 */
// FROZEN @ 2026-05-09 W3 done. 后续 3 路并行 agent 只读不写。
(function () {
  'use strict';

  const plans = [
  {
    "id": 1,
    "projectName": "利民集团数字化二期",
    "globalVersion": "GL-04001",
    "assessmentVersion": "IA-04003",
    "resourceVersion": "RS-04001",
    "requirementVersion": "RQ-04001",
    "devVersion": "DV-04001",
    "createdAt": "2026-03-01T09:00:00Z",
    "updatedAt": "2026-04-18T09:30:00Z",
    "reviewedAt": "2026-04-10T16:00:00Z",
    "status": "已归档"
  },
  {
    "id": 2,
    "projectName": "巨三集团星空套件",
    "globalVersion": "GL-04002",
    "assessmentVersion": "IA-04004",
    "resourceVersion": "RS-04002",
    "requirementVersion": "RQ-04002",
    "devVersion": "DV-04002",
    "createdAt": "2026-03-05T09:00:00Z",
    "updatedAt": "2026-04-20T11:00:00Z",
    "reviewedAt": "",
    "status": "进行中"
  },
  {
    "id": 3,
    "projectName": "华鑫制造 MES 升级",
    "globalVersion": "GL-04003",
    "assessmentVersion": "IA-04005",
    "resourceVersion": "RS-04003",
    "requirementVersion": "RQ-04003",
    "devVersion": "DV-04003",
    "createdAt": "2026-03-10T09:00:00Z",
    "updatedAt": "2026-04-21T14:00:00Z",
    "reviewedAt": "",
    "status": "待评审"
  },
  {
    "id": 4,
    "projectName": "蓝海物流 TMS 集成",
    "globalVersion": "GL-04004",
    "assessmentVersion": "IA-04006",
    "resourceVersion": "RS-04004",
    "requirementVersion": "RQ-04004",
    "devVersion": "DV-04004",
    "createdAt": "2026-03-12T09:00:00Z",
    "updatedAt": "2026-04-22T10:00:00Z",
    "reviewedAt": "2026-04-15T18:00:00Z",
    "status": "已归档"
  },
  {
    "id": 5,
    "projectName": "金桥电子 PLM 实施",
    "globalVersion": "GL-04005",
    "assessmentVersion": "IA-04007",
    "resourceVersion": "RS-04005",
    "requirementVersion": "RQ-04005",
    "devVersion": "DV-04005",
    "createdAt": "2026-03-15T09:00:00Z",
    "updatedAt": "2026-04-23T09:00:00Z",
    "reviewedAt": "",
    "status": "进行中"
  },
  {
    "id": 6,
    "projectName": "银海财务共享中心",
    "globalVersion": "GL-04006",
    "assessmentVersion": "IA-04008",
    "resourceVersion": "RS-04006",
    "requirementVersion": "RQ-04006",
    "devVersion": "DV-04006",
    "createdAt": "2026-03-20T09:00:00Z",
    "updatedAt": "2026-04-24T16:00:00Z",
    "reviewedAt": "",
    "status": "待评审"
  }
];

  let requirements = [
  {
    "id": "RQ-GLOBAL-20260404-0053",
    "domain": "供应链",
    "category": "采购管理",
    "title": "SRM 供应商协同门户",
    "owner": "张鹏",
    "customDev": "是",
    "versionCode": "RQ-GLOBAL-20260404-0053-V01",
    "projectName": "巨三集团星空套件",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "customer": "巨三集团",
    "status": "进行中",
    "createdBy": "张鹏",
    "updatedBy": "李华",
    "updatedAt": "2026-04-18 14:33"
  },
  {
    "id": "RQ-GLOBAL-20260404-0054",
    "domain": "生产制造",
    "category": "计划排程",
    "title": "APS 高级排程算法优化",
    "owner": "李华",
    "customDev": "是",
    "versionCode": "RQ-GLOBAL-20260404-0054-V02",
    "projectName": "华鑫制造 MES 升级",
    "productLines": [
      "S/4HANA"
    ],
    "customer": "华鑫制造",
    "status": "已发布",
    "createdBy": "李华",
    "updatedBy": "张鹏",
    "updatedAt": "2026-04-17 14:33"
  },
  {
    "id": "RQ-GLOBAL-20260404-0055",
    "domain": "财务管理",
    "category": "成本核算",
    "title": "标准成本卷积计算",
    "owner": "王丽",
    "customDev": "否",
    "versionCode": "RQ-GLOBAL-20260404-0055-V03",
    "projectName": "蓝海物流 TMS 集成",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "customer": "蓝海物流",
    "status": "评审中",
    "createdBy": "王丽",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-16 14:33"
  },
  {
    "id": "RQ-GLOBAL-20260404-0056",
    "domain": "质量管理",
    "category": "来料检验",
    "title": "IQC 移动化检验",
    "owner": "赵强",
    "customDev": "是",
    "versionCode": "RQ-GLOBAL-20260404-0056-V04",
    "projectName": "金桥电子 PLM 实施",
    "productLines": [
      "S/4HANA"
    ],
    "customer": "金桥电子",
    "status": "草拟中",
    "createdBy": "赵强",
    "updatedBy": "孙敏",
    "updatedAt": "2026-04-15 14:33"
  },
  {
    "id": "RQ-GLOBAL-20260404-0057",
    "domain": "仓储物流",
    "category": "智能仓储",
    "title": "WMS 波次拣货策略",
    "owner": "孙敏",
    "customDev": "否",
    "versionCode": "RQ-GLOBAL-20260404-0057-V05",
    "projectName": "银海财务共享中心",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "customer": "银海财务",
    "status": "已检入",
    "createdBy": "孙敏",
    "updatedBy": "周涛",
    "updatedAt": "2026-04-14 14:33"
  },
  {
    "id": "RQ-GLOBAL-20260404-0058",
    "domain": "人力资源",
    "category": "薪酬绩效",
    "title": "绩效奖金自动核算",
    "owner": "周涛",
    "customDev": "否",
    "versionCode": "RQ-GLOBAL-20260404-0058-V06",
    "projectName": "合景泰富 ERP 重塑",
    "productLines": [
      "其它"
    ],
    "customer": "合景泰富",
    "status": "已检出",
    "createdBy": "周涛",
    "updatedBy": "张鹏",
    "updatedAt": "2026-04-13 14:33"
  }
];

  let assessments = [
  {
    "id": "ASM-018",
    "moduleName": "项目启动 + 章程",
    "difficulty": "低",
    "users": 10,
    "days": 6,
    "checkoutStatus": "checked_in",
    "versionDocStatus": "reviewed",
    "dslError": null,
    "versionCode": "ASM-018-v07",
    "projectName": "利民集团数字化二期",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "globalVersion": "GL-04001",
    "quoteMode": "标准实施",
    "totalMandays": 232.8,
    "orgCount": 3,
    "status": "进行中",
    "createdBy": "张鹏",
    "updatedBy": "李华",
    "updatedAt": "2026-04-18 14:33"
  },
  {
    "id": "ASM-019",
    "moduleName": "业务调研 · SCM",
    "difficulty": "中",
    "users": 50,
    "days": 20,
    "checkoutStatus": "checked_out",
    "versionDocStatus": "drafting",
    "dslError": null,
    "versionCode": "ASM-019-v04",
    "projectName": "巨三集团星空套件",
    "productLines": [
      "S/4HANA"
    ],
    "globalVersion": "GL-04002",
    "quoteMode": "轻量实施",
    "totalMandays": 186.0,
    "orgCount": 5,
    "status": "已发布",
    "createdBy": "李华",
    "updatedBy": "张鹏",
    "updatedAt": "2026-04-17 14:33"
  },
  {
    "id": "ASM-020",
    "moduleName": "蓝图设计 · PLM",
    "difficulty": "高",
    "users": 120,
    "days": 45,
    "checkoutStatus": "checked_in",
    "versionDocStatus": "drafting",
    "dslError": "DSL R-3 违反：单价超出 RateCard 上限（≤ 3,000）",
    "versionCode": "ASM-020-v03",
    "projectName": "华鑫制造 MES 升级",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "globalVersion": "GL-04003",
    "quoteMode": "标准实施",
    "totalMandays": 320.5,
    "orgCount": 2,
    "status": "评审中",
    "createdBy": "王丽",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-16 14:33"
  },
  {
    "id": "ASM-021",
    "moduleName": "系统开发 · APS",
    "difficulty": "高",
    "users": 200,
    "days": 90,
    "checkoutStatus": "checked_out",
    "versionDocStatus": "drafting",
    "dslError": null,
    "versionCode": "ASM-021-v05",
    "projectName": "蓝海物流 TMS 集成",
    "productLines": [
      "S/4HANA"
    ],
    "globalVersion": "GL-04004",
    "quoteMode": "轻量实施",
    "totalMandays": 150.2,
    "orgCount": 4,
    "status": "草拟中",
    "createdBy": "赵强",
    "updatedBy": "孙敏",
    "updatedAt": "2026-04-15 14:33"
  },
  {
    "id": "ASM-022",
    "moduleName": "数据迁移 · 历史",
    "difficulty": "中",
    "users": 80,
    "days": 30,
    "checkoutStatus": "checked_in",
    "versionDocStatus": "reviewed",
    "dslError": null,
    "versionCode": "ASM-022-v02",
    "projectName": "金桥电子 PLM 实施",
    "productLines": [
      "金蝶 AI 星空"
    ],
    "globalVersion": "GL-04005",
    "quoteMode": "标准实施",
    "totalMandays": 280.0,
    "orgCount": 6,
    "status": "已检入",
    "createdBy": "孙敏",
    "updatedBy": "周涛",
    "updatedAt": "2026-04-14 14:33"
  },
  {
    "id": "ASM-023",
    "moduleName": "用户培训 · 财务",
    "difficulty": "低",
    "users": 30,
    "days": 12,
    "checkoutStatus": "checked_in",
    "versionDocStatus": "drafting",
    "dslError": null,
    "versionCode": "ASM-023-v01",
    "projectName": "银海财务共享中心",
    "productLines": [
      "其它"
    ],
    "globalVersion": "GL-04006",
    "quoteMode": "标准实施",
    "totalMandays": 195.4,
    "orgCount": 3,
    "status": "已检出",
    "createdBy": "周涛",
    "updatedBy": "张鹏",
    "updatedAt": "2026-04-13 14:33"
  }
];

  let devAssessments = [
  {
    "id": "DV-04001",
    "moduleName": "采购订单审批流",
    "devType": "功能开发",
    "codingDays": 8,
    "basis": "标准工作流模板",
    "projectName": "利民集团数字化二期",
    "globalVersion": "GL-04001",
    "versionCode": "DV-040001-v04",
    "assessor": "赵强",
    "totalMandays": 88,
    "status": "进行中",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-18 14:33"
  },
  {
    "id": "DV-04002",
    "moduleName": "APS 排程算法",
    "devType": "集成开发",
    "codingDays": 45,
    "basis": "第三方算法 SDK 对接",
    "projectName": "巨三集团星空套件",
    "globalVersion": "GL-04002",
    "versionCode": "DV-040002-v04",
    "assessor": "赵强",
    "totalMandays": 120,
    "status": "已发布",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-17 14:33"
  },
  {
    "id": "DV-04003",
    "moduleName": "成本分析报表",
    "devType": "报表开发",
    "codingDays": 12,
    "basis": "帆软报表引擎",
    "projectName": "华鑫制造 MES 升级",
    "globalVersion": "GL-04003",
    "versionCode": "DV-040003-v04",
    "assessor": "赵强",
    "totalMandays": 95,
    "status": "评审中",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-16 14:33"
  },
  {
    "id": "DV-04004",
    "moduleName": "WMS 波次接口",
    "devType": "集成开发",
    "codingDays": 18,
    "basis": "中间表 + MQ 同步",
    "projectName": "蓝海物流 TMS 集成",
    "globalVersion": "GL-04004",
    "versionCode": "DV-040004-v04",
    "assessor": "赵强",
    "totalMandays": 60,
    "status": "草拟中",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-15 14:33"
  },
  {
    "id": "DV-04005",
    "moduleName": "绩效奖金计算",
    "devType": "功能开发",
    "codingDays": 22,
    "basis": "规则引擎配置",
    "projectName": "金桥电子 PLM 实施",
    "globalVersion": "GL-04005",
    "versionCode": "DV-040005-v04",
    "assessor": "赵强",
    "totalMandays": 110,
    "status": "已检入",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-14 14:33"
  },
  {
    "id": "DV-04006",
    "moduleName": "质量追溯大屏",
    "devType": "报表开发",
    "codingDays": 16,
    "basis": "BI 大屏模板",
    "projectName": "银海财务共享中心",
    "globalVersion": "GL-04006",
    "versionCode": "DV-040006-v04",
    "assessor": "赵强",
    "totalMandays": 75,
    "status": "已检出",
    "createdBy": "赵强",
    "updatedBy": "赵强",
    "updatedAt": "2026-04-13 14:33"
  }
];

  let resourceCosts = [
  {
    "id": "RS-04001",
    "role": "项目经理",
    "name": "张鹏",
    "unitCost": 2800,
    "plannedDays": 60,
    "travelCost": 12000,
    "projectName": "利民集团数字化二期",
    "globalVersion": "GL-04001",
    "versionCode": "RS-040001-v04",
    "quoteMode": "标准实施",
    "totalMandays": 232.8,
    "orgCount": 3,
    "status": "进行中",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-18 14:33"
  },
  {
    "id": "RS-04002",
    "role": "业务顾问",
    "name": "李华",
    "unitCost": 2200,
    "plannedDays": 90,
    "travelCost": 8000,
    "projectName": "巨三集团星空套件",
    "globalVersion": "GL-04002",
    "versionCode": "RS-040002-v04",
    "quoteMode": "轻量实施",
    "totalMandays": 186.0,
    "orgCount": 5,
    "status": "已发布",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-17 14:33"
  },
  {
    "id": "RS-04003",
    "role": "开发工程师",
    "name": "赵强",
    "unitCost": 1800,
    "plannedDays": 120,
    "travelCost": 0,
    "projectName": "华鑫制造 MES 升级",
    "globalVersion": "GL-04003",
    "versionCode": "RS-040003-v04",
    "quoteMode": "标准实施",
    "totalMandays": 320.5,
    "orgCount": 2,
    "status": "评审中",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-16 14:33"
  },
  {
    "id": "RS-04004",
    "role": "测试工程师",
    "name": "孙敏",
    "unitCost": 1500,
    "plannedDays": 45,
    "travelCost": 0,
    "projectName": "蓝海物流 TMS 集成",
    "globalVersion": "GL-04004",
    "versionCode": "RS-040004-v04",
    "quoteMode": "轻量实施",
    "totalMandays": 150.2,
    "orgCount": 4,
    "status": "草拟中",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-15 14:33"
  },
  {
    "id": "RS-04005",
    "role": "数据工程师",
    "name": "周涛",
    "unitCost": 2000,
    "plannedDays": 30,
    "travelCost": 4000,
    "projectName": "金桥电子 PLM 实施",
    "globalVersion": "GL-04005",
    "versionCode": "RS-040005-v04",
    "quoteMode": "标准实施",
    "totalMandays": 280.0,
    "orgCount": 6,
    "status": "已检入",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-14 14:33"
  },
  {
    "id": "RS-04006",
    "role": "运维工程师",
    "name": "吴磊",
    "unitCost": 1600,
    "plannedDays": 20,
    "travelCost": 0,
    "projectName": "银海财务共享中心",
    "globalVersion": "GL-04006",
    "versionCode": "RS-040006-v04",
    "quoteMode": "标准实施",
    "totalMandays": 195.4,
    "orgCount": 3,
    "status": "已检出",
    "createdBy": "王丽",
    "updatedBy": "王丽",
    "updatedAt": "2026-04-13 14:33"
  }
];

  let wbs = [
  {
    "id": "WBS-001",
    "moduleKey": "requirementImport",
    "taskName": "需求调研与确认",
    "owner": "张鹏",
    "linkedVersionCode": "RQ-04001",
    "sourceGlobalVersionCode": "GL-04001",
    "sourceGlobalRecordId": "1",
    "isDerived": true,
    "start": "2026-03-01",
    "end": "2026-03-15",
    "status": "已完成",
    "subTitle": "RQ-04001",
    "phase": "启动",
    "ganttDone": 100,
    "ganttInProgress": 0
  },
  {
    "id": "WBS-002",
    "moduleKey": "assessment",
    "taskName": "实施评估编制",
    "owner": "李华",
    "linkedVersionCode": "IA-04003",
    "sourceGlobalVersionCode": "GL-04001",
    "sourceGlobalRecordId": "1",
    "isDerived": true,
    "start": "2026-03-16",
    "end": "2026-04-10",
    "status": "进行中",
    "subTitle": "IA-04003",
    "phase": "蓝图",
    "ganttDone": 60,
    "ganttInProgress": 40
  },
  {
    "id": "WBS-003",
    "moduleKey": "dev",
    "taskName": "开发任务分解",
    "owner": "赵强",
    "linkedVersionCode": "DV-04001",
    "sourceGlobalVersionCode": "GL-04001",
    "sourceGlobalRecordId": "1",
    "isDerived": true,
    "start": "2026-04-11",
    "end": "2026-05-30",
    "status": "未开始",
    "subTitle": "DV-04001",
    "phase": "实现",
    "ganttDone": 0,
    "ganttInProgress": 0
  },
  {
    "id": "WBS-004",
    "moduleKey": "resource",
    "taskName": "资源成本核算",
    "owner": "王丽",
    "linkedVersionCode": "RS-04001",
    "sourceGlobalVersionCode": "GL-04001",
    "sourceGlobalRecordId": "1",
    "isDerived": true,
    "start": "2026-04-01",
    "end": "2026-04-20",
    "status": "进行中",
    "subTitle": "RS-04001",
    "phase": "上线",
    "ganttDone": 30,
    "ganttInProgress": 70
  },
  {
    "id": "WBS-005",
    "moduleKey": "requirementImport",
    "taskName": "需求变更评审",
    "owner": "张鹏",
    "linkedVersionCode": "RQ-04002",
    "sourceGlobalVersionCode": "GL-04002",
    "sourceGlobalRecordId": "2",
    "isDerived": false,
    "start": "2026-04-15",
    "end": "2026-04-25",
    "status": "进行中",
    "subTitle": "RQ-04002",
    "phase": "启动",
    "ganttDone": 80,
    "ganttInProgress": 20
  },
  {
    "id": "WBS-006",
    "moduleKey": "assessment",
    "taskName": "评估版本升版",
    "owner": "李华",
    "linkedVersionCode": "IA-04004",
    "sourceGlobalVersionCode": "GL-04002",
    "sourceGlobalRecordId": "2",
    "isDerived": false,
    "start": "2026-04-20",
    "end": "2026-04-30",
    "status": "未开始",
    "subTitle": "IA-04004",
    "phase": "蓝图",
    "ganttDone": 10,
    "ganttInProgress": 90
  }
];

  let reviews = [
  {
    "id": "RV-2026-018",
    "reviewId": "RV-2026-018",
    "versionCode": "IA-04003-v07",
    "reviewer": "王丽",
    "status": "通过",
    "updatedAt": "2026-04-18T10:00:00Z",
    "relatedPlan": "利民集团数字化二期",
    "relatedVersion": "GL-04001-v07",
    "reviewers": [
      "王丽",
      "张鹏"
    ],
    "deadline": "2026-04-20",
    "createdBy": "王丽",
    "updatedBy": "王丽"
  },
  {
    "id": "RV-2026-019",
    "reviewId": "RV-2026-019",
    "versionCode": "RQ-04001-v03",
    "reviewer": "张鹏",
    "status": "待评审",
    "updatedAt": "2026-04-20T14:00:00Z",
    "relatedPlan": "巨三集团星空套件",
    "relatedVersion": "GL-04002-v03",
    "reviewers": [
      "张鹏",
      "李华"
    ],
    "deadline": "2026-04-25",
    "createdBy": "张鹏",
    "updatedBy": "张鹏"
  },
  {
    "id": "RV-2026-020",
    "reviewId": "RV-2026-020",
    "versionCode": "DV-04001-v05",
    "reviewer": "赵强",
    "status": "驳回",
    "updatedAt": "2026-04-19T16:00:00Z",
    "relatedPlan": "华鑫制造 MES 升级",
    "relatedVersion": "GL-04003-v05",
    "reviewers": [
      "赵强"
    ],
    "deadline": "2026-04-19",
    "createdBy": "赵强",
    "updatedBy": "赵强"
  },
  {
    "id": "RV-2026-021",
    "reviewId": "RV-2026-021",
    "versionCode": "RS-04001-v04",
    "reviewer": "李华",
    "status": "待评审",
    "updatedAt": "2026-04-21T09:00:00Z",
    "relatedPlan": "蓝海物流 TMS 集成",
    "relatedVersion": "GL-04004-v02",
    "reviewers": [
      "李华",
      "周涛"
    ],
    "deadline": "2026-04-22",
    "createdBy": "李华",
    "updatedBy": "李华"
  },
  {
    "id": "RV-2026-022",
    "reviewId": "RV-2026-022",
    "versionCode": "ASM-018-v07",
    "reviewer": "周涛",
    "status": "通过",
    "updatedAt": "2026-04-15T11:00:00Z",
    "relatedPlan": "金桥电子 PLM 实施",
    "relatedVersion": "GL-04005-v04",
    "reviewers": [
      "周涛",
      "吴磊"
    ],
    "deadline": "2026-04-30",
    "createdBy": "周涛",
    "updatedBy": "周涛"
  },
  {
    "id": "RV-2026-023",
    "reviewId": "RV-2026-023",
    "versionCode": "GL-04001-v08",
    "reviewer": "吴磊",
    "status": "待评审",
    "updatedAt": "2026-04-22T10:00:00Z",
    "relatedPlan": "银海财务共享中心",
    "relatedVersion": "GL-04006-v01",
    "reviewers": [
      "吴磊"
    ],
    "deadline": "2026-04-18",
    "createdBy": "吴磊",
    "updatedBy": "吴磊"
  }
];

  const users = [
  {
    "id": "U-001",
    "username": "admin",
    "role": "admin",
    "status": "active",
    "lastLoginAt": "2026-04-24T08:30:00Z"
  },
  {
    "id": "U-002",
    "username": "zhangpeng",
    "role": "sub_admin",
    "status": "active",
    "lastLoginAt": "2026-04-23T18:00:00Z"
  },
  {
    "id": "U-003",
    "username": "lihua",
    "role": "user",
    "status": "active",
    "lastLoginAt": "2026-04-22T09:15:00Z"
  },
  {
    "id": "U-004",
    "username": "wangli",
    "role": "user",
    "status": "disabled",
    "lastLoginAt": "2026-03-10T16:00:00Z"
  },
  {
    "id": "U-005",
    "username": "zhaoqiang",
    "role": "user",
    "status": "active",
    "lastLoginAt": "2026-04-21T11:00:00Z"
  },
  {
    "id": "U-006",
    "username": "sunmin",
    "role": "sub_admin",
    "status": "active",
    "lastLoginAt": "2026-04-20T14:30:00Z"
  }
];

  const rateCard = [
  {
    "role": "项目经理",
    "unitPriceMax": 3000,
    "currency": "CNY",
    "region": "华东"
  },
  {
    "role": "业务顾问",
    "unitPriceMax": 2500,
    "currency": "CNY",
    "region": "华东"
  },
  {
    "role": "开发工程师",
    "unitPriceMax": 2000,
    "currency": "CNY",
    "region": "华东"
  },
  {
    "role": "测试工程师",
    "unitPriceMax": 1800,
    "currency": "CNY",
    "region": "华东"
  },
  {
    "role": "数据工程师",
    "unitPriceMax": 2200,
    "currency": "CNY",
    "region": "华东"
  },
  {
    "role": "运维工程师",
    "unitPriceMax": 1600,
    "currency": "CNY",
    "region": "华东"
  }
];

  const rules = [
  {
    "id": "R-001",
    "subject": "SRM 供应商协同",
    "scope": "feature",
    "logic": "requires_all",
    "trigger": "启用 SRM 模块",
    "dependencies": [
      "供应商主数据",
      "采购申请工作流"
    ],
    "enabled": true
  },
  {
    "id": "R-002",
    "subject": "APS 排程算法",
    "scope": "scenario",
    "logic": "requires_any",
    "trigger": "启用 APS 模块",
    "dependencies": [
      "MRP 运算",
      "产能模型"
    ],
    "enabled": true
  },
  {
    "id": "R-003",
    "subject": "成本卷积计算",
    "scope": "feature",
    "logic": "combo",
    "trigger": "启用标准成本",
    "dependencies": [
      "BOM 多版本",
      "工艺路线"
    ],
    "enabled": true
  },
  {
    "id": "R-004",
    "subject": "WMS 波次拣货",
    "scope": "scenario",
    "logic": "requires_all",
    "trigger": "启用 WMS 模块",
    "dependencies": [
      "库位管理",
      "条码打印"
    ],
    "enabled": false
  },
  {
    "id": "R-005",
    "subject": "绩效奖金核算",
    "scope": "data_source",
    "logic": "requires_any",
    "trigger": "启用薪酬模块",
    "dependencies": [
      "考勤数据",
      "绩效评分"
    ],
    "enabled": true
  },
  {
    "id": "R-006",
    "subject": "质量追溯大屏",
    "scope": "feature",
    "logic": "requires_all",
    "trigger": "启用 QMS 模块",
    "dependencies": [
      "检验标准",
      "不合格品处理"
    ],
    "enabled": true
  }
];

  const dashboard = {"plansTotal": 12, "requirementsTotal": 186, "mandaysTotal": 762, "membersTotal": 14, "online": 6};
  const feed = [
  {
    "avatar": "李",
    "name": "李华",
    "action": "更新了 ASM-20260329-07 的难度系数",
    "time": "12 分钟前",
    "accent": false
  },
  {
    "avatar": "王",
    "name": "王敏",
    "action": "提交了 REQ-20260329-03 的需求条目回填",
    "time": "28 分钟前",
    "accent": false
  },
  {
    "avatar": "张",
    "name": "张凯",
    "action": "在 DEV-20260329-02 增加了 5 个开发子项",
    "time": "1 小时前",
    "accent": false
  },
  {
    "avatar": "系",
    "name": "系统",
    "action": "同步资源成本草稿到总方案版本",
    "time": "2 小时前",
    "accent": true
  }
];
  const currentUser = {
  "id": "U-000",
  "username": "mjlkevin",
  "role": "admin",
  "status": "active",
  "lastLoginAt": "2026-04-24T08:30:00Z",
  "displayName": "mjlkevin",
  "title": "超级管理员"
};

  const systemSettings = {
    versionCodeRules: [
      { module: '需求', code: 'RQ', prefix: 'RQ-', format: 'RQ-YYYYMMDD-0000-VNN', example: 'RQ-20260418-0053-V01', status: 'active', activatedAt: '2026-04-01T09:00:00Z' },
      { module: '实施评估', code: 'IA', prefix: 'IA-', format: 'IA-YYYYMMDD-0000-VNN', example: 'IA-20260418-0180-V07', status: 'active', activatedAt: '2026-04-01T09:00:00Z' },
      { module: '资源成本', code: 'RS', prefix: 'RS-', format: 'RS-YYYYMMDD-0000-VNN', example: 'RS-20260418-0180-V03', status: 'active', activatedAt: '2026-04-01T09:00:00Z' },
      { module: '开发评估', code: 'DV', prefix: 'DV-', format: 'DV-YYYYMMDD-0000-VNN', example: 'DV-20260418-0180-V04', status: 'active', activatedAt: '2026-04-01T09:00:00Z' },
      { module: 'WBS', code: 'WB', prefix: 'WB-', format: 'WB-YYYYMMDD-0000-VNN', example: 'WB-20260418-0180-V02', status: 'active', activatedAt: '2026-04-01T09:00:00Z' },
      { module: '评审', code: 'RV', prefix: 'RV-', format: 'RV-YYYYMMDD-0000-VNN', example: 'RV-20260418-0180-V01', status: 'disabled', activatedAt: '2026-04-01T09:00:00Z' }
    ],
    modelConfig: {
      apiKeyMasked: 'sk-****-9f3a',
      kimiEvaluation: { enabled: true, model: 'kimi-eval-2026-04', promptProfile: 'assessment-v3', temperature: 0.2, maxTokens: 8192 },
      kimiGeneration: { enabled: true, model: 'kimi-gen-2026-04', promptProfile: 'draft-v2', temperature: 0.35, maxTokens: 12288 },
      kimiFileParsing: { enabled: true, model: 'kimi-parse-2026-04', maxFileMB: 20 },
      draftSavedAt: '2026-05-09T08:18:00Z',
      activatedAt: '2026-04-01T09:00:00Z'
    },
    rateCardActive: { id: 'RC-2026-Q2', quarter: '2026Q2', currency: 'CNY', table: rateCard },
    dslRuleSetActive: { id: 'DSL-2026-Q2', schemaVersion: '2.4.1', rulesJson: JSON.stringify(rules) }
  };

  const inviteCodes = [
    { code: 'INV-20260509-A1', status: 'USED', createdAt: '2026-05-01T09:00:00Z' },
    { code: 'INV-20260509-A2', status: 'AVAIL', createdAt: '2026-05-02T09:00:00Z' },
    { code: 'INV-20260509-A3', status: 'USED', createdAt: '2026-05-03T09:00:00Z' },
    { code: 'INV-20260509-A4', status: 'AVAIL', createdAt: '2026-05-04T09:00:00Z' }
  ];

  const apiCatalog = {
    Health: [
      { method: 'GET', path: '/health', desc: '服务健康检查' },
      { method: 'GET', path: '/health/db', desc: '数据库连通性检查' }
    ],
    Auth: [
      { method: 'POST', path: '/api/auth/login', desc: '账号登录获取 JWT' },
      { method: 'POST', path: '/api/auth/refresh', desc: '刷新访问令牌' }
    ],
    Templates: [
      { method: 'GET', path: '/api/templates', desc: '获取模板列表' },
      { method: 'GET', path: '/api/templates/:id', desc: '获取模板详情' }
    ],
    Estimates: [
      { method: 'GET', path: '/api/assessments', desc: '实施评估列表' },
      { method: 'POST', path: '/api/assessments/:id/export', desc: '导出评估草稿' }
    ],
    RuleSets: [
      { method: 'GET', path: '/api/rulesets', desc: '规则集列表' },
      { method: 'PUT', path: '/api/rulesets/:id/activate', desc: '激活规则集' }
    ],
    AI: [
      { method: 'POST', path: '/api/ai/parse-file', desc: 'Kimi 文件解析' },
      { method: 'POST', path: '/api/ai/generate-draft', desc: 'Kimi 草稿生成' }
    ]
  };

  const historyProjects = [
    { id: 'HIS-001', name: '利民集团数字化二期', customer: '利民集团', industry: '制造', scale: '大', totalDays: 232.8, totalAmount: 2860000, year: 2026, similarity: 0.96 },
    { id: 'HIS-002', name: '巨三集团星空套件', customer: '巨三集团', industry: '零售', scale: '大', totalDays: 186.0, totalAmount: 2140000, year: 2026, similarity: 0.91 },
    { id: 'HIS-003', name: '华鑫制造 MES 升级', customer: '华鑫制造', industry: '制造', scale: '中', totalDays: 320.5, totalAmount: 4120000, year: 2026, similarity: 0.89 },
    { id: 'HIS-004', name: '蓝海物流 TMS 集成', customer: '蓝海物流', industry: '物流', scale: '中', totalDays: 150.2, totalAmount: 1680000, year: 2025, similarity: 0.84 },
    { id: 'HIS-005', name: '金桥电子 PLM 实施', customer: '金桥电子', industry: '电子', scale: '中', totalDays: 280.0, totalAmount: 3320000, year: 2025, similarity: 0.82 },
    { id: 'HIS-006', name: '银海财务共享中心', customer: '银海财务', industry: '金融', scale: '大', totalDays: 195.4, totalAmount: 2480000, year: 2025, similarity: 0.79 },
    { id: 'HIS-007', name: '合景泰富 ERP 重塑', customer: '合景泰富', industry: '地产', scale: '大', totalDays: 244.6, totalAmount: 2980000, year: 2024, similarity: 0.76 },
    { id: 'HIS-008', name: '华南医药供应链协同', customer: '华南医药', industry: '医药', scale: '中', totalDays: 164.8, totalAmount: 1890000, year: 2024, similarity: 0.74 }
  ];

  const historySimilarSearch = {
    query: '制造业多基地 + 评估/资源成本联动',
    matches: [historyProjects[2], historyProjects[0], historyProjects[4], historyProjects[3]]
  };

  requirements = requirements.map(function (item, index) {
    return Object.assign({}, item, {
      basicInfo: { customer: item.customer, location: index % 2 === 0 ? '深圳 · 南山' : '苏州 · 工业园', project: item.projectName, opportunityNo: 'OP-2026-' + String(5300 + index), productLines: item.productLines, industry: item.domain, revenue: index % 2 === 0 ? '3200 万' : '1800 万', itStatus: index % 2 === 0 ? '建设中' : '待立项', expectedLaunch: '2026-08-15', profile: '总部与两地工厂协同，现有 Excel/邮件驱动。', background: '客户希望统一需求入口、审批与版本留痕。', projectGoal: '缩短评审周期并锁定可交付范围。' },
      valuePropositions: [
        { type: '价值', text: '减少重复沟通与版本分叉。' },
        { type: '要求', text: '保留原始访谈记录与变更痕迹。' },
        { type: '指标', text: '需求确认时长下降 35%。' }
      ],
      scopeItems: [
        { group: 'A', name: '主数据梳理', desc: '统一客户、物料、供应商主数据。', priority: 'P0', owner: '业务顾问', status: '已完成' },
        { group: 'A', name: '流程确认', desc: '确认审批链、回退与抄送规则。', priority: 'P0', owner: '项目经理', status: '进行中', dslIssue: { ruleId: 'R-001', message: '审批节点需绑定全部依赖。' } },
        { group: 'A', name: '多基地差异', desc: '梳理总部/工厂差异流程。', priority: 'P1', owner: '业务顾问', status: '待确认' },
        { group: 'A', name: '报表口径', desc: '统一需求、评审、版本统计口径。', priority: 'P1', owner: '数据工程师', status: '已完成' },
        { group: 'B', name: '权限矩阵', desc: '角色、组织与按钮权限。', priority: 'P0', owner: '测试工程师', status: '进行中' },
        { group: 'B', name: '接口清单', desc: '列出 ERP / MES / WMS 集成点。', priority: 'P1', owner: '开发工程师', status: '待确认' },
        { group: 'B', name: '验收样例', desc: '提供 3 套可复核样例。', priority: 'P2', owner: '业务顾问', status: '已完成' },
        { group: 'B', name: '培训计划', desc: '上线培训与答疑窗口。', priority: 'P2', owner: '项目经理', status: '待确认' }
      ],
      developmentOverview: [
        { module: '流程引擎', scope: '审批与回退', days: 8, owner: '赵强' },
        { module: '报表中心', scope: '统计与导出', days: 6, owner: '周涛' },
        { module: '集成层', scope: 'ERP/MES 同步', days: 10, owner: '孙敏' }
      ],
      productModules: ['需求中心', '评审中心', '版本中心'],
      implementationScope: ['深圳总部', '苏州工厂'],
      keyPoints: ['需保留历史版本链路', '支持多组织审批', '上线窗口避开月结'],
      meetingNotes: '访谈纪要：客户强调需求入口必须统一到一个页面，且每次变更都要保留原始提交人、修改人和时间戳。业务团队希望先锁定主流程，再逐步扩展到多基地和报表。',
      completion: { basic: '9/9', value: '3/3', items: '17/22', dslViolations: 1 },
      timeline: [
        { version: 'V01', label: '草拟', cur: false, at: '2026-04-01' },
        { version: 'V02', label: '访谈确认', cur: false, at: '2026-04-06' },
        { version: 'V03', label: '评审中', cur: index === 2, at: '2026-04-12' },
        { version: 'V04', label: '已发布', cur: index === 1, at: '2026-04-18' }
      ]
    });
  });

  assessments = assessments.map(function (item, index) {
    return Object.assign({}, item, {
      context: { template: '实施评估标准版', ruleSet: 'DSL-2026-Q2', globalVersion: item.globalVersion, requirementSource: 'RQ-' + String(4000 + index + 1) },
      userCount: item.users,
      difficultyFactor: index === 0 ? 1.1 : index === 1 ? 1.6 : index === 2 ? 2.2 : index === 3 ? 2.0 : index === 4 ? 1.4 : 0.9,
      orgCount: item.orgCount,
      orgSimilarity: index === 0 ? 0.92 : 0.81,
      quoteMode: item.quoteMode,
      sheet: '评估单-' + item.versionCode,
      skuTree: [
        { name: '基础包', group: 'A', moduleDesc: '覆盖项目启动、组织、权限三大根基', children: [
          { name: '启动配置', description: '环境部署 + 基础参数初始化', baseDays: 2, factor: 1, unitPrice: 1200, customDays: 0, reduction: 0, included: true, group: 'A' },
          { name: '组织初始化', description: '导入组织树 + 角色矩阵', baseDays: 3, factor: 1.2, unitPrice: 1500, customDays: 1, reduction: 0, included: true, group: 'A' },
          { name: '角色权限', description: '权限矩阵 + 数据隔离策略', baseDays: 4, factor: 1, unitPrice: 1600, customDays: 0, reduction: 0, included: true, group: 'A' }
        ]},
        { name: '扩展包', group: 'B', moduleDesc: '高级流程、可视化报表、对外接口', children: [
          { name: '流程编排', description: '可视化流程引擎 + 节点配置', baseDays: 5, factor: 1.4, unitPrice: 1800, customDays: 2, reduction: 1, included: index !== 4, group: 'B' },
          { name: '报表导出', description: 'PDF / Excel / MD 多格式输出', baseDays: 3, factor: 1, unitPrice: 1400, customDays: 0, reduction: 0, included: true, group: 'B' },
          { name: '接口对接', description: 'REST + gRPC + WebSocket 三栈接入', baseDays: 6, factor: 1.5, unitPrice: 2200, customDays: 3, reduction: 0, included: index !== 5, group: 'B' }
        ]},
        { name: '专项包', group: 'C', moduleDesc: '差异化适配、性能验证、上线保障', children: [
          { name: '多基地差异', description: '多组织数据 + 业务规则差异化', baseDays: 4, factor: 1.3, unitPrice: 2000, customDays: 1, reduction: 0, included: index % 2 === 0, group: 'C' },
          { name: '性能压测', description: 'JMeter 全链路压测 + 峰值预测', baseDays: 2, factor: 1.1, unitPrice: 1700, customDays: 0, reduction: 0, included: true, group: 'C' },
          { name: '上线护航', description: 'T+30 远程支持 + 应急响应', baseDays: 3, factor: 1, unitPrice: 1900, customDays: 1, reduction: 0, included: index !== 3, group: 'C' }
        ]}
      ],
      dslIssues: [
        { ruleId: 'R-001', type: 'requires_all', message: '流程编排缺少全部依赖项。', blocking: index === 2 },
        { ruleId: 'R-003', type: 'combo', message: '组合包与专项包存在互斥折扣。', blocking: false }
      ],
      multiOrg: { rows: [
        { org: '总部', strategy: '标准', increment: 0 },
        { org: '华东工厂', strategy: '差异化', increment: 8 },
        { org: '华南工厂', strategy: '差异化', increment: 6 }
      ] },
      exportHistory: [
        { id: 'EXP-1', type: 'pdf', fileName: item.versionCode + '.pdf', createdAt: '2026-04-18T10:00:00Z', downloadUrl: '/downloads/' + item.versionCode + '.pdf' },
        { id: 'EXP-2', type: 'xlsx', fileName: item.versionCode + '.xlsx', createdAt: '2026-04-18T10:10:00Z', downloadUrl: '/downloads/' + item.versionCode + '.xlsx' },
        { id: 'EXP-3', type: 'md', fileName: item.versionCode + '.md', createdAt: '2026-04-18T10:20:00Z', downloadUrl: '/downloads/' + item.versionCode + '.md' },
        { id: 'EXP-4', type: 'preview', fileName: item.versionCode + '-preview', createdAt: '2026-04-18T10:30:00Z', downloadUrl: '/downloads/' + item.versionCode + '-preview' }
      ],
      summary: { ruleVersion: '2026.04', pipelineVersion: 'p-1.8', totalDays: item.days, totalAmount: Math.round(item.totalMandays * 12000) }
    });
  });

  resourceCosts = resourceCosts.map(function (item, index) {
    return Object.assign({}, item, {
      contextRef: { globalVersion: item.globalVersion, assessmentRef: 'IA-' + String(4000 + index + 1), version: item.versionCode },
      mandayStructure: { byModule: [{ module: '实施', days: item.plannedDays }, { module: '差旅', days: index % 2 === 0 ? 4 : 2 }], byType: [{ type: '咨询', days: item.plannedDays - 10 }, { type: '开发', days: 8 }, { type: '测试', days: 6 }] },
      mandayAllocation: { totalAssessment: item.totalMandays, allocated: item.plannedDays + 10, percent: Math.round(((item.plannedDays + 10) / item.totalMandays) * 100) },
      costShare: { byRole: [{ role: item.role, amount: item.unitCost * item.plannedDays, percent: 62 }, { role: '差旅', amount: item.travelCost, percent: 8 }, { role: '管理费', amount: 24000, percent: 30 }], totalAmount: item.unitCost * item.plannedDays + item.travelCost + 24000 },
      detailRows: [
        { role: 'A', name: '项目经理', unitPrice: 2800, planDays: 20, travelCost: 3000, subtotal: 59000, monthly: { '2026-05': 8, '2026-06': 4, '2026-07': 4, '2026-08': 2, '2026-09': 2 } },
        { role: 'A', name: '业务顾问', unitPrice: 2200, planDays: 18, travelCost: 2000, subtotal: 41600, monthly: { '2026-05': 6, '2026-06': 4, '2026-07': 4, '2026-08': 2, '2026-09': 2 } },
        { role: 'B', name: '开发工程师', unitPrice: 1800, planDays: 24, travelCost: 0, subtotal: 43200, monthly: { '2026-05': 10, '2026-06': 6, '2026-07': 4, '2026-08': 2, '2026-09': 2 } },
        { role: 'C', name: '测试工程师', unitPrice: 1500, planDays: 12, travelCost: 0, subtotal: 18000, monthly: { '2026-05': 2, '2026-06': 3, '2026-07': 3, '2026-08': 2, '2026-09': 2 } }
      ],
      monthCount: 5,
      includeTravel: true,
      vsAssessment: { assessmentDays: item.totalMandays, allocatedDays: item.plannedDays + 10, diff: Math.round(item.totalMandays - (item.plannedDays + 10)), suggestion: index === 2 ? '补充专项评估后再冻结' : '可直接进入资源确认' }
    });
  });

  devAssessments = devAssessments.map(function (item, index) {
    return Object.assign({}, item, {
      items: [
        { name: 'A-接口联调', scope: '核心', baseDays: 4, complexity: '中', factorDays: 5, owner: '赵强', status: '进行中' },
        { name: 'A-页面适配', scope: '核心', baseDays: 3, complexity: '低', factorDays: 3, owner: '孙敏', status: '已完成' },
        { name: 'B-规则引擎', scope: '扩展', baseDays: 6, complexity: '高', factorDays: 9, owner: '周涛', status: '待确认' },
        { name: 'B-自动化测试', scope: '扩展', baseDays: 2, complexity: '中', factorDays: 3, owner: '吴磊', status: index === 2 ? '驳回' : '已检入' }
      ],
      evaluators: ['赵强', '李华', '王丽']
    });
  });

  wbs = wbs.map(function (item, index) {
    return Object.assign({}, item, {
      subtasks: [
        { name: '需求确认', phase: '启动', owner: '张鹏', startDate: '2026-03-01', endDate: '2026-03-05', progress: 100, status: '已完成', relatedVersion: item.linkedVersionCode },
        { name: '方案评审', phase: '蓝图', owner: '李华', startDate: '2026-03-06', endDate: '2026-03-15', progress: 80, status: '进行中', relatedVersion: item.linkedVersionCode },
        { name: '配置开发', phase: '实现', owner: '赵强', startDate: '2026-03-16', endDate: '2026-04-10', progress: 45, status: '进行中', relatedVersion: item.linkedVersionCode },
        { name: '上线验收', phase: '上线', owner: '王丽', startDate: '2026-04-11', endDate: '2026-04-20', progress: 10, status: index === 3 ? '未开始' : '进行中', relatedVersion: item.linkedVersionCode }
      ]
    });
  });

  reviews = reviews.map(function (item, index) {
    return Object.assign({}, item, {
      checklist: [
        { name: '版本号正确', desc: '检查与上游版本链一致', type: '必检', result: '通过', reviewer: item.reviewer },
        { name: 'DSL 规则', desc: '检查是否存在阻断规则', type: '必检', result: index === 2 ? '不通过' : '通过', reviewer: item.reviewer },
        { name: '金额口径', desc: '检查金额与成本明细一致', type: '建议', result: '通过', reviewer: '李华' },
        { name: '附件完整', desc: '检查相关文档是否齐备', type: '建议', result: '通过', reviewer: '张鹏' }
      ],
      comments: [
        { user: '王丽', avatar: '王', time: '10:00', content: '建议补充多基地差异说明。', mentions: ['李华'] },
        { user: '张鹏', avatar: '张', time: '10:12', content: '已补充评审记录与截图。', mentions: [] }
      ],
      deadline: item.deadline,
      relatedDocs: { assessment: item.relatedVersion, resourceCost: 'RS-04001', requirement: 'RQ-04001' }
    });
  });

  window.MOCK = { plans, requirements, assessments, devAssessments, resourceCosts, wbs, reviews, users, rateCard, rules, dashboard, feed, currentUser, systemSettings, inviteCodes, apiCatalog, historyProjects, historySimilarSearch };
})();


/* ---- shared render helpers (W3-patch) ---- */
function renderProductLine(name) {
  var map = {
    '金蝶 AI 星空': { soft:'var(--teal-soft)', ink:'var(--teal)', dot:'var(--teal)' },
    '云之家':       { soft:'var(--info-soft)', ink:'var(--info)',  dot:'var(--info)' },
    'S/4HANA':      { soft:'var(--accent-soft)', ink:'var(--accent-ink)', dot:'var(--accent)' }
  };
  var c = map[name] || { soft:'var(--bg-soft)', ink:'var(--ink-2)', dot:'var(--ink-3)' };
  return '<span class="bdg" style="background:'+c.soft+';color:'+c.ink+';font-size:10.5px;padding:1px 7px"><span class="dot" style="background:'+c.dot+'"></span>'+name+'</span>';
}
function renderVersionCode(code) {
  var m = code.match(/^(.*?)-(VA\d+|V\d+)$/);
  if(!m) return '<span class="mono" style="color:var(--ink-2)">'+code+'</span>';
  return '<span class="mono" style="color:var(--ink-2)">'+m[1]+'</span><span class="mono" style="color:var(--brand);font-weight:700;margin-left:4px">'+m[2]+'</span>';
}
