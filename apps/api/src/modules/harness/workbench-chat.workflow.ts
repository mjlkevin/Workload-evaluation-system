// ============================================================
// Workflow 适配器：workbench_chat_v1@1.0.0（RP-047 Batch E · Step 1）
// ============================================================
// 复用 workbench-dispatch.service.ts 意图分发链路，
// 经 HarnessWorker recordToolEffectOnce 实现幂等，
// assistant 消息经 appendSessionMessage 直接幂等落库（S2b-2 补偿链已删；
// S7 起返回结构不再包含 outbox 键）。
//
// Batch E 二次返工（新通道消息落库双缺陷修复，ISS-2026-08-09-002）：
// C1 缺陷 A：assistant 直写内容与 answer 一致（不落空消息）；
// C2 缺陷 B：用户消息在 dispatch 前经 ai-sessions 幂等 API 落库，
//   来源键 ${runId}:user:1 防恢复重放重复；503 回退同步路径不经
//   本 workflow，零双写。
// S2a（阶段 2 · §4.8）：assistant 消息改为同款直接幂等落库（同库直写）；
// S2b-2（2026-08-28）：projector/sink/outbox 表随 §4.8 补偿链删除，
//   恢复重放由 repository 层来源键查重吸收；S7（2026-08-31）连带删除
//   已无生产者与消费者的 `outbox` 返回字段（旧注释里的「outbox 恒空」自此
//   不再是「存在但为空」，而是「结构上不存在」）。

import { randomUUID } from "node:crypto";
import type {
  HarnessWorkflow,
  HarnessWorkflowStepContext,
  HarnessWorkflowStepOutcome,
} from "./harness-runtime.worker";
import type { HarnessRunEventType } from "./harness-runtime.types";
import type {
  StreamingChunk,
  WorkbenchDispatchInput,
  WorkbenchDispatchData,
  WorkbenchMemoryRefTrace,
} from "../../services/ai/workbench-dispatch.service";
import type { WorkbenchToolEffectOutput } from "../../services/ai/workbench-tool-loop";
import { createWorkbenchToolEventSink, toWorkbenchToolCallMetadata } from "../../services/ai/workbench-tool-event-surface";
import { WorkbenchToolApprovalPendingError, type WorkbenchToolApprovalGate } from "../../services/ai/workbench-tool-approval";
import type { WorkbenchToolCallSummary } from "../../services/ai/workbench-tool-event-surface";
import type {
  AppendAiSessionMessageIdempotentInput,
  AppendAiSessionMessageIdempotentResult,
} from "../ai-sessions/ai-sessions.repository";
import type { AiAttachment, AiSessionRecord } from "../ai-sessions/ai-sessions.types";
import { normalizeHomeAttachments, latestSessionAttachmentWithSummary, sessionRecordToHomeMessages, isExplicitReportRequest } from "../../services/ai/handlers/workbench-shared";
import type { HomeMessageInput } from "../../services/ai/handlers/workbench-shared";
import { resolveRunMemoryProjectId } from "./harness.types";
import { runExplicitHomeReportFlow } from "../../services/ai/handlers/report-flow";
import { hasOngoingWorkbenchToolInteraction } from "../../services/ai/workbench-intent.service";
import type { recordWorkbenchTurnTrace, recordWorkbenchTurnFailureTrace } from "../trace/trace.usecase";

