// ============================================================
// 批次 3 · ②③：确定性剪枝 + 早期历史压缩
// ============================================================
// 替换此前唯一的窗口机制：`slice(-12)`——按**条数**截断，与 token 无关。
// 条数口径的两个失效形态都是实的：12 条长消息（附件解析摘要动辄上万字）照样顶爆上下文；
// 12 条短消息又白扔了预算。本模块把决策权交还给 token 预算。
//
// ## 挂载位置：出口（egress），不是组装点
// 三条工作台通道都经 `runWorkbenchToolLoop` / `runWorkbenchToolLoopStream` 的
// `invoke` / `invokeStream` 发请求，本层挂在它们**发给 provider 之前**。两个理由：
//  ① 组装点 `buildWorkbenchChatModelInput` 的输出被 `workbench-request-invariant`
//    的第二份整形实现（slice(-12)）当场对账，那份实现是 2a 裁决刻意保留、本批明令
//    不动的独立对照。在组装点改剪枝口径，等于让这条防线在超预算时必红——剪枝越生效，
//    断言越炸。
//  ② 只有出口看得见**工具循环自己追加的消息**。两条通道都允许最多 12 轮工具调用，
//    每轮往 workingMessages 回填 `[工具结果]`；组装点剪完的那一份到第 5 轮早已不是
//    实际发出的形状。预算管的是「这一次请求占多少」，必须在增量齐了之后定量。
// 该不变量头注释本就把工具循环回填的消息划为「发送侧合法的新增中间态、不在对账
// 范围内」——出口侧的预算剪枝属同一类，不削弱它对组装口径的约束力。
//
// ## 必须保住的语义（实取 workbench-shared 一带的既有口径）
//  · **system prompt 恒在头部**：本层不删、不移位任何 system 消息；摘要一律插在
//    head system 之后，不与它争位（组装点另有 `system_prompt_not_only_head` 断言）。
//  · **附件解析上下文不得被裁**：`buildHomeMessageContentForModel` 拼出的
//    `【附件解析上下文】` 块是模型判断「用户上传了什么」的唯一依据（system prompt 里
//    明确要求基于它推进需求识别），裁掉等于让模型宣称收不到附件。带该标记的消息钉住。
//  · **末条恒在**：末条是本轮用户正文（组装点覆盖写入），裁掉即答非所问。
//  只有夹在中间的历史消息可被剪。
//
// ## 确定性从哪来（判据②「同一输入永远同一结果」的依据）
//  1. 纯函数：不读时钟（无 Date.now）、不取随机、不读进程内可变状态；
//  2. 决策状态是「按 middle 原下标索引的布尔数组」，剪枝集合完全由这个位串决定，
//     不依赖对象键序、Map 迭代序或工具完成的先后；
//  3. 计数全为整数（token 估算返回整数，比较用 <= / >=），无浮点累积随平台漂移；
//  4. 单向轨迹：候选按**从最旧到最新**逐条试剪，且只在「总量确实下降」时提交，
//     否则回退并停止——同一输入下这条轨迹唯一，不存在「这次多剪一条」的分支；
//  5. 摘要文本只由被剪消息自身字段（原始序号/角色/正文指纹/首句）按原序拼成，
//     不含时间戳，也不含模型生成内容。
// 于是同一输入两次调用逐字节相同（可重放）；工具循环第 N 轮的重放结果与 Run 恢复后
// 的第 N 轮一致——幂等接缝（recordToolEffect）依赖的正是这个可重放性。
//
// ## 为什么摘要用抽取式而不调模型
// 判据②要可重放、判据④要可追溯。让模型写摘要：温度 >0 时同输入两次产出不同，重放
// 即失效；且摘要会成「来历不明的文字」，正是判据④要防的形态。抽取式摘要逐条列出压缩
// 来源，可追溯是**构造出来的**，不是事后补一句标注。
// ============================================================

import type { ChatRole, ToolDefinition } from "../../../ai/provider/model-provider";
import { estimateRequestTokens, type MeteredMessage } from "./token-meter";

/**
 * 工作台单次模型请求的**输入** token 预算。
 * 取值依据：Moonshot 现役工作台模型（kimi-k3 / kimi-k2.6）为 256K 上下文档位。
 * 取 64K 落在「一次带附件解析摘要的工作台长对话也装得下」与「距上限仍有 4 倍余量」
 * 的交点——预算的意义是离上限足够远，不是贴着上限省一次剪枝。
 * 单点定义、各通道共用；不按模型名分支：模型可由用户在系统设置里换掉，
 * 贴着某个模型上限的预算会随换模型静默变成溢出。
 */
