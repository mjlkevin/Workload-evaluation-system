// ============================================================
// WES Agent Phase 1G — AI 工作台意图分发器
// O4 重构后：本文件只保留公开契约类型 + 意图路由/兜底分类 + handler 分发。
// 各类意图的响应构建已搬迁至 ./handlers/*.handler.ts（纯结构搬迁，行为零变更）。
// ============================================================

import type { AuthUser, BusinessRole } from "../../types";
import type { ToolCall } from "../../ai/provider/model-provider";
import type { WorkbenchToolEffectRecorder } from "./workbench-tool-loop";
import type { WorkbenchToolApprovalGate } from "./workbench-tool-approval";
import type { WorkbenchToolInputGate } from "./workbench-tool-user-input";
import type { AgentEvent } from "../../agent/agent.types";
import type { ZhipuKnowledgeToolTrace } from "./knowledge-tool.service";
import { routeWorkbenchIntent, classifyIntentWithModel, type WorkbenchIntent, type ModelClassificationResult } from "./workbench-intent.service";
import { buildWorkbenchContext, type WorkbenchAttachmentContext, type WorkbenchHarnessArtifactContext } from "./workbench-context.service";
import type { InteractiveFormBlock } from "./handlers/form-block";
import type { WorkbenchIntentHandler } from "./handlers/handler.types";
import { capabilityHandler } from "./handlers/capability.handler";
import { harnessReportHandler } from "./handlers/harness-report.handler";
import { attachmentQaHandler } from "./handlers/attachment-qa.handler";
import { domainQaHandler, unsupportedHandler } from "./handlers/domain-qa.handler";

// 向后兼容：formBlock 协议类型与归一化函数原由本文件导出
export { normalizeInteractiveFormBlock } from "./handlers/form-block";
export type { InteractiveFormBlock, InteractiveFormField, InteractiveFormFieldType } from "./handlers/form-block";

export type WorkbenchSuggestedAction = {
  id: string;
  label: string;
  actionType:
    | "send_message"
    | "generate_requirement_report"
    | "submit_structured_answers"
    | "open_project_list"
    | "company_lookup"
    | "create_project_evaluation";
  requiresConfirm: boolean;
  disabled?: boolean;
  payload?: Record<string, unknown>;
};

export type WorkbenchLightweightModelRunTrace = {
  runKind: "attachment_summary" | "attachment_qa" | "knowledge_fallback";
  auditMode: "lightweight";
  createsHarnessRun: false;
  provider: string;
  model: string;
  contextRefs: string[];
  latencyMs: number;
  rawContentLength: number;
  attempts?: number;
  finishReason?: string;
};

/**
 * 工单 2026-08-11（memory-panel-chip-live-link）· MS3 chip 活数据链路：
 * dispatch trace additive 字段。仅新增、可选；缺数据时字段缺省，
 * 既有字段语义与事件契约零变更，前端缺数据时保持 MS3 静默降级。
 */
export type WorkbenchToolCallTrace = {
  name: string;
  source?: string;
};

export type WorkbenchMemoryRefTrace = {
  scenesCount: number;
  atomsCount: number;
};

export type WorkbenchDispatchData = {
  intent: WorkbenchIntent;
  answer: string;
  businessRole: BusinessRole;
  roleLabel: string;
  model?: string;
  rawContent?: string;
  formBlock?: InteractiveFormBlock;
  session?: unknown;
  suggestedActions: WorkbenchSuggestedAction[];
  trace: {
    intentConfidence: number;
    routingRule: string;
    contextRefs: string[];
    knowledgeTool?: ZhipuKnowledgeToolTrace;
    modelRun?: WorkbenchLightweightModelRunTrace;
    modelClassification?: ModelClassificationResult;
    /** additive：工具发现/执行结果（MS3 工具调用 chip 数据源） */
    toolCalls?: WorkbenchToolCallTrace[];
    /** additive：本轮注入的 active 记忆计数（MS2-PATCH 引用记忆 chip 数据源） */
    memoryRef?: WorkbenchMemoryRefTrace;
  };
};

