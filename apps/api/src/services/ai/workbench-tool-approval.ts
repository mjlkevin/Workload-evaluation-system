// ============================================================
// 批次 1a · 写操作工具的执行前审批闸门（决策槽 + 服务端判定）
// ============================================================
// 批次 0 把写工具挡在循环外（「工作台仅开放只读工具」），因为当时没有确认闸门。
// 本批做出闸门并放开三个写工具。闸门的全部判定落在这个模块 + 它的两个端口上。
//
// 三条不可让步约束与本模块的对应关系：
//  (1) **要不要审批由服务端判定**：resolveWorkbenchToolDecisionSlot 只读注册表元信息，
//      入参没有任何一条来自模型或前端；失败方向一律关闭（查不到 / 抛错 / mutates 不是
//      严格 false → ask）。模型「声明本次无需确认」在本设计下**没有对应的代码路径**——
//      审批与否不看模型输出，只看注册表与持久决策。
//  (2) **审批请求不携带第二份工具参数**：pause 端口只收 actionId / callId / ordinal /
//      toolName。参数唯一来源是 tool.call.started 事件那一份。actionId 绑死
//      (runId, stepKey, ordinal, toolName, argsDigest)——摘要不是副本：它不可反解、
//      不参与执行，只用来在重放时判定「现在这一次调用是否正是用户看过并批准的那一次」，
//      因此它消除漂移而不是制造漂移。
//  (3) **不用阻塞回调**：本模块不 await 用户，而是经 pauseForApproval 端口把「等待」
//      写成持久事实（run.status=waiting + tool.call.awaiting_approval 事件）后抛
//      WorkbenchToolApprovalPendingError 让执行流就地停手；worker 重启后凭持久决策续跑。
//      严禁复用 apps/api/src/agent/orchestrator.ts:64 的 await confirm(...)——那是内存
//      Promise，进程一死就永远等不回来且不留任何记录。
//
// 决策槽（本批只做三档，modify / stop 属后续批次）：
//  · allow —— 服务端放行（只读工具走这档）
//  · ask   —— 服务端要求用户确认；未获决策即挂起
//  · skip  —— 用户拒绝，不执行，回填失败结果让模型继续作答
// ============================================================

import { createHash } from "node:crypto";
import type { AgentTool } from "../../agent/agent.types";

/**
 * callId 上限：callId 由模型给出（provider 生成的工具调用 id），且会落进
 * tool.call.started / tool.call.awaiting_approval / run_action_confirmed 三处持久 payload，
 * 并经 SSE 原样回放给界面。不封顶等于让模型用一条超长 id 撑大事件表。
 * 真实 id 只有几十字符，200 已是宽余量；**必须在唯一一处归一化**，
 * 三处 payload 才不会各截各的而对不上账。
 */
export const WORKBENCH_TOOL_CALL_ID_MAX_CHARS = 200;

/** 决策键里 toolName 的同一处理：注册表名本来就短，封顶只为防御。 */
export const WORKBENCH_TOOL_ACTION_ID_MAX_CHARS = 400;

/** 归一化模型给出的 callId：去空白 + 封顶（唯一入口，见上方常量说明）。 */
export function normalizeWorkbenchToolCallId(value: string | undefined): string {
  return (typeof value === "string" ? value.trim() : "").slice(0, WORKBENCH_TOOL_CALL_ID_MAX_CHARS);
}

/** 决策槽词汇：allow（放行）/ ask（待确认）/ skip（用户拒绝）；modify、stop 不在本批词汇内 */
export const WORKBENCH_TOOL_DECISION_SLOTS = ["allow", "ask", "skip"] as const;
export type WorkbenchToolDecisionSlot = (typeof WORKBENCH_TOOL_DECISION_SLOTS)[number];

/** 审批挂起信号：执行流就地停手，Run 停在 waiting 等用户，不当失败也不继续执行 */
export class WorkbenchToolApprovalPendingError extends Error {
  readonly runId: string;
  readonly actionId: string;
  readonly toolName: string;

  constructor(input: { runId: string; actionId: string; toolName: string }) {
    super(`写操作待用户确认：${input.toolName}（actionId=${input.actionId}）`);
    this.name = "WorkbenchToolApprovalPendingError";
    this.runId = input.runId;
    this.actionId = input.actionId;
    this.toolName = input.toolName;
  }
}

/** 持久决策词汇：approved 来自既有 run_action_confirmed，rejected 来自 tool.call.rejected */
export type WorkbenchToolApprovalDecision = "approved" | "rejected";