export const WORKBENCH_MODEL_MAX_INPUT_TOKENS = 64_000;

/** `buildHomeMessageContentForModel` 拼出的附件块标记；出现即钉住该条消息。 */
export const WORKBENCH_ATTACHMENT_CONTEXT_MARKER = "【附件解析上下文】";

/** 摘要逐条列出的行数上限；超出部分折成一条区间行（见 buildCompactionDigest）。 */
export const WORKBENCH_DIGEST_MAX_LINES = 40;
/** 摘要里每条首句摘录的字符上限。摘录只用于回查定位，不承担复述内容。 */
export const WORKBENCH_DIGEST_EXCERPT_CHARS = 60;

/** 出口侧消息形态：与 WorkbenchToolLoopMessage 结构一致，另可携带来源 id。 */
export type BudgetedModelMessage = { role: ChatRole; content: string; messageId?: string };

export type ModelContextBudgetResult = {
  /** 实际可发出的消息序列（system 在头，摘要紧随其后） */
  messages: BudgetedModelMessage[];
  /** 被压缩掉的原始消息（原序，元素即入参中的同一对象），供日志与测试回查 */
  dropped: readonly BudgetedModelMessage[];
  /** 压缩摘要本体；未发生压缩时为 null */
  digest: BudgetedModelMessage | null;
  beforeEstimatedInputTokens: number;
  estimatedInputTokens: number;
  compacted: boolean;
  /** 保护项自身已超预算（剪无可剪）——不抛错、不静默丢消息，交调用方观测 */
  stillOverBudget: boolean;
  /** 被钉住的消息条数（附件上下文）；可观测性用 */
  pinnedCount: number;
};

/**
 * 正文指纹：定位「摘要这一行压缩的是哪条原始消息」，而不复制正文
 * （工作台历史是客户的需求原文，指纹不可逆推）。FNV-1a 32 位，纯字符运算。
 */