export type WorkbenchDispatchInput = {
  /** 受信任的入站请求 ID，贯穿检索、生成与 trace */
  requestId?: string;
  user: AuthUser;
  workflowKey: string;
  message: string;
  attachment?: WorkbenchAttachmentContext | null;
  latestHarnessArtifact?: WorkbenchHarnessArtifactContext | null;
  clientAction?: string;
  /**
   * 批次 1c · 缺陷二（additive）：本会话是否处在一场还没结束的工具交互里。
   * 三条对话通道各自从**已落库的会话记录**推导后注入（见 hasOngoingWorkbenchToolInteraction），
   * 端点层不从请求体接收同名字段——判据必须是服务端查得出的事实。
   * 缺省（未注入）即按「不在进行中」处理，路由行为与本批之前逐字相同。
   */
  hasOngoingToolInteraction?: boolean;
  /** 由调用方提供的模型回复函数；toolCalls/memoryRef/knowledgeTool 为 additive 返回字段（chip 与来源痕迹数据通路，缺省即无） */
  modelChat: (params: { systemPrompt: string; userContent: string }) => Promise<{ answer: string; rawContent: string; provider?: string; model?: string; attempts?: number; finishReason?: string; toolCalls?: WorkbenchToolCallTrace[]; memoryRef?: WorkbenchMemoryRefTrace; knowledgeTool?: ZhipuKnowledgeToolTrace }>;
  /** 由调用方提供的角色标签 */
  businessRole: BusinessRole;
  roleLabel: string;
  model: string;
  /** 角色预设提示词（可选，用于注入到 system prompt） */
  rolePrompt?: string;
  // 批次 4：随 knowledgeQueryHandler 一并移除 `knowledgeQuery` / `knowledgeBaseCatalog`
  // 两个注入位——正则退役后 dispatch 内没有任何代码再读它们；知识库查询的唯一入口是
  // ToolRegistry 的 knowledge_query 工具（其测试替身见 agent/tools/query.tools.test.ts）。
  /** RP-029 返工：可选流式 adapter，提供后模型调用路径改为流式输出 */
  streamingAdapter?: StreamingAdapter;
  /** RP-029 返工：可选流式模型调用函数 */
  modelChatStream?: (params: { systemPrompt: string; userContent: string }) => AsyncIterable<StreamingChunk>;
  /** RP-047 Batch B：可选服务端取消信号；中止后在安全边界拒绝，取消后零副作用 */
  abortSignal?: AbortSignal;
  /**
   * 批次 0 · ④：工具调用幂等接缝（additive）。仅异步 Run 通道注入——
   * 由 workbench-chat.workflow 用 ctx.recordToolEffectOnce 实现，
   * 使每次工具调用落 `runId:stepKey:workbench_chat_tool_call:N` 独立 effectKey；
   * 同步直写路径不经 Harness 步骤提交点，无重放语义，不注入即为 undefined。
   */
  recordToolEffect?: WorkbenchToolEffectRecorder;
  /**
   * 批次 0.5 · ②：工具事件 UI 投影接缝（additive）。仅异步 Run 通道注入——
   * 由 workbench-chat.workflow 用 createWorkbenchToolEventSink 实现，把工具循环
   * 发出的 tool_call / tool_result 落 harness_run_events 的 tool.call.* 四类。
   * 本接缝只有消费者、不参与模型上下文构造：它是「UI 可见」侧，
   * 与「模型可见」侧的边界见 ④（workbench-tool-event-surface）。
   */
  onToolEvent?: (event: AgentEvent) => void;
  /**
   * 批次 1a · ask 档审批闸门（additive）。仅异步 Run 通道注入——由
   * workbench-chat.workflow 用 run 事件流 + run.status=waiting 实现，使「等待确认」
   * 成为可持久事实（worker 重启后仍然有效，判据④）。它只回答服务端已持久化的决策，
   * **不接受模型或前端的批准表达**；未注入即拒绝执行写工具（失败方向关闭）。
   */
  toolApprovalGate?: WorkbenchToolApprovalGate;
  /**
   * 批次 9 · ask_user 交互闸门（additive）。同样仅异步 Run 通道注入。
   * 与 toolApprovalGate 的分工是概念性的、不是实现取巧：审批闸门在**执行前**暂停
   * （该不该让它做），本闸门是**执行本身即暂停**（它的作用就是等一个回答）。
   * 两者共用 run.status=waiting 底层，恢复路径不同（confirmRunAction / submitRunInput），
   * 因此是两个端口、两类事件，不得合并成一个。
   * 未注入即不挂起：同步兜底通道没有可挂的 Run，表单不渲染、明确失败回给模型。
   */
  toolInputGate?: WorkbenchToolInputGate;
};

