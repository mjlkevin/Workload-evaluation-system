// ============================================================
// 批次 9 · ask_user：把「向用户发起交互」做成工具
// ============================================================
// 本批不新建机制，只把四个现成零件接起来：既有严格契约 + 既有交互表单控件 +
// 既有 run.status=waiting + 既有 POST /:runId/inputs。要害是三处判定都收敛在本模块：
//
//  (1) **参数即表单结构，且只有契约一个来源**：validateAskUserFormArguments 直接把
//      INTERACTIVE_FORM_BLOCK_CONTRACT 交给 ajv 跑，不另写一份 schema、不扩字段类型。
//      改前的问题不在控件而在产生方式——模型要在自由文本里自己想起写整段 JSON 且
//      格式全对（会话 7f5cbf75 实证：抽取失败即把 JSON 当正文渲染给用户，且模型把
//      字段键猜成 name 而契约要 id）。走工具后参数由 provider 结构化下发、服务端校验。
//  (2) **校验不通过绝不禁半个控件**：不合契约即返回可读错误给模型自行纠正，
//      连 awaiting_input 事件都不写——没有合法表单结构就没有可渲染的控件，
//      挂起一个渲染不出来的状态只会把 Run 卡死在 waiting。
//  (3) **执行本身即暂停**：与批次 1a 的「执行前暂停」共用 waiting 底层但恢复路径不同
//      （确认走 confirmRunAction，填表走 submitRunInput），故独立成
//      tool.call.awaiting_input 一类，不复用审批事件。等待同样写成持久事实
//      （run.status=waiting + 事件），抛 WorkbenchToolAwaitingInputError 让执行流
//      就地停手——刻意不复用 orchestrator.ts 的内存 Promise（进程一死即永等）。
//
// 答案的唯一来源是 run_inputs_submitted 事件里那份持久事实：模型与前端都无从
// 表达「用户已经答过了」，与批次 1a 的「服务端判定」同一条不可让步约束。
// ============================================================

import {
  INTERACTIVE_FORM_BLOCK_CONTRACT,
  validateStructuredValue,
  type StructuredOutputValidationIssue,
} from "../../ai/contracts";
import type { InteractiveFormBlock } from "./handlers/form-block";
import {
  WORKBENCH_TOOL_ACTION_ID_MAX_CHARS,
  computeWorkbenchToolArgsDigest,
  normalizeWorkbenchToolCallId,
} from "./workbench-tool-approval";

/** 工具名：闸门与注册表共用这一个字面量，不各处重列 */
export const ASK_USER_TOOL_NAME = "ask_user";

/** 挂起时回给模型的最终产出：字段值原样（键由模型自己在表单里定义） */
export const ASK_USER_ANSWERED_STATUS = "answered_by_user";

/**
 * 错误里最多列几条契约问题：ajv allErrors 在一次跑偏的输出上能给出几十条，
 * 全文回灌等于用错误信息撑爆模型上下文。取 8 条覆盖「一次改错一个字段」的常态。
 */
export const MAX_CONTRACT_ISSUE_LINES = 8;

/** 契约问题 → 模型可读的纠正指令（路径 + 原因），与 buildRepairInstruction 同形制 */
export function formatWorkbenchContractIssues(issues: StructuredOutputValidationIssue[]): string {
  const lines = issues
    .slice(0, MAX_CONTRACT_ISSUE_LINES)
    .map((issue) => `- ${issue.path || "/"}: ${issue.message}${offenderSuffix(issue)}（${issue.keyword}）`)
    .join("\n");
  const omitted = issues.length > MAX_CONTRACT_ISSUE_LINES
    ? `\n（另有 ${issues.length - MAX_CONTRACT_ISSUE_LINES} 处问题未列出）`
    : "";
  return `${ASK_USER_TOOL_NAME} 的参数未通过契约 ${INTERACTIVE_FORM_BLOCK_CONTRACT.id}@${INTERACTIVE_FORM_BLOCK_CONTRACT.version}，表单未渲染：\n${lines}${omitted}`;
}

/**
 * 「多传了一个字段」这类错误，ajv 只说 must NOT have additional properties，
 * 字段名藏在 params.additionalProperty 里。不抄出来，模型拿到的就是一条
 * 不知道该改哪儿的错误——而它下一步只会再猜一次。
 */
function offenderSuffix(issue: StructuredOutputValidationIssue): string {
  const offender = issue.params?.additionalProperty ?? issue.params?.missingProperty;
  return typeof offender === "string" && offender ? `（字段「${offender}」）` : "";
}

export type AskUserFormArguments =
  | { ok: true; formBlock: InteractiveFormBlock }
  | { ok: false; error: string };

/**
 * 判定 (1)(2)：用既有契约校验模型给的工具参数。
 * 校验器就是结构化输出链路那一个（ajv + semanticValidate 两段），不复用即重写。
 */
export function validateAskUserFormArguments(args: Record<string, unknown>): AskUserFormArguments {
  const result = validateStructuredValue(INTERACTIVE_FORM_BLOCK_CONTRACT, args ?? {});
  if (!result.valid) return { ok: false, error: formatWorkbenchContractIssues(result.issues) };
  return { ok: true, formBlock: result.data as unknown as InteractiveFormBlock };
}

