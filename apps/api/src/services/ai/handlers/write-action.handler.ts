// ============================================================
// O4 Handler：write_action_request — 写动作只返回待确认动作，不自动执行
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";
import type { WorkbenchIntentHandler } from "./handler.types";

/**
 * 疑问词/指代词不是合法项目名：防止“我创建了什么项目”这类疑问句
 * 被误提取出“了什么”等垃圾名当作待确认创建动作。
 */
const INVALID_PROJECT_NAME_PATTERN = /什么|哪些|哪个|哪几个|几个|多少|吗|呢|^(一个|这个|那个|某种)$/;

function isValidProjectName(name: string | undefined): name is string {
  if (!name || name.length < 2 || name.length > 40) return false;
  return !INVALID_PROJECT_NAME_PATTERN.test(name);
}

/**
 * 写动作请求回复 — 只返回待确认动作，不自动执行
 */
function buildWriteActionResponse(intent: { confidence: number; routingRule: string }, context: WorkbenchContext, input: WorkbenchDispatchInput): WorkbenchDispatchData {
  // 检测项目创建意图：提取“创建/新建 + 项目名 + 项目”模式中的项目名
  const projectCreateMatch = input.message.match(/(?:创建|新建|设立)(?:一个)?(.+?)项目/);
  const rawProjectName = projectCreateMatch?.[1]?.trim();
  const projectName = isValidProjectName(rawProjectName) ? rawProjectName : undefined;

  if (projectName) {
    const answer = `检测到项目创建意图：「${projectName}」。为了安全，我不会自动创建正式记录。请确认以下动作后再执行：`;
    return {
      intent: "write_action_request",
      answer,
      businessRole: input.businessRole,
      roleLabel: input.roleLabel,
      model: "rule-static",
      suggestedActions: [
        {
          id: "create_project_evaluation",
          label: `确认创建项目「${projectName}」`,
          actionType: "create_project_evaluation",
          requiresConfirm: true,
          payload: { projectName },
        },
      ],
      trace: {
        intentConfidence: intent.confidence,
        routingRule: intent.routingRule,
        contextRefs: context.contextRefs,
      },
    };
  }

  const answer = "这是一个写动作请求。为了安全，我不会自动创建正式记录。请确认以下动作后再执行：";
  return {
    intent: "write_action_request",
    answer,
    businessRole: input.businessRole,
    roleLabel: input.roleLabel,
    model: "rule-static",
    suggestedActions: [
      {
        id: "confirm_write_action",
        label: "确认执行写动作",
        actionType: "confirm_write_action",
        requiresConfirm: true,
      },
    ],
    trace: {
      intentConfidence: intent.confidence,
      routingRule: intent.routingRule,
      contextRefs: context.contextRefs,
    },
  };
}

export const writeActionHandler: WorkbenchIntentHandler = {
  intents: ["write_action_request"],
  handle: ({ intent, context, input }) => buildWriteActionResponse(intent, context, input),
};