/** RP-047 Batch B：dispatch 取消错误，供调用方区分取消与真实模型故障。 */
export class WorkbenchDispatchCancelledError extends Error {
  constructor(message?: string) {
    super(message ?? "workbench dispatch cancelled");
    this.name = "WorkbenchDispatchCancelledError";
  }
}

function raceWithDispatchAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new WorkbenchDispatchCancelledError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new WorkbenchDispatchCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

async function* streamWithDispatchAbort(
  stream: AsyncIterable<StreamingChunk>,
  signal: AbortSignal,
): AsyncGenerator<StreamingChunk> {
  for await (const chunk of stream) {
    // 取消安全边界：中止后不再向 adapter 投递任何 chunk
    if (signal.aborted) throw new WorkbenchDispatchCancelledError();
    yield chunk;
  }
}

/** RP-029 返工：流式 chunk */
export type StreamingChunk = {
  contentDelta: string;
  reasoningContentDelta?: string;
  model?: string;
  finishReason?: string;
  /**
   * DEF-2026-08-27-001：chunk 类型显式判别字段。
   * 缺省（undefined）等同 "delta"——正文增量，既有消费端行为不变；
   * "metadata" 表示本轮模型调用的元信息载荷（如 memoryRef），contentDelta
   * 恒为空串，消费端**必须**按本字段分支处理，不得靠「空 content」隐式判定。
   */
  kind?: "delta" | "metadata";
  /** kind === "metadata" 时携带：本轮注入的 active 记忆计数（引用记忆 chip 数据源） */
  memoryRef?: WorkbenchMemoryRefTrace;
  /**
   * 批次 0：本轮模型发起的工具调用（已按 index 拼装完毕的完整列表）。
   * 出现在携带 finishReason === "tool_calls" 的 delta chunk 上，以及工具循环
   * 补发的 kind === "metadata" chunk 上；无工具调用时缺省，既有消费端零回归。
   */
  toolCalls?: ToolCall[];
  /**
   * 批次 4（additive）：kind === "metadata" 时携带——本回合 `knowledge_query` 工具检索出的
   * 知识库痕迹。流式与异步 Run 通道不经过 modelChat 的捕获包装，痕迹只能随这条 chunk
   * 上送给消费端（model-answer），与 toolCalls 同一数据通路。缺数据时字段缺省，
   * 既有 chunk 形状逐字节不变。
   */
  knowledgeTool?: ZhipuKnowledgeToolTrace;
};

/** RP-029 返工：流式 adapter — 由调用方实现，dispatch 内部模型调用路径会回调此 adapter */
export type StreamingAdapter = {
  onToken: (chunk: StreamingChunk) => void;
  onComplete?: (fullContent: string) => void;
  onError?: (error: Error) => void;
};

// RP-049 Batch A: 分类兜底采纳白名单——仅采纳超范围拦截意图，
// 其余分类结果（capability/wes_data/write/knowledge 等）一律保持 domain_qa 模型自然回复
const ADOPTABLE_INTENTS = new Set<WorkbenchIntent>(["unsupported_or_out_of_scope"]);

// O4：意图 → handler 注册表。每个意图恰好命中一个 handler；
// 未命中时兜底 domainQaHandler（保持原 fallthrough 走模型问答的语义）。
// 批次 4 起本表只剩 5 个 handler：knowledgeQueryHandler / wesDataQueryHandler 随其正则
// 一并退役——「该用知识库还是该查我的项目」是自然语言判断，交回模型选工具
// （knowledge_query / project_list / estimate_history），详见 workbench-intent.service.ts 顶部。
const WORKBENCH_HANDLERS: WorkbenchIntentHandler[] = [
  capabilityHandler,
  harnessReportHandler,
  unsupportedHandler,
  attachmentQaHandler,
  domainQaHandler,
];

/**
 * 分发一次 AI 工作台用户输入。
 * 根据 intent 路由结果选择执行路径，返回统一的 WorkbenchDispatchData。
 */
