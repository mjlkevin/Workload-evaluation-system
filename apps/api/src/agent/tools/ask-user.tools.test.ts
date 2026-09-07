// ============================================================
// 批次 9 · ask_user 闸门单测（不连库：只证判定逻辑本身）
// ============================================================
// 端到端那份（workbench-ask-user.e2e.test.ts）证「链路真的通」，本份证
// 「每个分支的口径长什么样」——尤其判据③那句错误文案必须可读、
// 判据④的决策槽必须是 allow（否则本批等于把问一句话也变成要点一次同意）。
//
// 刻意把「契约只有一个来源」也钉成断言：parameters 与校验用的契约必须是同一个
// 对象引用。任何人日后复制出一份第二套表单 schema，这条当场红。

import test from "node:test";
import assert from "node:assert/strict";

import { INTERACTIVE_FORM_BLOCK_CONTRACT } from "../../ai/contracts";
import { buildAskUserTool } from "../tools/ask-user.tools";
import { resolveWorkbenchToolDecisionSlot } from "../../services/ai/workbench-tool-approval";
import {
  ASK_USER_TOOL_NAME,
  WorkbenchToolAwaitingInputError,
  buildWorkbenchToolInputActionId,
  createWorkbenchToolInputGate,
  validateAskUserFormArguments,
  type WorkbenchToolAnswer,
} from "../../services/ai/workbench-tool-user-input";

const FORM = {
  blockId: "clarify-scope",
  title: "请补充项目信息",
  submitLabel: "提交",
  fields: [
    { id: "industry", label: "客户行业", type: "single_select", options: [{ label: "制造业", value: "manufacturing" }] },
  ],
};

// ============================================================
// 判据④ 决策槽 = allow（问一句话不该再要一道确认）
// ============================================================

test("ask_user 注册元信息：mutates=false + 只读能力位 + 决策槽 allow", () => {
  const tool = buildAskUserTool();
  assert.equal(tool.name, ASK_USER_TOOL_NAME);
  assert.equal(tool.mutates, false, "问一个问题不危险：mutates 必须为 false");
  assert.equal(tool.capability, "estimates:read", "凡能用工作台的人都可被提问，不得要求写能力位");
  assert.equal(
    resolveWorkbenchToolDecisionSlot(tool),
    "allow",
    "决策槽必须是 allow——落 ask 就等于给「回答一个问题」再加一道审批",
  );
});

test("判据③根因防护：parameters 与校验契约同一对象引用（不得复制出第二套表单 schema）", () => {
  const tool = buildAskUserTool();
  assert.equal(tool.parameters, INTERACTIVE_FORM_BLOCK_CONTRACT.schema, "参数 schema 只能引用既有契约，不能是抄件");
});

test("字段类型仍只有契约那五种（本批明令不扩）", () => {
  const types = (INTERACTIVE_FORM_BLOCK_CONTRACT.schema as {
    properties: { fields: { items: { properties: { type: { enum: string[] } } } } };
  }).properties.fields.items.properties.type.enum;
  assert.deepEqual(types, ["text", "textarea", "single_select", "boolean", "number"]);
});

// ============================================================
// 判据③ 校验分支：拒什么、说什么
// ============================================================

test("合契约的参数通过校验并原样给出表单结构", () => {
  const result = validateAskUserFormArguments(FORM as unknown as Record<string, unknown>);
  assert.equal(result.ok, true);
  assert.deepEqual((result as { formBlock: unknown }).formBlock, FORM);
});

/** 判据③的可读性口径：点名工具 + 说明是契约没过 + 给出字段路径 */
function expectRejected(args: Record<string, unknown>, ...mustMention: string[]): string {
  const result = validateAskUserFormArguments(args);
  assert.equal(result.ok, false, `应被拒绝：${JSON.stringify(args)}`);
  const error = (result as { error: string }).error;
  assert.match(error, new RegExp(ASK_USER_TOOL_NAME));
  assert.match(error, /契约/);
  assert.match(error, /表单未渲染/, "错误须说明控件没渲染，模型才知道用户看不到它");
  for (const mention of mustMention) {
    assert.ok(error.includes(mention), `错误须包含 ${mention}，实取 ${error}`);
  }
  return error;
}

test("缺 blockId → 拒，错误点名 blockId", () => {
  const { blockId: _omit, ...rest } = FORM;
  expectRejected(rest as Record<string, unknown>, "blockId", "required");
});

test("字段键写成 name（会话 7f5cbf75 的真实错法）→ 拒，错误指向 /fields/0 并点名 id", () => {
  const error = expectRejected(
    { ...FORM, fields: [{ name: "industry", label: "行业", type: "text" }] },
    "/fields/0",
    "id",
  );
  assert.match(error, /additional properties/, "多出来的 name 也要一并说清，否则模型改一处又错另一处");
});

test("字段类型不受支持 → 拒，错误给出该字段的枚举约束路径", () => {
  expectRejected({ ...FORM, fields: [{ id: "when", label: "日期", type: "date_picker" }] }, "/fields/0/type");
});

test("顶层多余属性 → 拒，且错误必须把多出来的键名抄出来（ajv 只把它放在 params 里）", () => {
  const error = expectRejected({ ...FORM, theme: "dark" }, "theme");
  assert.doesNotMatch(error, /must NOT have additional properties$/, "不能只留一句没有主语的英文");
});

test("single_select 缺 options → semanticValidate 也拦得住（契约两段校验都要跑）", () => {
  expectRejected({ ...FORM, fields: [{ id: "industry", label: "行业", type: "single_select" }] }, "/fields/0/options");
});

