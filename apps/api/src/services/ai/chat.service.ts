// ============================================================
// WES AI 对话服务 — 入口路由层（O4 重构后）
// 本文件只保留对外导出契约（barrel）：路由 handler 与测试依赖的公共函数。
// 实现已按职责搬迁至 ./handlers/ 下的 handler 模块（纯结构搬迁，行为零变更）：
// - basic-chat.handler.ts         chat 基础对话
// - company-profile.handler.ts    企业画像摘要
// - workbench-chat.handler.ts     AI 工作台对话（非流式，含显式报告闸门）
// - workbench-chat-stream.handler.ts AI 工作台流式对话（SSE）
// - report-analysis.ts            需求解析报告构建与附件分析
// - workbench-shared.ts           会话/消息/附件/模型共享 helper
// ============================================================

export { chat } from "./handlers/basic-chat.handler";
export { companyProfileSummary } from "./handlers/company-profile.handler";
export { homeWorkbenchChat } from "./handlers/workbench-chat.handler";
export { homeWorkbenchChatStream } from "./handlers/workbench-chat-stream.handler";
export {
  buildMergedRequirementAnalysisReport,
  buildRequirementAnalysisReport,
} from "./handlers/report-analysis";
export {
  allParsedHomeAttachments,
  isExplicitReportRequest,
  resolveWorkbenchStreamFinalContent,
} from "./handlers/workbench-shared";
export type { HomeAttachmentInput, HomeMessageInput } from "./handlers/workbench-shared";
