// ============================================================
// 批次 9 · ask_user：把「向用户发起交互」注册成一个可调用的工具
// ============================================================
// 它取代的是「模型在自由文本里自己想起写一段 formBlock JSON」这条产生方式
// （遗留路径见 handlers/form-block.ts 的标记），控件本身、契约、暂停恢复通道全部复用。
//
// 三条注册口径均为架构侧裁决（雷达文档 §9.8.2 / §9.8.3）：
//  · mutates: false —— 问一个问题不危险，再加一道确认是多余摩擦，故落 allow 档；
//  · capability 用只读档 estimates:read —— 凡能用工作台的人都该能被提问；
//  · parameters 直接引用 INTERACTIVE_FORM_BLOCK_CONTRACT.schema 这一个事实源，
//    不另写第二份表单 schema，字段类型也不扩（扩类型是前端活，与本批要害无关）。
//
// execute 在带闸门的异步 Run 通道里**永远不会被调用**（闸门在执行前就地停手）。
// 它存在只为兜住没有闸门的那条路：同步兜底通道没有可挂起的 Run，
// 此时必须明确失败，而不是静默渲染半个控件或假装问过了。
// ============================================================

import { INTERACTIVE_FORM_BLOCK_CONTRACT } from "../../ai/contracts";
import type { AgentTool } from "../agent.types";
import { ASK_USER_TOOL_NAME, WORKBENCH_TOOL_INPUT_UNWIRED_MESSAGE } from "../../services/ai/workbench-tool-user-input";

export function buildAskUserTool(): AgentTool {
  return {
    name: ASK_USER_TOOL_NAME,
    description:
      "需要用户确认、补充信息或在给定选项中做选择时，发起一个工作台内嵌交互表单让用户填选后提交。" +
      "参数即表单结构：blockId/title/submitLabel/fields 必填，fields 为 1-8 个字段，" +
      "type 仅允许 text、textarea、single_select、boolean、number，single_select 必须给 options（label+value）。" +
      "可选 submitMessageTemplate 用 {{字段id}} 占位符决定用户提交后在对话里显示的那句话。" +
      "调用本工具即暂停等待用户回答，不要同时在正文里重复粘贴表单 JSON。",
    // 契约即参数：同一份 schema 既给模型看（provider 结构化下发），又给服务端用（ajv 校验）
    parameters: INTERACTIVE_FORM_BLOCK_CONTRACT.schema,
    capability: "estimates:read",
    mutates: false,
    category: "interaction",
    discoverable: true,
    async execute(): Promise<unknown> {
      throw new Error(`${ASK_USER_TOOL_NAME}: ${WORKBENCH_TOOL_INPUT_UNWIRED_MESSAGE}`);
    },
  };
}