export async function dispatchHomeWorkbenchTurn(input: WorkbenchDispatchInput): Promise<WorkbenchDispatchData> {
  // RP-047 Batch B：取消信号包装 — 预中止立即拒绝；模型调用（含分类兜底）
  // 统一经 race/流式边界检查，中止后不再投递 chunk、不再采纳迟到回复。
  const abortSignal = input.abortSignal;
  if (abortSignal?.aborted) throw new WorkbenchDispatchCancelledError();
  const effectiveInput: WorkbenchDispatchInput = abortSignal
    ? {
        ...input,
        modelChat: (params) => {
          if (abortSignal.aborted) return Promise.reject(new WorkbenchDispatchCancelledError());
          return raceWithDispatchAbort(input.modelChat(params), abortSignal);
        },
        ...(input.modelChatStream
          ? {
              modelChatStream: (params: { systemPrompt: string; userContent: string }) => {
                if (abortSignal.aborted) throw new WorkbenchDispatchCancelledError();
                return streamWithDispatchAbort(input.modelChatStream!(params), abortSignal);
              },
            }
          : {}),
      }
    : input;

  let intent = routeWorkbenchIntent({
    message: effectiveInput.message,
    hasAttachment: Boolean(effectiveInput.attachment),
    clientAction: effectiveInput.clientAction,
    // 批次 1c · 缺陷二：进行中判据由调用通道从会话记录推导，本函数不自行判读请求内容
    hasOngoingToolInteraction: effectiveInput.hasOngoingToolInteraction,
  });

  // RP-003: 规则兜底时调用模型二次分类
  // RP-049 Batch A: 只采纳超范围拦截意图且阈值提高到 0.85；分类结果无论是否采纳都写入 trace
  let modelClassification: ModelClassificationResult | undefined;
  if (intent.routingRule === "default_domain_qa") {
    const classification = await classifyIntentWithModel(effectiveInput.message, effectiveInput.modelChat);
    if (classification) {
      modelClassification = classification; // 始终记录到 trace，保证可观测
      if (
        ADOPTABLE_INTENTS.has(classification.intent as WorkbenchIntent) &&
        classification.confidence >= 0.85
      ) {
        intent = {
          intent: classification.intent as WorkbenchIntent,
          confidence: classification.confidence,
          routingRule: "model_classification_fallback",
        };
      }
    }
  }

  const context = await buildWorkbenchContext({
    user: effectiveInput.user,
    attachment: effectiveInput.attachment,
    latestHarnessArtifact: effectiveInput.latestHarnessArtifact,
  });

  const handler = WORKBENCH_HANDLERS.find((candidate) => candidate.intents.includes(intent.intent)) ?? domainQaHandler;

  // MS3 chip 活数据链路（additive）：包装 handler 阶段的 modelChat，
  // 捕获实现方返回的 toolCalls / memoryRef 并透传进 dispatch trace。
  // 无数据时字段缺省，既有 trace 字段语义零变更。
  const capturedToolCalls: WorkbenchToolCallTrace[] = [];
  const seenToolCalls = new Set<string>();
  let capturedMemoryRef: WorkbenchMemoryRefTrace | undefined;
  let capturedKnowledgeTool: ZhipuKnowledgeToolTrace | undefined;
  const capturingModelChat: WorkbenchDispatchInput["modelChat"] = async (params) => {
    const result = await effectiveInput.modelChat(params);
    if (result.knowledgeTool) capturedKnowledgeTool = result.knowledgeTool;
    if (Array.isArray(result.toolCalls)) {
      for (const call of result.toolCalls) {
        if (!call || typeof call.name !== "string" || !call.name) continue;
        const key = `${call.name}${typeof call.source === "string" && call.source ? `:${call.source}` : ""}`;
        if (seenToolCalls.has(key)) continue;
        seenToolCalls.add(key);
        capturedToolCalls.push({
          name: call.name,
          ...(typeof call.source === "string" && call.source ? { source: call.source } : {}),
        });
      }
    }
    const memoryRef = result.memoryRef;
    if (memoryRef && typeof memoryRef === "object") {
      capturedMemoryRef = {
        scenesCount: Number(memoryRef.scenesCount) || 0,
        atomsCount: Number(memoryRef.atomsCount) || 0,
      };
    }
    return result;
  };

  const data = await handler.handle({ intent, context, input: { ...effectiveInput, modelChat: capturingModelChat }, modelClassification });
  if (capturedToolCalls.length > 0) {
    data.trace.toolCalls = capturedToolCalls;
  }
  if (capturedMemoryRef) {
    data.trace.memoryRef = capturedMemoryRef;
  }
  // 批次 4：知识库痕迹的产生方从 handler 变成了工具，捕获点因此也在 modelChat 这一侧。
  // handler 若已自行给出痕迹（它比回合级捕获更精确），不被这里覆盖。
  if (capturedKnowledgeTool && !data.trace.knowledgeTool) {
    data.trace.knowledgeTool = capturedKnowledgeTool;
  }
  return data;
}