export type WorkbenchToolActionIdInput = {
  runId: string;
  stepKey: string;
  ordinal: number;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type WorkbenchToolApprovalPauseInput = {
  runId: string;
  attemptId: string;
  actionId: string;
  callId: string;
  ordinal: number;
  toolName: string;
};

export type WorkbenchToolApprovalPorts = {
  /** 读持久决策（DB 事件流）；抛错按「无决策」处理，绝不按「已批准」处理 */
  findDecision(input: { runId: string; actionId: string }): Promise<WorkbenchToolApprovalDecision | null>;
  /** 写持久「等待确认」事实（run.status=waiting + tool.call.awaiting_approval） */
  pauseForApproval(input: WorkbenchToolApprovalPauseInput): Promise<unknown>;
};

export type WorkbenchToolApprovalCall = {
  ordinal: number;
  toolName: string;
  callId: string;
  arguments: Record<string, unknown>;
};

export type WorkbenchToolApprovalGateResult =
  | { decision: "execute" }
  | { decision: "reject"; reason: string };

export type WorkbenchToolApprovalGate = (call: WorkbenchToolApprovalCall) => Promise<WorkbenchToolApprovalGateResult>;

export const WORKBENCH_TOOL_APPROVAL_REJECTED_MESSAGE = "用户拒绝了本次写操作，未执行任何变更";
export const WORKBENCH_TOOL_APPROVAL_UNWIRED_MESSAGE = "写操作需用户确认，但当前通道没有审批链路，未执行任何变更";

/**
 * (1) 服务端策略判定：只有注册表明确 mutates === false 才落到 allow。
 * 工具查不到、mutates 缺失/为 null/为非布尔——一律 ask。宁可多问一次，不可少问一次。
 */
export function resolveWorkbenchToolDecisionSlot(tool: AgentTool | undefined): WorkbenchToolDecisionSlot {
  if (!tool) return "ask";
  return tool.mutates === false ? "allow" : "ask";
}

/** 递归排序键的稳定序列化：同一参数的不同键序必须得到同一摘要，否则重放会误判为新调用 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** 参数摘要（非副本）：用于判定「重放时的这次调用是否仍是用户批准的那次」 */
export function computeWorkbenchToolArgsDigest(args: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = stableStringify(args ?? {});
  } catch {
    serialized = "[unserializable]";
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
}

/**
 * (2) 决策键：绑死 run / 步骤 / 第 N 次调用 / 工具名 / 参数摘要。
 * 换工具或换参数即得不同键 → 旧批准对新调用天然无效（模型无法借重放套用旧批准）。
 * 键里不含参数明文，只含摘要。
 */
export function buildWorkbenchToolActionId(input: WorkbenchToolActionIdInput): string {
  const actionId = [
    input.runId,
    input.stepKey,
    "workbench_chat_tool_approval",
    String(input.ordinal),
    input.toolName,
    computeWorkbenchToolArgsDigest(input.arguments),
  ].join(":");
  // 决策键也走事件 payload（审批请求与确认/拒绝事件都带它），故同样封顶
  return actionId.slice(0, WORKBENCH_TOOL_ACTION_ID_MAX_CHARS);
}

/**
 * (3) 闸门：查持久决策 → 有则照办，无则挂起后停手。
 * 注意本函数**不接受任何来自模型的批准表达**——批准只可能来自 findDecision
 * （其唯一实现读 harness_run_events 的 run_action_confirmed，confirmedBy 是 JWT 用户）。
 */
export function createWorkbenchToolApprovalGate(
  scope: { runId: string; attemptId: string; stepKey: string },
  ports: WorkbenchToolApprovalPorts,
): WorkbenchToolApprovalGate {
  return async (call: WorkbenchToolApprovalCall): Promise<WorkbenchToolApprovalGateResult> => {
    const actionId = buildWorkbenchToolActionId({
      runId: scope.runId,
      stepKey: scope.stepKey,
      ordinal: call.ordinal,
      toolName: call.toolName,
      arguments: call.arguments,
    });

    let decision: WorkbenchToolApprovalDecision | null = null;
    try {
      decision = await ports.findDecision({ runId: scope.runId, actionId });
    } catch {
      // 失败方向关闭：查不到决策即视为未获批准
      decision = null;
    }

    if (decision === "rejected") {
      return { decision: "reject", reason: WORKBENCH_TOOL_APPROVAL_REJECTED_MESSAGE };
    }
    if (decision === "approved") {
      return { decision: "execute" };
    }

    // 无决策：把「等待」写成持久事实后停手。写入失败同样不放行（异常直接上抛）。
    // callId 在此再归一化一次（幂等）：工具循环已经归一化，但闸门是**落库的唯一出口**，
    // 不能依赖调用方自觉——少一层就等于把入站上限交给别人守。
    await ports.pauseForApproval({
      runId: scope.runId,
      attemptId: scope.attemptId,
      actionId,
      callId: normalizeWorkbenchToolCallId(call.callId),
      ordinal: call.ordinal,
      toolName: call.toolName,
    });
    throw new WorkbenchToolApprovalPendingError({ runId: scope.runId, actionId, toolName: call.toolName });
  };
}