/** 等待用户填表信号：执行流就地停手，Run 停在 waiting 等回答，不当失败也不继续 */
export class WorkbenchToolAwaitingInputError extends Error {
  readonly runId: string;
  readonly actionId: string;
  readonly toolName: string;

  constructor(input: { runId: string; actionId: string; toolName: string }) {
    super(`等待用户填写交互表单：${input.toolName}（actionId=${input.actionId}）`);
    this.name = "WorkbenchToolAwaitingInputError";
    this.runId = input.runId;
    this.actionId = input.actionId;
    this.toolName = input.toolName;
  }
}

export type WorkbenchToolActionIdInput = {
  runId: string;
  stepKey: string;
  ordinal: number;
  toolName: string;
  arguments: Record<string, unknown>;
};

/**
 * 答案键：与审批的 actionId 同一套构造法（run / 步骤 / 第 N 次调用 / 工具名 / 参数摘要），
 * 但 purpose 段刻意不同——两个闸门共用键会让「批了写操作」被误读成「答了表单」。
 * 换表单结构即得不同键：模型重放时改了题目，旧答案天然无效，会被重新问一次。
 */
export function buildWorkbenchToolInputActionId(input: WorkbenchToolActionIdInput): string {
  const actionId = [
    input.runId,
    input.stepKey,
    "workbench_chat_ask_user",
    String(input.ordinal),
    input.toolName,
    computeWorkbenchToolArgsDigest(input.arguments),
  ].join(":");
  return actionId.slice(0, WORKBENCH_TOOL_ACTION_ID_MAX_CHARS);
}

export type WorkbenchToolInputPauseInput = {
  runId: string;
  attemptId: string;
  actionId: string;
  callId: string;
  ordinal: number;
  toolName: string;
  /** 整份表单结构：控件渲染的唯一来源，随事件持久化以便刷新后重建 */
  formBlock: InteractiveFormBlock;
};

export type WorkbenchToolAnswer = {
  /** 用户提交的字段值（键即表单里的 field.id） */
  values: Record<string, unknown>;
};

export type WorkbenchToolInputPorts = {
  /** 读持久答案（run_inputs_submitted）；抛错按「未答」处理，绝不按「已答」放行 */
  findAnswer(input: { runId: string; actionId: string }): Promise<WorkbenchToolAnswer | null>;
  /** 写持久「等待填表」事实（run.status=waiting + tool.call.awaiting_input） */
  pauseForInput(input: WorkbenchToolInputPauseInput): Promise<unknown>;
};

export type WorkbenchToolInputCall = {
  ordinal: number;
  toolName: string;
  callId: string;
  arguments: Record<string, unknown>;
};

/** 闸门只在「本轮就能定案」时返回：已答 → 工具结果；参数不合契约 → 可读失败。
 *  未答即抛 WorkbenchToolAwaitingInputError，不在此返回任何值。 */
export type WorkbenchToolInputGateResult =
  | { outcome: "answered"; data: unknown }
  | { outcome: "invalid"; error: string };

export type WorkbenchToolInputGate = (call: WorkbenchToolInputCall) => Promise<WorkbenchToolInputGateResult>;

export const WORKBENCH_TOOL_INPUT_UNWIRED_MESSAGE =
  "当前通道无法向用户发起交互（没有可挂起的后台任务），表单未渲染";

/**
 * 判定 (3)：闸门。先校验、再查持久答案、都没有才挂起并停手。
 * 顺序不可调换：先挂起再校验会造出一个渲染不出来的 waiting 状态。
 */
export function createWorkbenchToolInputGate(
  scope: { runId: string; attemptId: string; stepKey: string },
  ports: WorkbenchToolInputPorts,
): WorkbenchToolInputGate {
  return async (call: WorkbenchToolInputCall): Promise<WorkbenchToolInputGateResult> => {
    const validated = validateAskUserFormArguments(call.arguments);
    if (!validated.ok) return { outcome: "invalid", error: validated.error };

    const actionId = buildWorkbenchToolInputActionId({
      runId: scope.runId,
      stepKey: scope.stepKey,
      ordinal: call.ordinal,
      toolName: call.toolName,
      arguments: call.arguments,
    });

    let answer: WorkbenchToolAnswer | null = null;
    try {
      answer = await ports.findAnswer({ runId: scope.runId, actionId });
    } catch {
      // 失败方向关闭：查不到答案即视为未答，重新挂起问一次
      answer = null;
    }

    if (answer) {
      return {
        outcome: "answered",
        data: { status: ASK_USER_ANSWERED_STATUS, actionId, values: answer.values },
      };
    }

    // 无答案：把「等待」写成持久事实后停手。写入失败同样不放行（异常直接上抛）。
    await ports.pauseForInput({
      runId: scope.runId,
      attemptId: scope.attemptId,
      actionId,
      callId: normalizeWorkbenchToolCallId(call.callId),
      ordinal: call.ordinal,
      toolName: call.toolName,
      formBlock: validated.formBlock,
    });
    throw new WorkbenchToolAwaitingInputError({
      runId: scope.runId,
      actionId,
      toolName: call.toolName,
    });
  };
}