test("空字段列表 → 拒（契约 minItems:1）：不许渲染一个没有问题的问题", () => {
  expectRejected({ ...FORM, fields: [] }, "/fields");
});

test("问题过多 → 错误只列前若干条并说明被截断（不得用错误信息撑爆上下文）", () => {
  const fields = Array.from({ length: 12 }, (_unused, index) => ({ id: `f${index}`, label: `题${index}`, type: "unknown_type" }));
  const error = validateAskUserFormArguments({ ...FORM, fields }) as { error: string };
  const bulletLines = error.error.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(bulletLines.length, 8, "实取 " + bulletLines.length);
  assert.match(error.error, /另有 5 处问题未列出/, "13 处问题（1 条 maxItems + 12 条 enum）截到 8 条");
});

// ============================================================
// 闸门三分支：已答 / 未答挂起 / 参数不合契约
// ============================================================

function makeGate(overrides: { answer?: WorkbenchToolAnswer | null; findAnswerThrows?: boolean } = {}) {
  const pauses: unknown[] = [];
  const scope = { runId: "run-1", attemptId: "attempt-1", stepKey: "step-1" };
  const gate = createWorkbenchToolInputGate(scope, {
    findAnswer: async () => {
      if (overrides.findAnswerThrows) throw new Error("db down");
      return overrides.answer ?? null;
    },
    pauseForInput: async (input) => {
      pauses.push(input);
      return { paused: true };
    },
  });
  return { gate, pauses };
}

const CALL = { ordinal: 1, toolName: ASK_USER_TOOL_NAME, callId: "call_1", arguments: FORM as unknown as Record<string, unknown> };

test("已答 → 直接回填结构化答案，不再挂起、不再问第二遍", async () => {
  const { gate, pauses } = makeGate({ answer: { values: { industry: "manufacturing" } } });
  const result = await gate(CALL);
  assert.equal(result.outcome, "answered");
  assert.deepEqual((result as { data: unknown }).data, {
    status: "answered_by_user",
    actionId: buildWorkbenchToolInputActionId({ runId: "run-1", stepKey: "step-1", ordinal: 1, toolName: ASK_USER_TOOL_NAME, arguments: CALL.arguments }),
    values: { industry: "manufacturing" },
  });
  assert.equal(pauses.length, 0, "已有答案就不得再挂起");
});

test("未答 → 落等待事实后就地停手（抛 Pending，不返回任何值）", async () => {
  const { gate, pauses } = makeGate();
  await assert.rejects(() => gate(CALL), WorkbenchToolAwaitingInputError);
  assert.equal(pauses.length, 1);
  const pause = pauses[0] as { runId: string; actionId: string; formBlock: unknown; toolName: string; ordinal: number };
  assert.equal(pause.runId, "run-1");
  assert.equal(pause.toolName, ASK_USER_TOOL_NAME);
  assert.equal(pause.ordinal, 1);
  assert.deepEqual(pause.formBlock, FORM, "挂起必须带上表单结构，否则界面无可渲染事实");
  assert.ok(pause.actionId.startsWith("run-1:step-1:workbench_chat_ask_user:1:ask_user:"));
});

test("参数不合契约 → 连等待事件都不写（不许静默渲染半个控件）", async () => {
  const { gate, pauses } = makeGate();
  const result = await gate({ ...CALL, arguments: { title: "没有 blockId 和 fields" } as unknown as Record<string, unknown> });
  assert.equal(result.outcome, "invalid");
  assert.equal(pauses.length, 0, "校验没过就挂起 = 造出一个渲染不出来的 waiting 状态");
});

test("查答案抛错按「未答」处理（失败方向关闭：宁可重新问一次）", async () => {
  const { gate, pauses } = makeGate({ findAnswerThrows: true });
  await assert.rejects(() => gate(CALL), WorkbenchToolAwaitingInputError);
  assert.equal(pauses.length, 1);
});

test("actionId 绑死参数摘要：换题目即换键，旧答案天然套不到新问题", () => {
  const base = { runId: "run-1", stepKey: "step-1", ordinal: 1, toolName: ASK_USER_TOOL_NAME };
  const first = buildWorkbenchToolInputActionId({ ...base, arguments: FORM });
  const same = buildWorkbenchToolInputActionId({ ...base, arguments: JSON.parse(JSON.stringify(FORM)) });
  const changed = buildWorkbenchToolInputActionId({ ...base, arguments: { ...FORM, title: "换个题目" } });
  assert.equal(first, same, "同参数不同键序必须得同一摘要，否则重放会误判为新问题");
  assert.notEqual(first, changed);
});

test("actionId 与审批的键不共用 purpose 段（两种等待不得互相顶替）", () => {
  const input = buildWorkbenchToolInputActionId({
    runId: "run-1",
    stepKey: "step-1",
    ordinal: 1,
    toolName: ASK_USER_TOOL_NAME,
    arguments: FORM,
  });
  assert.ok(input.includes("workbench_chat_ask_user"), `实取 ${input}`);
  assert.ok(!input.includes("workbench_chat_tool_approval"), "不得与批次 1a 的审批键同段");
});

// ============================================================
// 无闸门通道（同步兜底）：明确失败，不静默
// ============================================================

test("工具 execute 在无闸门的通道上必须明确失败（不得假装问过了）", async () => {
  await assert.rejects(
    () => buildAskUserTool().execute({}, { id: "u", capabilities: ["estimates:read"] }),
    /当前通道无法向用户发起交互/,
  );
});
