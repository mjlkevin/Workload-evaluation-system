// ============================================================
// O4 Handler：capability_discovery — 能力发现静态回复
// 文案为 CAPABILITY 模板（Batch B 范围），本次纯搬迁不改动。
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";

/**
 * 能力发现回复
 */
function buildCapabilityResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  const capabilities = [
    "上传需求文件（Excel/Word/PDF），自动解析业务需求、模块线索和客户信息。",
    "对上传的附件内容进行问答，例如询问多组织业务往来包含哪些模块。",
    "明确要求时，生成《需求解析报告 v1》，识别需求、风险和待确认问题。",
    "在 v1 报告基础上，通过结构化卡片提交补充信息并生成《需求解析报告 v2》。",
    "查询你之前创建过的项目和评估记录（仅限你有权限的数据）。",
    "回答 WES/ERP/金蝶业务咨询，例如模块依赖、评估口径、风险含义等。",
    "对于写动作（创建草稿、进入正式评估），给出待确认动作，确认后才会执行。",
  ];
  const answer = [
    "我是 WES AI 工作台，当前角色：" + context.user.username + "（" + context.user.role + "）。",
    "",
    "我可以帮你完成以下工作：",
    ...capabilities.map((item, index) => `${index + 1}. ${item}`),
    "",
    "上传附件时，附件仅作为上下文；除非你明确要求生成报告，我不会自动进入报告生成流程。",
  ].join("\n");

  return {
    intent: "capability_discovery",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      { id: "upload_file", label: "上传需求文件", actionType: "send_message", requiresConfirm: false },
      { id: "query_projects", label: "查看我的项目", actionType: "open_project_list", requiresConfirm: false },
      { id: "lookup_customer", label: "检索客户主体", actionType: "company_lookup", requiresConfirm: false },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

export const capabilityHandler: WorkbenchIntentHandler = {
  intents: ["capability_discovery"],
  handle({ intent, context, input, modelClassification }) {
    const resp = buildCapabilityResponse(intent, context, input);
    if (modelClassification) resp.trace.modelClassification = modelClassification;
    return resp;
  },
};
