import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkbenchToolEventSink } from "../../../services/ai/workbench-tool-event-surface";
test("completed native artifact references reach durable metadata and live events without storage paths", () => {
  const events: any[] = [];
  const sink = createWorkbenchToolEventSink({
    emit: (type, payload) => events.push({ type, payload }),
    progressIntervalMs: 0,
  });
  const a = {
    id: "3ed53b24-a2ee-4ecb-9137-f47439992c50",
    name: "report.html",
    title: "需求报告",
    format: "html",
    size: 100,
    expiresAt: "2099-01-01T00:00:00Z",
    storageKey: "private",
  };
  sink.onToolEvent({
    kind: "tool_call",
    name: "sandbox_execute",
    arguments: {},
    toolCallId: "c",
  });
  sink.onToolEvent({
    kind: "tool_result",
    name: "sandbox_execute",
    ok: true,
    data: { status: "completed", artifacts: [a] },
  });
  assert.equal(sink.getToolCalls()[0].artifacts?.length, 1);
  assert.equal(events[1].payload.artifacts.length, 1);
  assert.equal(JSON.stringify(events).includes("storageKey"), false);
});
test("server-frozen program remains fully reviewable before approval, no hidden executable suffix", () => {
  const events: any[] = [];
  const sink = createWorkbenchToolEventSink({
    emit: (type, payload) => events.push({ type, payload }),
    progressIntervalMs: 0,
  });
  const code = "#\n".repeat(65000) + 'print("suffix")';
  sink.onToolEvent({
    kind: "tool_call",
    name: "sandbox_execute",
    arguments: { code },
    preparedForApproval: true,
  });
  assert.equal(events[0].payload.arguments.code, code);
  sink.stop();
});

test("formal host cannot bypass durable tool approval through legacy report execution", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../workbench-chat.workflow.ts", import.meta.url), "utf8");
  assert.equal(source.includes("runExplicitHomeReportFlow"), false, "legacy report side effects must not run outside Harness tool approval");
});