export function contentFingerprint(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isPinned(message: BudgetedModelMessage): boolean {
  return (message.content ?? "").includes(WORKBENCH_ATTACHMENT_CONTEXT_MARKER);
}

/**
 * 钉住条数的统计口径：**只算可剪的历史**，跳过前导 system。
 * head system 的指令文案里本来就会提到「【附件解析上下文】」（workbench-shared 的
 * 角色提示词原文），把它算成「被钉住的历史消息」会让计数说谎。
 */
function countPinnedInHistory(messages: readonly BudgetedModelMessage[]): number {
  let headEnd = 0;
  while (headEnd < messages.length && messages[headEnd]!.role === "system") headEnd += 1;
  return messages.slice(headEnd).filter(isPinned).length;
}

function excerpt(content: string): string {
  const firstLine = (content ?? "").split("\n")[0] ?? "";
  const clipped = firstLine.length > WORKBENCH_DIGEST_EXCERPT_CHARS
    ? `${firstLine.slice(0, WORKBENCH_DIGEST_EXCERPT_CHARS - 1)}…`
    : firstLine;
  return clipped.replace(/\s+$/g, "");
}

/**
 * 抽取式压缩摘要。可追溯是本函数的构造性保证，不是约定：
 * 首行声明压缩条数与**原始序号区间**，其后逐条给出「原始序号 / 角色 / 正文指纹 /
 * 有 id 时给 id / 首句摘录」。序号是入参 `messages` 内 1-based 位置，
 * 与调用方手里那份数组一一对应。
 */
export function buildCompactionDigest(params: {
  dropped: readonly BudgetedModelMessage[];
  /** 首条被剪消息在入参数组中的 0-based 下标 */
  firstOriginalIndex: number;
}): BudgetedModelMessage | null {
  const dropped = params.dropped;
  if (dropped.length === 0) return null;
  const start = params.firstOriginalIndex + 1;
  const end = start + dropped.length - 1;
  const lines: string[] = [
    `[历史摘要] 以下为本轮更早对话的压缩摘要，共压缩 ${dropped.length} 条消息（原始序号 ${start}–${end}）。`,
    "该摘要由系统按原序抽取生成、未经模型改写；每条后的「原始序号+指纹」可回查其压缩的原始消息。",
  ];
  const listed = dropped.slice(0, WORKBENCH_DIGEST_MAX_LINES);
  for (let i = 0; i < listed.length; i += 1) {
    const message = listed[i]!;
    const idPart = message.messageId ? ` id=${message.messageId}` : "";
    lines.push(
      `- 原始序号=${start + i}${idPart} 角色=${message.role} 指纹=${contentFingerprint(message.content ?? "")} 首句="${excerpt(message.content)}"`,
    );
  }
  const rest = dropped.slice(listed.length);
  if (rest.length > 0) {
    const restStart = start + listed.length;
    const restFingerprints = rest.slice(0, 8).map((message) => contentFingerprint(message.content ?? "")).join(",");
    lines.push(
      `- （另有 ${rest.length} 条同批压缩：原始序号=${restStart}–${restStart + rest.length - 1}，` +
        `指纹=${restFingerprints}${rest.length > 8 ? ",…" : ""}）`,
    );
  }
  lines.push("（以上为压缩部分；以下消息为本轮仍在上下文中的原始消息）");
  return { role: "assistant", content: lines.join("\n") };
}

/**
 * 按 token 预算裁剪模型请求。纯函数：不修改入参数组，也不修改入参中的消息对象
 * （返回数组里的保留项与入参同一引用，摘要是新建对象）。
 */
export function applyModelContextBudget(input: {
  messages: readonly BudgetedModelMessage[];
  tools?: readonly ToolDefinition[];
  maxInputTokens?: number;
}): ModelContextBudgetResult {
  const messages = input.messages;
  const tools = input.tools;
  const maxInputTokens = input.maxInputTokens ?? WORKBENCH_MODEL_MAX_INPUT_TOKENS;
  const before = estimateRequestTokens({ messages: messages as MeteredMessage[], tools });
  const pinnedCount = countPinnedInHistory(messages);

  if (messages.length === 0 || before <= maxInputTokens) {
    return {
      messages: [...messages],
      dropped: [],
      digest: null,
      beforeEstimatedInputTokens: before,
      estimatedInputTokens: before,
      compacted: false,
      stillOverBudget: false,
      pinnedCount,
    };
  }

  // 前导连续的 system 消息：恒留、位置不动
  let headEnd = 0;
  while (headEnd < messages.length && messages[headEnd]!.role === "system") headEnd += 1;
  const headSystem = messages.slice(0, headEnd);
  // 末条恒留（本轮用户正文）。退化输入（整串都是 system）时没有末条可另留。
  const hasTrailingTurn = headEnd < messages.length;
  const lastMessage = hasTrailingTurn ? messages[messages.length - 1]! : null;
  const middle = hasTrailingTurn ? messages.slice(headEnd, messages.length - 1) : [];

  /** middle 每条是否被剪；剪枝集合完全由这个位串决定（确定性第 2 条） */
  const droppedFlags: boolean[] = middle.map(() => false);

  const project = (): { assembled: BudgetedModelMessage[]; dropped: BudgetedModelMessage[]; tokens: number } => {
    const kept: BudgetedModelMessage[] = [];
    const dropped: BudgetedModelMessage[] = [];
    for (let index = 0; index < middle.length; index += 1) {
      if (droppedFlags[index]) dropped.push(middle[index]!);
      else kept.push(middle[index]!);
    }
    const firstDropped = droppedFlags.findIndex((flagged) => flagged);
    const digest = dropped.length > 0
      ? buildCompactionDigest({ dropped, firstOriginalIndex: headEnd + firstDropped })
      : null;
    const assembled: BudgetedModelMessage[] = [...headSystem];
    if (digest) assembled.push(digest);
    assembled.push(...kept);
    if (lastMessage) assembled.push(lastMessage);
    return { assembled, dropped, tokens: estimateRequestTokens({ messages: assembled as MeteredMessage[], tools }) };
  };

  let current = project();
  // 候选按从最旧到最新逐条试剪；钉住的（附件解析上下文）永不进候选
  for (let index = 0; index < middle.length; index += 1) {
    if (current.tokens <= maxInputTokens) break;
    if (isPinned(middle[index]!)) continue;
    droppedFlags[index] = true;
    const trial = project();
    if (trial.tokens >= current.tokens) {
      // 剪了反而不降（摘要自身也要占 token）：回退并停止，保持单向轨迹
      droppedFlags[index] = false;
      break;
    }
    current = trial;
  }

  return {
    messages: current.assembled,
    dropped: current.dropped,
    digest: current.dropped.length > 0
      ? buildCompactionDigest({
          dropped: current.dropped,
          firstOriginalIndex: headEnd + droppedFlags.findIndex((flagged) => flagged),
        })
      : null,
    beforeEstimatedInputTokens: before,
    estimatedInputTokens: current.tokens,
    compacted: current.dropped.length > 0,
    stillOverBudget: current.tokens > maxInputTokens,
    pinnedCount,
  };
}
