// ============================================================
// 状态机目录（系统管理「状态机规则」可视化真源）· 防漂移测试
// ============================================================
// 双层约束：
//  · schema 完整性——每轴 statuses 唯一、initial 在集合内、每条流转的
//    from/to 必须落在该轴 statuses、trigger/guard 非空、implemented 为布尔；
//  · 防漂移——存在运行时枚举常量（as const / 数组）的对象，目录状态集必须
//    与源码常量逐字一致（排序比对）。源码枚举一旦变更，本测试先红：
//    目录与代码必须同步修改，禁止只改一边。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  STATE_MACHINE_CATALOG,
  type StateMachineAxis,
  type StateMachineDescriptor,
} from "./state-machines.catalog";
import { VALID_PROJECT_STATUSES } from "../project-evaluations/project-evaluations.repository";
import { VALID_STATUSES as AI_SESSION_STATUSES } from "../ai-sessions/ai-sessions.usecase";
import {
  HARNESS_ACTION_STATUSES,
  HARNESS_RUN_STATUSES,
  MANUAL_TEST_RESULT_STATUSES,
} from "../harness/harness.types";
import {
  HARNESS_ATTEMPT_STATUSES,
  HARNESS_OUTPUT_STATUSES,
  HARNESS_RUN_TERMINAL_STATUSES,
} from "../harness/harness-runtime.types";
import { MASTER_DATA_STATUSES } from "../../db/schema/industry";

const sorted = (values: readonly string[]): string[] => [...values].sort();

function axis(descriptor: StateMachineDescriptor, axisKey: string) {
  const axis = descriptor.axes.find((a) => a.key === axisKey);
  assert.ok(axis, `${descriptor.id} 必须含状态轴 ${axisKey}`);
  return axis!;
}

function statusKeys(axis: StateMachineAxis): string[] {
  return axis.statuses.map((s) => s.key);
}

test("state-machines: catalog 覆盖登记的全部对象", () => {
  const expectedIds = [
    // business_object
    "ai_artifact",
    "ai_session",
    "change_submission",
    "collab_question",
    "dev_assessment",
    "harness_action",
    "harness_attempt",
    "harness_output",
    "harness_run",
    "knowledge_entry",
    "manual_test_result",
    "master_data",
    "memory",
    "project",
    "runtime_token",
    "sales_briefing",
    "team_review",
    "user_account",
    "version_code_rule",
    "wbs_task",
    // version_document
    "version_document",
  ].sort();
  assert.deepEqual(STATE_MACHINE_CATALOG.map((d) => d.id).sort(), expectedIds);
});

test("state-machines: schema 完整性（轴/状态/流转引用闭合）", () => {
  const domains = new Set(["business_object", "version_document"]);
  for (const d of STATE_MACHINE_CATALOG) {
    assert.ok(d.id && d.objectLabel && d.sourceRef, `${d.id}: id/objectLabel/sourceRef 必填`);
    assert.ok(domains.has(d.domain), `${d.id}: domain 非法 ${d.domain}`);
    assert.ok(d.domain === "version_document" ? d.axes.length === 3 : d.axes.length >= 1, `${d.id}: 轴数量`);
    for (const a of d.axes) {
      assert.ok(a.key && a.label, `${d.id}.${a.key}: 轴 key/label 必填`);
      assert.ok(a.statuses.length > 0, `${d.id}.${a.key}: statuses 非空`);
      const keys = statusKeys(a);
      assert.equal(new Set(keys).size, keys.length, `${d.id}.${a.key}: status key 不得重复`);
      assert.ok(keys.includes(a.initial), `${d.id}.${a.key}: initial 必须在 statuses 内`);
      for (const s of a.statuses) {
        assert.ok(s.key && s.label && s.description, `${d.id}.${a.key}.${s.key}: 状态三要素必填`);
      }
      for (const t of a.transitions) {
        assert.ok(keys.includes(t.from), `${d.id}.${a.key}: 流转起始态 ${t.from} 不在集合内`);
        assert.ok(keys.includes(t.to), `${d.id}.${a.key}: 流转目标态 ${t.to} 不在集合内`);
        assert.ok(t.trigger.trim().length > 0, `${d.id}.${a.key}: ${t.from}->${t.to} trigger 非空`);
        assert.ok(t.guard.trim().length > 0, `${d.id}.${a.key}: ${t.from}->${t.to} guard 非空`);
        assert.equal(typeof t.implemented, "boolean", `${d.id}.${a.key}: implemented 必须布尔`);
      }
    }
    assert.ok(d.invariants.length >= 1, `${d.id}: 至少一条不变式`);
  }
});