export type WorkbenchChatWorkflowDeps = {
  /**
   * 复用 workbench-dispatch.service.ts 的分发入口。
   * 调用方注入真实 dispatch 或测试 stub。
   * messages/projectId 为 DEF-2026-08-27-001 additive 字段：会话历史窗口与
   * 记忆注入项目上下文，由本 workflow 在当前用户消息落库之后组装。
   */
  dispatch(input: Pick<WorkbenchDispatchInput, "message" | "user" | "workflowKey"> & Partial<WorkbenchDispatchInput> & {
    messages?: HomeMessageInput[];
    projectId?: string;
    /**
     * 批次 1c · 缺陷二（additive）：本会话是否处在一场还没结束的工具交互里。
     * 由本 workflow 从**已落库的会话记录**推导（上一轮 assistant 是否带工具痕迹），
     * 经 harness-boot 透传给 dispatchHomeWorkbenchTurn 的意图路由。端点层不接收
     * 前端的同名字段——判据必须是服务端查得出的事实。
     */
    hasOngoingToolInteraction?: boolean;
    /**
     * 批次 0 · ⑤：存储侧快照读取钩子（additive）。`messages` 是**发送侧**
     * （已经过 workflow → dispatch → modelChatStream 管道），本钩子供调用方
     * 在请求构造点**当场重取**会话记录作为**存储侧**基准，两侧独立推导再对账。
     * 只有异步 Run 通道存储权威，故只有本通道注入；未注入即不对账（行为同修复前）。
     */
    readSessionForInvariant?: () => Promise<AiSessionRecord | null>;
  }): Promise<WorkbenchDispatchData>;
  /**
   * 用户消息幂等落库（复用 ai-sessions 仓库公开 API，与直写路径同款）。
   * 生产接线见 harness-boot.ts；测试可注入 recording fake（S2b-2 后不再有
   * storePath 注入钩子）。阶段 1 批 8：返回类型由同步改 Promise。
   */
  appendSessionMessage(input: AppendAiSessionMessageIdempotentInput): Promise<AppendAiSessionMessageIdempotentResult>;
  /**
   * ISS-2026-08-10-004（层 2）：流式事件写入 run 事件流（additive）。
   * 生产接线复用 harness runtime repository 的 appendRunEvent（白名单校验后落库，
   * SSE 端点原样透传）；payload 形状对齐前端消费侧：
   * text.delta → { delta }，thought → { text }。
   * 可选以保持 additive 不破坏既有构造点（如 workflow 测试 stub）；
   * 未注入时流式事件静默跳过，不影响 dispatch 主链路。
   *
   * 批次 0.5 · ②：eventType 由 "text.delta" | "thought" 放宽到整个
   * HarnessRunEventType——工具四类（tool.call.*）与本族共用**同一条串行写链**，
   * 时序即模型真实产生顺序；再收窄字面量联合会让工具事件只能另起一条链，
   * sequence 将反映错误的 interleaving。白名单校验在 repository 侧，本处不重复。
   */
  appendRunEvent?(input: {
    runId: string;
    eventType: HarnessRunEventType;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  /**
   * 批次 0.5 · ②：tool.call.progress 心跳间隔（additive，仅测试用）。
   * 缺省取 WORKBENCH_TOOL_CALL_PROGRESS_INTERVAL_MS；0 关闭心跳。
   */
  toolCallProgressIntervalMs?: number;
  /**
   * 批次 1a · 约束③：写操作工具的审批闸门工厂（additive）。仅异步 Run 通道注入。
   * 闸门的两端口必须由 **Run 事件流 + run.status** 实现（可持久），不得用内存 Promise：
   * 判据④（等待期间重启 worker → 确认仍然有效）专门验这一点。
   *
   * `beforePause` 由本 workflow 提供：挂起前必须先冲刷工具事件写链，
   * 让 tool.call.started（参数唯一来源）严格早于 tool.call.awaiting_approval 落库，
   * 否则界面拿到一条按 callId 查不到参数的审批请求。
   */
  buildToolApprovalGate?(input: {
    runId: string;
    attemptId: string;
    stepKey: string;
    beforePause: () => Promise<unknown>;
  }): WorkbenchToolApprovalGate;
  /**
   * ISS-2026-08-16-002：会话级附件回退——请求未携带附件时，从已落库会话
   * 记录中取最近一个带 parsedSummary 的附件作为 dispatch 上下文（与同步
   * 路径 workbench-chat.handler.ts L59 同一口径）。
   * 生产接线见 harness-boot.ts（复用 ai-sessions usecase）；测试注入临时存储实现。
   * 可选以保持 additive 不破坏既有构造点；未注入时回退静默跳过（行为同修复前）。
   * 阶段 1 批 8：返回类型由同步改 Promise（底层 accessor 已异步化），实现 不动。
   */
  getSessionRecord?(sessionId: string, ownerUserId: string): Promise<AiSessionRecord | null>;
  /**
   * RP-030 真实链路覆盖（2026-08-28）：异步通道 trace 归档（与同步路径
   * workbench-chat.handler.ts 同口径）。生产接线注入 trace.usecase 真实
   * 实现；测试注入 spy。可选以保持 additive 不破坏既有构造点；未注入时
   * 静默跳过。写入必须置于 recordToolEffectOnce 的 execute 内——恢复重放
   * 跳过 execute，幂等天然成立（同流式事件口径）。
   */
  recordTurnTrace?(input: Parameters<typeof recordWorkbenchTurnTrace>[0]): Promise<unknown>;
  recordTurnFailureTrace?(input: Parameters<typeof recordWorkbenchTurnFailureTrace>[0]): Promise<unknown>;
};

export function createWorkbenchChatWorkflow(deps: WorkbenchChatWorkflowDeps): HarnessWorkflow {
  const CHAT_STEP_KEY = "chat";

  return {
    workflowId: "workbench_chat_v1",
    workflowVersion: "1.0.0",
    firstStepKey: CHAT_STEP_KEY,
    stepKeys: [CHAT_STEP_KEY],

    async executeStep(stepKey: string, ctx: HarnessWorkflowStepContext): Promise<HarnessWorkflowStepOutcome> {
      if (stepKey !== CHAT_STEP_KEY) {
        throw new Error(`Unknown step key: ${stepKey}`);
      }

      const run = ctx.run;
      const executionConfig = (run.executionConfig ?? {}) as Record<string, unknown>;
      const content = String(executionConfig.content ?? "").trim();
      if (!content) {
        throw new Error("executionConfig.content is required");
      }
      const aiSessionId = run.aiSessionId;
      if (!aiSessionId) {
        throw new Error("run.aiSessionId is required for workbench chat");
      }
      const attachments = normalizeHomeAttachments(executionConfig.attachments).slice(0, 5);
      const storedAttachments: AiAttachment[] = attachments.map((attachment) => ({
        attachmentId: `att-${randomUUID()}`,
        ...attachment,
        createdAt: new Date().toISOString(),
      }));
      // ISS-2026-08-16-002：请求级附件优先，缺失时经 getSessionRecord 回退到
      // 已落库会话附件（与同步路径 workbench-chat.handler.ts L59 同一口径）——
      // 覆盖「同一会话第二轮无附件请求」场景（如先传附件解析，再发"生成报告"）。
      const dispatchAttachment = attachments.find((attachment) => attachment.parsedSummary) ?? attachments[0]
        ?? latestSessionAttachmentWithSummary((await deps.getSessionRecord?.(aiSessionId, run.ownerUserId)) ?? null);

      // C2 缺陷 B：用户消息先于 dispatch 幂等落库（旧同步路径同款结构）；
      // 来源键 run 维度 deduplicationKey，恢复重放由去重吸收，不重复。
      await deps.appendSessionMessage({
        sessionId: aiSessionId,
        message: {
          messageId: `msg-${randomUUID()}`,
          role: "user",
          content,
          createdAt: new Date().toISOString(),
          attachmentIds: storedAttachments.map((attachment) => attachment.attachmentId),
        },
        attachments: storedAttachments,
        source: {
          deduplicationKey: `${run.harnessRunId}:user:1`,
          runId: run.harnessRunId,
          eventType: "user_message",
        },
      });

      // DEF-2026-08-27-001 第一层：异步 Run 通道必须携带会话历史与记忆项目。
      // 取历史时机是硬约束——必须在上面 appendSessionMessage 之后：
      // workbench-shared 的历史整形是「覆盖末条为用户本轮」而非追加，
      // 落库前取会把上一轮 assistant 当成末条覆盖丢失。
      // 批次 1c：同一次读取兼作「进行中工具交互」判据的数据源——判据读的正是
      // 这份已落库记录里本轮之前那条 assistant，另起一次查询只会读到同一份数据。
      const sessionRecordWithUserTurn = (await deps.getSessionRecord?.(aiSessionId, run.ownerUserId)) ?? null;
      const historyMessages = sessionRecordToHomeMessages(sessionRecordWithUserTurn);
      const memoryProjectId = resolveRunMemoryProjectId(run);

      // ISS-2026-08-16-004：显式报告闸门——当 dispatchAttachment 存在且用户消息
      // 是「生成需求解析报告」时，直接调用 runExplicitHomeReportFlow 生成报告，
      // 而不是走 dispatchHomeWorkbenchTurn 的意图分发（后者路由到静态文案）。
      // 与同步路径 workbench-chat.handler.ts L65 同一口径。
      if (dispatchAttachment && isExplicitReportRequest(content)) {
        const sessionWithUserTurn = (await deps.getSessionRecord?.(aiSessionId, run.ownerUserId)) ?? null;
        if (!sessionWithUserTurn) {
          throw new Error(`session not found: ${aiSessionId}`);
        }
        const flowResult = await runExplicitHomeReportFlow({
          user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
          workflowKey: "free_chat",
          session: sessionWithUserTurn,
          sessionWithUserTurn,
          parsedAttachment: dispatchAttachment,
          allAttachments: [dispatchAttachment],
        });
        if (flowResult.ok) {
          // runExplicitHomeReportFlow 已直接落库 assistant 消息 + artifact + pendingAction，
          // 返回体只带终态游标（补偿链已于 S2b-2 删除，outbox 字段随 S7 退役）。
          return {
            nextStepKey: null,
          };
        }
        // API Key 缺失时回退到普通 dispatch（与同步路径行为对齐：同步路径返回 40001，
        // 异步路径降级为普通问答，由意图分发器路由到静态文案）。
      }

      // 批次 1a：审批闸门随本 Run 构造。gate 只认服务端持久决策（run_action_confirmed /
      // tool.call.rejected），模型与前端都无从表达「本次无需确认」。
      let flushUiEventsBeforePause: () => Promise<unknown> = async () => {};
      const toolApprovalGate = deps.buildToolApprovalGate
        ? deps.buildToolApprovalGate({
            runId: run.harnessRunId,
            attemptId: ctx.attempt.harnessRunAttemptId,
            stepKey,
            beforePause: () => flushUiEventsBeforePause(),
          })
        : undefined;

      // effectKey 冻结口径：外层 dispatch 副作用恒为 workbench_chat_answer:1。
      // 批次 0 · ④：工具调用不复用这个 key——一轮 Run 内可能有 N 次工具调用，
      // 共用固定 key 会让第 2..N 次命中第 1 次已记录的 effect 被直接跳过
      // （副作用互相吞）。工具副作用改由下方 recordToolEffect 接缝逐 ordinal
      // 落 workbench_chat_tool_call:N，结构仍由 ctx.makeEffectKey 冻结。
      const effectKey = ctx.makeEffectKey("workbench_chat_answer", 1);

      const effectResult = await ctx.recordToolEffectOnce({
        effectKey,
        toolName: "workbench_chat_dispatch",
        input: { content, sessionId: run.aiSessionId },
        execute: async () => {
          // ISS-2026-08-10-004（层 2）：异步通道接入逐字流式——dispatch 入参携带
          // streamingAdapter，onToken 逐 chunk 直发写 run 事件流（不做 coalescing）：
          // contentDelta → text.delta({ delta })，reasoningContentDelta → thought({ text })；
          // onComplete/onError 不另写事件（终态事件由 runtime 既有链路发射）。
          // 副作用位于 execute 内，恢复重放经 recordToolEffectOnce 跳过，幂等天然成立；
          // 写链串行化保持事件时序，单条写失败不阻断模型主链路。
          let streamEventChain: Promise<unknown> = Promise.resolve();
          // 闸门挂起前冲刷写链（见 deps.buildToolApprovalGate 的 beforePause 说明）
          const appendStreamEvent = (eventType: HarnessRunEventType, payload: Record<string, unknown>) => {
            if (!deps.appendRunEvent) return; // 未注入（兼容构造点）时静默跳过
            const append = deps.appendRunEvent;
            streamEventChain = streamEventChain
              .then(() => append({ runId: run.harnessRunId, eventType, payload }))
              .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[workbench-chat] appendRunEvent ${eventType} run=${run.harnessRunId} failed: ${msg.slice(0, 200)}`);
              });
          };
          // 本轮模型调用注入的 active 记忆计数（经 kind=metadata chunk 透出）
          let memoryRef: WorkbenchMemoryRefTrace | undefined;
          const streamingAdapter = {
            onToken: (chunk: StreamingChunk) => {
              // DEF-2026-08-27-001：显式判别字段优先——metadata chunk 不是正文，
              // 既不得写进 run 事件流，也不得靠「空 content」隐式判定。
              if (chunk.kind === "metadata") {
                if (chunk.memoryRef) memoryRef = chunk.memoryRef;
                return;
              }
              if (chunk.reasoningContentDelta) {
                appendStreamEvent("thought", { text: chunk.reasoningContentDelta });
              }
              if (chunk.contentDelta) {
                appendStreamEvent("text.delta", { delta: chunk.contentDelta });
              }
            },
          };
          // 批次 0.5 · ②：工具调用四类 UI 事件。发射口挂在**同一条** streamEventChain
          // 上——与 text.delta 共用串行写链与 execute 返回前的冲刷，sequence 才能反映
          // 「模型先说话、再要求调工具、再回答」的真实 interleaving。callIndex 由 sink
          // 持有（AgentEvent 无 toolCallId，UI 配对只能靠本轮序号）；progress 心跳亦归
          // sink 管理。副作用位于 execute 内，恢复重放跳过 execute，幂等天然成立。
          const toolEventSink = createWorkbenchToolEventSink({
            emit: appendStreamEvent,
            progressIntervalMs: deps.toolCallProgressIntervalMs,
          });
          // 闸门挂起前先停心跳：向用户提问的那一刻，这个调用已经不在「执行中」了。
          // 不停 timer 就会在 awaiting 之后又落一条 tool.call.progress
          // （批次 1a 实取时真实发生过，routes 层已把它钉成断言）。
          flushUiEventsBeforePause = async () => {
            toolEventSink.stop();
            await streamEventChain;
          };

          let result: Awaited<ReturnType<WorkbenchChatWorkflowDeps["dispatch"]>>;
          try {
            result = await deps.dispatch({
              message: content,
              attachment: dispatchAttachment,
              user: { id: run.ownerUserId, username: run.ownerUsername, role: "user", status: "active", passwordHash: "", createdAt: "", lastLoginAt: "" },
              workflowKey: "free_chat",
              messages: historyMessages,
              projectId: memoryProjectId,
              // 批次 1c · 缺陷二：进行中的工具交互 → 意图路由让位（判据取自上面那次
              // 已落库读取，不新增查询；本轮用户消息是末条，判据看的是它之前那条 assistant）
              hasOngoingToolInteraction: hasOngoingWorkbenchToolInteraction(sessionRecordWithUserTurn?.messages),
              streamingAdapter,
              // 批次 0.5 · ②：工具事件 → UI 事件接缝（additive）。仅异步 Run 通道
              // 注入；同步直写路径不经 Harness 事件流，无 runId 可写，不注入即为 undefined。
              onToolEvent: toolEventSink.onToolEvent,
              // 批次 1a · 约束③：审批闸门接缝（additive，仅本异步通道注入）。
              ...(toolApprovalGate ? { toolApprovalGate } : {}),
              // 批次 0 · ⑤：发送-vs-存储对账的读取钩子。必须当场重取会话记录，
              // 不得复用上面的 historyMessages——那份正是被对账的发送侧，同源即永真。
              ...(deps.getSessionRecord
                ? { readSessionForInvariant: () => deps.getSessionRecord!(aiSessionId, run.ownerUserId) }
                : {}),
              // 批次 0 · ④：工具副作用逐次落独立 effectKey（N = 全局第 N 次工具调用）。
              // 命中已记录 effect 时 recordToolEffectOnce 直接回存量 output 且不调用
              // execute —— 重放同一 Run 不会重复执行工具，幂等语义与外层同构。
              recordToolEffect: async (ordinal, execute, toolEffectContext) => {
                const { output } = await ctx.recordToolEffectOnce({
                  effectKey: ctx.makeEffectKey("workbench_chat_tool_call", ordinal),
                  toolName: "workbench_chat_tool_call",
                  input: {
                    ordinal,
                    toolName: toolEffectContext.toolName,
                    arguments: toolEffectContext.arguments,
                  },
                  execute,
                });
                return (output ?? { ok: false, error: "effect_output_missing" }) as WorkbenchToolEffectOutput;
              },
            });
          } catch (err) {
            // 批次 1a：审批挂起不是回合失败——Run 停在 waiting 等用户，既不落失败
            // trace（会被当成一次故障污染考卷），也不由 runtime 标记 failed。
            if (err instanceof WorkbenchToolApprovalPendingError) {
              throw err;
            }
            // RP-030：失败 trace 归档（与同步路径同口径；归档自身失败静默吸收），随后重抛由 runtime 标记 run failed
            if (deps.recordTurnFailureTrace) {
              const reason = err instanceof Error ? err.message : "workbench_chat_failed";
              await deps.recordTurnFailureTrace({
                ownerUserId: run.ownerUserId,
                ownerUsername: run.ownerUsername,
                aiSessionId,
                userInputSummary: content.slice(0, 200),
                routingRule: "failed_before_dispatch",
                contextRefs: dispatchAttachment ? [`attachment:${dispatchAttachment.name}`] : [],
                error: { code: reason, message: reason, retryable: true },
              }).catch(() => {
                // 失败 trace 写入失败不影响主链路
              });
            }
            throw err;
          } finally {
            // 心跳定时器无条件停止：dispatch 若在 tool_call 与 tool_result 之间抛错，
            // 存活定时器会持续往已失败的 Run 写 progress（事件泄漏 + 污染时序）。
            toolEventSink.stop();
          }
          // execute 返回前冲刷写链，避免流式事件丢失在游离 promise 中
          await streamEventChain;
          // RP-030：成功 trace 归档（置于 execute 内，恢复重放跳过不重复写）
          if (deps.recordTurnTrace) {
            await deps.recordTurnTrace({
              ownerUserId: run.ownerUserId,
              ownerUsername: run.ownerUsername,
              aiSessionId,
              userInputSummary: content.slice(0, 200),
              dispatchTrace: result.trace,
              model: result.model,
            }).catch(() => {
              // trace 写入失败不影响主链路
            });
          }
          // 批次 0.5 · ③：快照取在写链冲刷之后——sink 与四类事件同源，
          // 此处读到的一定是整轮工具循环落定后的终态。
          const toolCallSummaries = toolEventSink.getToolCalls();
          return {
            answer: result.answer,
            intent: result.intent,
            suggestedActions: result.suggestedActions,
            trace: result.trace,
            formBlock: result.formBlock,
            // memoryRef 必须进 execute 返回值：恢复重放会跳过 execute，
            // 只有幂等吸收后的 output 才能保证两次执行写出同一条 metadata。
            ...(memoryRef ? { memoryRef } : {}),
            // 批次 0.5 · ③：工具调用展示摘要同理——重放若不从 output 读，
            // sink 内存态已随第一次执行销毁，重放会写出空列表（可视化倒退）。
            ...(toolCallSummaries.length ? { toolCalls: toolCallSummaries } : {}),
          };
        },
      });

      const output = effectResult.output ?? { answer: "" };
      const answer = String(output.answer ?? "");
      const intent = String((output as any).intent ?? "domain_qa");
      const suggestedActions = (output as any).suggestedActions ?? [];
      const trace = (output as any).trace ?? {};
      const formBlock = (output as any).formBlock;
      const memoryRef = (output as any).memoryRef as WorkbenchMemoryRefTrace | undefined;
      const absorbedToolCalls = (output as any).toolCalls as WorkbenchToolCallSummary[] | undefined;
      // 批次 0.5 · ③：镜像到 metadata **顶层** toolCalls。前端 mapSessionMessages
      // 只读顶层（MS3 口径），而 trace.toolCalls 嵌在 metadata.trace 下——不镜像
      // 则刷新页面/重开会话后 ② 的三态全部消失，可视化只活在一次 SSE 连接里。
      // 落库只带展示字段（callIndex/name/status/elapsedMs/errorPreview + source），
      // 完整参数与结果预览留在事件面，不进随会话持久化的列表。
      const toolCalls = toWorkbenchToolCallMetadata(absorbedToolCalls ?? [], (trace as { toolCalls?: unknown }).toolCalls);
      const messageMetadata = {
        intent,
        suggestedActions,
        trace,
        ...(formBlock ? { formBlock } : {}),
        // 前端 messageFormatter 只读 metadata 顶层 memoryRef，不得嵌进 trace
        ...(memoryRef ? { memoryRef } : {}),
        ...(toolCalls ? { toolCalls } : {}),
      };

      // S2b-2（§4.8 补偿链删除）：assistant 消息与 user 消息同款经
      // appendSessionMessage 直接幂等落库（同库直写），来源键
      // ${run.harnessRunId}:assistant:1 由仓储层按键查重吸收；返回体已无 outbox 键
      // （projector/sink/outbox 表已随补偿链删除，恢复重放由去重吸收）。
      await deps.appendSessionMessage({
        sessionId: aiSessionId,
        message: {
          messageId: `msg-${randomUUID()}`,
          role: "assistant",
          content: answer,
          createdAt: new Date().toISOString(),
          metadata: messageMetadata,
        },
        source: {
          deduplicationKey: `${run.harnessRunId}:assistant:1`,
          runId: run.harnessRunId,
          eventType: "assistant_message",
        },
      });

      return {
        nextStepKey: null, // 单步 workflow，执行后直接终态
      };
    },
  };
}
