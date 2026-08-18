import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { modelVerifyStatusPath } from "../../utils";
import {
  buildEffectiveModelConfig,
  loadModelVerifyStatus,
  resolveScenarioModel,
  saveScenarioVerifyRecord,
  type CredentialsHealth,
} from "./system-effective";
import type { RequirementSystemConfig } from "../../types";

const ENV_MODEL = "kimi-k2.5-env";

function makeActive(overrides: Partial<RequirementSystemConfig> = {}): RequirementSystemConfig {
  return {
    kimiEvaluation: {
      enabled: true,
      model: "kimi-k2.6",
      temperature: 0.3,
      maxTokens: 4000,
      timeoutMs: 120000,
      fallbackToRule: true,
      promptProfile: "default",
      promptTemplate: "tpl",
    },
    fileParsing: {
      enabled: true,
      model: "kimi-k2.6",
      allowedExtensions: [".xlsx"],
      maxFileSizeMb: 20,
      maxSheetCount: 20,
      strictMode: false,
      ocrEnabled: false,
    },
    kimiGeneration: {
      enabled: true,
      model: "kimi-k3",
      temperature: 0.5,
      maxTokens: 6000,
      outputStyle: "balanced",
      includeRiskHints: true,
      includeAssumptions: true,
    },
    kimiCredentials: { apiKey: "" },
    ...overrides,
  } as RequirementSystemConfig;
}

const healthyCredentials: CredentialsHealth = {
  configured: true,
  source: "store",
  kekReady: true,
  lastAudit: { action: "set", actor: "kevin", at: "2026-08-10T13:00:00.000Z" },
};

// T2：场景模型解析——评估场景以 kimiEvaluation.model 为准
test("T2 resolveScenarioModel: assessment 以 kimiEvaluation.model 为准，source=ui", () => {
  const r = resolveScenarioModel(makeActive(), "assessment", ENV_MODEL);
  assert.equal(r.model, "kimi-k2.6");
  assert.equal(r.source, "ui");
});

test("T2 resolveScenarioModel: fileParsing 自身模型为空时回退评估模型，source=evaluation_fallback", () => {
  const active = makeActive();
  active.fileParsing.model = "";
  const r = resolveScenarioModel(active, "fileParsing", ENV_MODEL);
  assert.equal(r.model, "kimi-k2.6");
  assert.equal(r.source, "evaluation_fallback");
});

test("T2 resolveScenarioModel: 全空时回退 env，source=env_fallback", () => {
  const active = makeActive();
  active.kimiEvaluation.model = "";
  const r = resolveScenarioModel(active, "assessment", ENV_MODEL);
  assert.equal(r.model, ENV_MODEL);
  assert.equal(r.source, "env_fallback");
});

// T2：生效配置装配——生成场景未接线（wired=false），评估 wiredParams 不含 temperature（链路硬编码 0.1）
test("T2 buildEffectiveModelConfig: 生成场景 wired=false 且 wiredParams 为空", () => {
  const effective = buildEffectiveModelConfig(makeActive(), ENV_MODEL, healthyCredentials, {});
  const generation = effective.scenarios.find((s) => s.key === "generation");
  assert.ok(generation, "应包含 generation 场景");
  assert.equal(generation!.wired, false);
  assert.deepEqual(generation!.wiredParams, []);
  assert.ok(generation!.notes.some((n) => n.includes("规划中")), "notes 应说明场景规划中");
});

test("T2 buildEffectiveModelConfig: 评估场景 wiredParams 不含 temperature，notes 如实说明", () => {
  const effective = buildEffectiveModelConfig(makeActive(), ENV_MODEL, healthyCredentials, {});
  const assessment = effective.scenarios.find((s) => s.key === "assessment");
  assert.ok(assessment);
  assert.equal(assessment!.wired, true);
  assert.ok(!assessment!.wiredParams.includes("temperature"), "temperature 当前不接线，不得出现在 wiredParams");
  assert.ok(assessment!.wiredParams.includes("maxTokens"));
  assert.ok(assessment!.wiredParams.includes("timeoutMs"));
  assert.ok(assessment!.notes.some((n) => n.includes("temperature")), "notes 应说明 temperature 暂不生效");
});

test("T2 buildEffectiveModelConfig: K2 模型附加平台固定采样说明；凭据健康透传", () => {
  const effective = buildEffectiveModelConfig(makeActive(), ENV_MODEL, healthyCredentials, {});
  const assessment = effective.scenarios.find((s) => s.key === "assessment");
  assert.ok(assessment!.notes.some((n) => n.includes("固定")), "K2 模型应提示平台固定采样");
  assert.equal(effective.credentials.configured, true);
  assert.equal(effective.credentials.kekReady, true);
  assert.equal(effective.credentials.lastAudit?.actor, "kevin");
});

// T2/T4：验证状态存储——按场景持久化最近验证结果
test("T2 verify status store: saveScenarioVerifyRecord 与 loadModelVerifyStatus 往返一致", async () => {
  const storePath = modelVerifyStatusPath();
  const existed = fs.existsSync(storePath);
  const before = existed ? fs.readFileSync(storePath, "utf-8") : "";
  try {
    await saveScenarioVerifyRecord("assessment", {
      at: "2026-08-10T14:00:00.000Z",
      ok: true,
      model: "kimi-k2.6",
      elapsedMs: 1234,
    });
    const loaded = await loadModelVerifyStatus();
    assert.equal(loaded.assessment?.ok, true);
    assert.equal(loaded.assessment?.model, "kimi-k2.6");
    assert.equal(loaded.assessment?.elapsedMs, 1234);

    await saveScenarioVerifyRecord("fileParsing", {
      at: "2026-08-10T14:01:00.000Z",
      ok: false,
      model: "kimi-k2.6",
      elapsedMs: 30000,
      reason: "timeout",
    });
    const loaded2 = await loadModelVerifyStatus();
    assert.equal(loaded2.assessment?.ok, true, "其他场景记录应保留");
    assert.equal(loaded2.fileParsing?.ok, false);
    assert.equal(loaded2.fileParsing?.reason, "timeout");
  } finally {
    if (existed) {
      fs.writeFileSync(storePath, before, "utf-8");
    } else if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
  }
});