test("state-machines: 项目状态集与 VALID_PROJECT_STATUSES 逐字一致（防漂移）", () => {
  const project = STATE_MACHINE_CATALOG.find((d) => d.id === "project")!;
  assert.deepEqual(sorted(statusKeys(axis(project, "status"))), sorted(VALID_PROJECT_STATUSES));
});

test("state-machines: 项目流转——人工确认已落地，发布/归档如实标注未实现", () => {
  const project = STATE_MACHINE_CATALOG.find((d) => d.id === "project")!;
  const transitions = axis(project, "status").transitions;
  const confirm = transitions.find((t) => t.from === "draft" && t.to === "reviewing");
  assert.ok(confirm && confirm.implemented, "draft→reviewing（人工确认 AI 草稿）必须已落地");
  const publish = transitions.find((t) => t.to === "published");
  assert.ok(publish && !publish.implemented, "→published 必须如实标注未实现");
  const archive = transitions.find((t) => t.to === "archived");
  assert.ok(archive && !archive.implemented, "→archived 必须如实标注未实现");
});

test("state-machines: AI 会话状态集与 ai-sessions VALID_STATUSES 逐字一致（防漂移）", () => {
  const session = STATE_MACHINE_CATALOG.find((d) => d.id === "ai_session")!;
  assert.deepEqual(sorted(statusKeys(axis(session, "status"))), sorted(AI_SESSION_STATUSES));
});

test("state-machines: Harness 四轴状态集与运行时枚举逐字一致（防漂移）", () => {
  const run = STATE_MACHINE_CATALOG.find((d) => d.id === "harness_run")!;
  assert.deepEqual(sorted(statusKeys(axis(run, "status"))), sorted(HARNESS_RUN_STATUSES));
  // 终态标记必须与 ACTIVE/TERMINAL 常量口径一致
  const terminalKeys = axis(run, "status").statuses.filter((s) => s.terminal).map((s) => s.key).sort();
  assert.deepEqual(terminalKeys, sorted(HARNESS_RUN_TERMINAL_STATUSES));

  const attempt = STATE_MACHINE_CATALOG.find((d) => d.id === "harness_attempt")!;
  assert.deepEqual(sorted(statusKeys(axis(attempt, "status"))), sorted(HARNESS_ATTEMPT_STATUSES));

  const action = STATE_MACHINE_CATALOG.find((d) => d.id === "harness_action")!;
  assert.deepEqual(sorted(statusKeys(axis(action, "status"))), sorted(HARNESS_ACTION_STATUSES));

  const output = STATE_MACHINE_CATALOG.find((d) => d.id === "harness_output")!;
  assert.deepEqual(sorted(statusKeys(axis(output, "status"))), sorted(HARNESS_OUTPUT_STATUSES));

  const manual = STATE_MACHINE_CATALOG.find((d) => d.id === "manual_test_result")!;
  assert.deepEqual(sorted(statusKeys(axis(manual, "result"))), sorted(MANUAL_TEST_RESULT_STATUSES));
});

test("state-machines: 主数据状态集与 MASTER_DATA_STATUSES 逐字一致（防漂移）", () => {
  const master = STATE_MACHINE_CATALOG.find((d) => d.id === "master_data")!;
  assert.deepEqual(sorted(statusKeys(axis(master, "status"))), sorted(MASTER_DATA_STATUSES));
});

test("state-machines: 版本文档必须三轴（status/checkout/doc）", () => {
  const doc = STATE_MACHINE_CATALOG.find((d) => d.id === "version_document")!;
  assert.equal(doc.domain, "version_document");
  assert.deepEqual(doc.axes.map((a) => a.key).sort(), ["checkout", "doc", "status"]);
  assert.deepEqual(sorted(statusKeys(axis(doc, "status"))), sorted(["draft", "reviewed", "published", "archived"]));
  assert.deepEqual(sorted(statusKeys(axis(doc, "checkout"))), sorted(["checked_in", "checked_out"]));
  assert.deepEqual(sorted(statusKeys(axis(doc, "doc"))), sorted(["drafting", "reviewed"]));

  // 六动作守卫必须在 checkout 轴流转中逐条登记
  const checkoutTriggers = axis(doc, "checkout").transitions.map((t) => t.trigger);
  for (const action of ["checkout", "checkin", "save-draft", "undo-checkout", "promote", "force-unlock"]) {
    assert.ok(
      checkoutTriggers.some((tr) => tr.includes(action)),
      `checkout 轴必须登记动作 ${action} 的流转与守卫`,
    );
  }
});
