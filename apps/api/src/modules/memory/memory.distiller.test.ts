// ============================================================
// SP-2026-007 · MS2（M2 会话记忆分层蒸馏）
// memory.distiller.test — 蒸馏逻辑单元测试
// ============================================================
// 使用 node:test + node:assert，不依赖 vitest

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { distillRunMemory } from "./memory.distiller";
import type { MemoryRepository, MemoryListResult } from "./memory.repository";
import type { MemoryAtomRow, MemorySceneRow } from "../../db/schema";
import type { ModelProvider } from "../../ai/provider";

function makeFakeRepo(saveFn?: (...args: any[]) => Promise<any>): MemoryRepository {
  const noop = async () => null;
  return {
    saveDistilledMemory: saveFn ?? (async () => ({ atoms: [] as MemoryAtomRow[], scenes: [] as MemorySceneRow[] })),
    listMemoryForProject: async () => ({ atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 }) as MemoryListResult,
    listMemoryForOwner: async () => ({ atoms: [], scenes: [], totalAtoms: 0, totalScenes: 0 }) as MemoryListResult,
    confirmMemoryAtom: noop as MemoryRepository["confirmMemoryAtom"],
    confirmMemoryScene: noop as MemoryRepository["confirmMemoryScene"],
    archiveMemoryAtom: noop as MemoryRepository["archiveMemoryAtom"],
    archiveMemoryScene: noop as MemoryRepository["archiveMemoryScene"],
    getActiveScenesForProject: async () => [],
    getActiveAtomsForProject: async () => [],
  };
}

function makeFakeProvider(responseContent: string): ModelProvider {
  return {
    name: "kimi-fake",
    defaultModel: "moonshot-v1-8k",
    isAvailable: () => true,
    chatCompletion: async () => ({
      content: responseContent,
      rawContent: responseContent,
      provider: "kimi",
      model: "moonshot-v1-8k",
      attempts: 1,
      finishReason: "stop",
    }),
  } as unknown as ModelProvider;
}

describe("memory.distiller", () => {
  const input = {
    ownerUserId: "user-001",
    projectId: "proj-001",
    harnessRunId: "run-001",
    runTitle: "测试 Run",
    messages: [
      { role: "user", content: "客户是小鹏汽车" },
      { role: "assistant", content: "收到，已记录客户信息" },
    ],
  };

  test("should distill and save memory on valid JSON response", async () => {
    let saveCalled = false;
    const repo = makeFakeRepo(async () => {
      saveCalled = true;
      return { atoms: [], scenes: [] };
    });
    const provider = makeFakeProvider(JSON.stringify({
      atoms: [{ factKey: "customer", factText: "小鹏汽车", confidence: 95 }],
      scenes: [{ sceneTitle: "客户确认", sceneSummary: "确认了客户名称", atomKeys: ["customer"] }],
    }));

    const result = await distillRunMemory(
      { repo, provider, model: "moonshot-v1-8k", apiKey: "fake", apiBaseUrl: "http://localhost" },
      input,
    );

    assert.ok(result.success, "distill should succeed");
    assert.ok(saveCalled, "saveDistilledMemory should have been called");
  });

  test("should return error on non-JSON response", async () => {
    let saveCalled = false;
    const repo = makeFakeRepo(async () => {
      saveCalled = true;
      return { atoms: [], scenes: [] };
    });
    const provider = makeFakeProvider("这不是 JSON");

    const result = await distillRunMemory(
      { repo, provider, model: "moonshot-v1-8k", apiKey: "fake", apiBaseUrl: "http://localhost" },
      input,
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "distill_response_not_json");
    assert.equal(saveCalled, false);
  });

  test("should return error on schema-invalid JSON", async () => {
    let saveCalled = false;
    const repo = makeFakeRepo(async () => {
      saveCalled = true;
      return { atoms: [], scenes: [] };
    });
    const provider = makeFakeProvider(JSON.stringify({ atoms: "wrong" }));

    const result = await distillRunMemory(
      { repo, provider, model: "moonshot-v1-8k", apiKey: "fake", apiBaseUrl: "http://localhost" },
      input,
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "distill_schema_invalid");
    assert.equal(saveCalled, false);
  });

  test("should return error on provider exception", async () => {
    let saveCalled = false;
    const repo = makeFakeRepo(async () => {
      saveCalled = true;
      return { atoms: [], scenes: [] };
    });
    const provider: ModelProvider = {
      name: "kimi-fake",
      defaultModel: "moonshot-v1-8k",
      isAvailable: () => true,
      chatCompletion: async () => { throw new Error("network timeout"); },
    } as unknown as ModelProvider;

    const result = await distillRunMemory(
      { repo, provider, model: "moonshot-v1-8k", apiKey: "fake", apiBaseUrl: "http://localhost" },
      input,
    );

    assert.equal(result.success, false);
    assert.ok(result.error!.includes("network timeout"));
    assert.equal(saveCalled, false);
  });

  test("should extract JSON from markdown code block", async () => {
    const repo = makeFakeRepo();
    const provider = makeFakeProvider("```json\n" + JSON.stringify({
      atoms: [{ factKey: "a", factText: "b" }],
      scenes: [],
    }) + "\n```");

    const result = await distillRunMemory(
      { repo, provider, model: "moonshot-v1-8k", apiKey: "fake", apiBaseUrl: "http://localhost" },
      input,
    );

    assert.ok(result.success, "distill should succeed from markdown code block");
  });
});
