/**
 * @file ViewModel type definitions (JSDoc)
 *
 * This module provides centralised @typedef declarations for every
 * major domain object consumed by the V2_PROTOTYPE UI.
 *
 * They are used purely for IntelliSense / type-hinting in plain-JS
 * JSX files.  Import the file in any module that needs completion:
 *
 *   import '../viewModels/types.js'   // side-effect typedefs only
 *
 * Or reference types via JSDoc:
 *
 *   /** @type {import('../viewModels/types').PlanVM} *\
 *   const plan = { ... }
 */

// ------------------------------------------------------------------
// 1. PlanVM  — 主页方案卡片（HomePage · PLANS）
// ------------------------------------------------------------------

/**
 * @typedef {Object} PlanVM
 * @property {number|string} id          — 方案唯一标识
 * @property {string} projectName        — 项目名称
 * @property {string} globalVersion      — 总方案版本号（如 GL-04001）
 * @property {string} status             — 状态：进行中 / 待评审 / 已发布 …
 * @property {boolean} checkedOut        — 当前用户是否已检出
 * @property {number} mandays            — 评估人天
 */

// ------------------------------------------------------------------
// 2. AssessmentListVM  — 实施评估列表行（listData · assessments）
// ------------------------------------------------------------------

/**
 * @typedef {Object} AssessmentListVM
 * @property {number} id
 * @property {string} projectName        — 项目名称
 * @property {string} productLine        — 产品线（如「金蝶AI星空」）
 * @property {string} globalVersion      — 总方案版本
 * @property {string} assessmentVersion  — 评估版本号（如 IA-04003）
 * @property {string} quoteMode          — 报价模式：标准实施 / 快速交付 / 定制开发
 * @property {number} totalDays          — 总人天（含小数）
 * @property {number} orgCount           — 组织数
 * @property {number} difficultyFactor   — 难度系数
 * @property {string} status             — VCS 状态：已检出 / 已检入 / 进行中 / 待评审 / 已归档
 * @property {string} owner              — 负责人
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 3. RequirementListVM  — 需求列表行（listData · requirements）
// ------------------------------------------------------------------

/**
 * @typedef {Object} RequirementListVM
 * @property {string} id                 — 需求编码（如 RQ-GLOBAL-20260404-0053）
 * @property {string} globalVersion      — 关联总方案版本
 * @property {string} versionCode        — 需求版本号（含 -V01 后缀）
 * @property {string} projectName        — 项目名称
 * @property {string} productLine        — 产品线
 * @property {string} customer           — 客户名称
 * @property {string} status             — 状态：进行中 / 已发布 / 评审中 …
 * @property {string} creator            — 创建人
 * @property {string} updater            — 最后更新人
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 4. DevAssessmentListVM  — 开发评估列表行（listData · devAssessments）
// ------------------------------------------------------------------

/**
 * @typedef {Object} DevAssessmentListVM
 * @property {number} id
 * @property {string} projectName        — 项目名称
 * @property {string} globalVersion      — 总方案版本
 * @property {string} devVersion         — 开发评估版本（如 DV-04001）
 * @property {string} assessor           — 评估人
 * @property {number} totalDays          — 评估人天
 * @property {string} status             — 状态：已检入 / 进行中 …
 * @property {string} owner              — 负责人
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 5. ResourceCostListVM  — 资源成本列表行（listData · resourceCosts）
// ------------------------------------------------------------------

/**
 * @typedef {Object} ResourceCostListVM
 * @property {number} id
 * @property {string} projectName        — 项目名称
 * @property {string} globalVersion      — 总方案版本
 * @property {string} resourceVersion    — 资源成本版本（如 RS-04001）
 * @property {string} quoteMode          — 报价模式
 * @property {number} totalDays          — 总人天
 * @property {number} orgCount           — 组织数
 * @property {string} status             — VCS 状态
 * @property {string} owner              — 负责人
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 6. HistoryProjectVM  — 历史项目库行（listData · historyItems）
// ------------------------------------------------------------------

/**
 * @typedef {Object} HistoryProjectVM
 * @property {number} id
 * @property {string} projectName        — 项目名称
 * @property {string} customer           — 客户名称
 * @property {string} industry           — 行业分类（如「制造-离散」）
 * @property {string} scale              — 企业规模（如「2400 人」）
 * @property {string} version            — 历史版本号（如 v01）
 * @property {number} similarity         — 相似度评分（0-100）
 * @property {number} totalDays          — 总人天
 * @property {number} totalAmount        — 总金额（万元）
 * @property {number} year               — 归档年份
 * @property {string} status             — 状态：已归档 …
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 7. ReviewListVM  — 评审列表行（listData · reviews）
// ------------------------------------------------------------------

/**
 * @typedef {Object} ReviewListVM
 * @property {string} id                 — 评审单号（如 REV-001）
 * @property {string} projectName        — 项目名称
 * @property {string} version            — 关联方案版本（如 v07）
 * @property {string} reviewers          — 评审人（逗号分隔）
 * @property {string} deadline           — 截止日期（YYYY-MM-DD）
 * @property {string} status             — 状态：待评审 / 已通过 / 驳回
 * @property {string} updatedAt          — 更新日期（YYYY-MM-DD）
 */

// ------------------------------------------------------------------
// 8. UserVM  — 用户管理行（UserManagement · INITIAL_USERS）
// ------------------------------------------------------------------

/**
 * @typedef {Object} UserVM
 * @property {string} id                 — 用户唯一 ID（如 u1）
 * @property {string} username           — 登录名
 * @property {string} role               — 角色：admin / sub_admin / user
 * @property {string} status             — 状态：active / disabled
 * @property {string | null} lastLoginAt — 最后登录时间（ISO 8601 或 null）
 * @property {boolean} locked            — 系统锁定（不可选中）
 */

// Export an empty object so the file is a valid ES module.
// Consumers import for side-effect typedefs only.
export default {}
