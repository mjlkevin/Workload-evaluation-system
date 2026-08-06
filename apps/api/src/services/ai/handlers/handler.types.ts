// ============================================================
// O4 Handler 接口 — AI 工作台意图处理器统一契约
// 每个 handler 负责一类意图的响应构建；dispatch 服务只负责路由与分发。
// 重构为纯结构搬迁：handler 内的判定逻辑、阈值、文案与原实现完全一致。
// ============================================================

import type { WorkbenchContext } from "../workbench-context.service";
import type { ModelClassificationResult, WorkbenchIntent } from "../workbench-intent.service";
import type { WorkbenchDispatchData, WorkbenchDispatchInput } from "../workbench-dispatch.service";

/** 一次分发的完整入参：路由结果 + 上下文 + 原始输入 + 可选模型分类结果 */
export type WorkbenchHandlerParams = {
  intent: { intent: WorkbenchIntent; confidence: number; routingRule: string };
  context: WorkbenchContext;
  input: WorkbenchDispatchInput;
  /** RP-003/RP-049：规则兜底时的模型二次分类结果（无论是否采纳都随 trace 透出） */
  modelClassification?: ModelClassificationResult;
};

/** 意图处理器：声明负责的意图集合，产出统一的 WorkbenchDispatchData */
export interface WorkbenchIntentHandler {
  readonly intents: readonly WorkbenchIntent[];
  handle(params: WorkbenchHandlerParams): Promise<WorkbenchDispatchData> | WorkbenchDispatchData;
}
