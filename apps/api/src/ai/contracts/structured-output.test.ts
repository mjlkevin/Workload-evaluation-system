import test from "node:test";
import assert from "node:assert/strict";

import { ProviderError } from "../provider";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  JsonSchemaResponseFormat,
  ModelProvider,
} from "../provider/model-provider";
import {
  StructuredOutputValidationError,
  parseStructuredOutput,
  runStructuredCompletion,
  type StructuredOutputContract,
} from "./structured-output";

type OkPayload = { ok: boolean };

const OK_CONTRACT: StructuredOutputContract<OkPayload> = {
  id: "test.ok",
  version: "1.0.0",
  name: "TestOk",
  description: "测试结构化输出契约",
  riskTier: "R1",
  schema: {
    type: "object",
    required: ["ok"],
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", description: "是否成功" },
    },
  },
};

class QueueProvider implements ModelProvider {
  readonly name = "stub";
  readonly defaultModel = "stub-model";
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly queue: Array<string | Error>) {}

  isAvailable(): boolean {
    return true;
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    const content = String(next ?? "");
    return {
      content,
      rawContent: content,
      model: this.defaultModel,
      provider: this.name,
      attempts: 1,
      finishReason: "stop",
    };
  }
}

function request(): ChatCompletionRequest {
  return {
    model: "stub-model",
    messages: [
      { role: "system", content: "只输出 JSON" },
      { role: "user", content: "返回结果" },
    ],
  };
}

test("runStructuredCompletion: 首次调用使用 strict json_schema 并返回契约元数据", async () => {
  const provider = new QueueProvider(['{"ok":true}']);

  const result = await runStructuredCompletion({
    provider,
    contract: OK_CONTRACT,
    request: request(),
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.contractId, "test.ok");
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.responseFormat, "json_schema");
  assert.equal(result.outputAttempts, 1);
  assert.equal(result.repairAttempts, 0);
  const format = provider.requests[0].responseFormat as JsonSchemaResponseFormat;
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, "TestOk");
  assert.deepEqual(format.json_schema.schema, OK_CONTRACT.schema);
});

test("runStructuredCompletion: Ajv 校验失败后回注字段路径并只修复一次", async () => {
  const provider = new QueueProvider(['{"ok":"yes"}', '{"ok":true}']);

  const result = await runStructuredCompletion({
    provider,
    contract: OK_CONTRACT,
    request: request(),
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(result.outputAttempts, 2);
  assert.equal(result.repairAttempts, 1);
  assert.equal(provider.requests.length, 2);
  const repairMessage = provider.requests[1].messages.at(-1);
  assert.equal(repairMessage?.role, "user");
  assert.match(repairMessage?.content || "", /\/ok/);
  assert.match(repairMessage?.content || "", /boolean/);
});

test("runStructuredCompletion: 只有明确不支持 json_schema 时才回退 json_object", async () => {
  const provider = new QueueProvider([
    new ProviderError("bad_request", "response_format json_schema is not supported", {
      status: 400,
      legacyReason: "response_format json_schema is not supported",
    }),
    '{"ok":true}',
  ]);

  const result = await runStructuredCompletion({
    provider,
    contract: OK_CONTRACT,
    request: request(),
  });

  assert.equal(result.responseFormat, "json_object");
  assert.equal(result.fallbackReason, "provider_json_schema_unsupported");
  assert.equal(result.outputAttempts, 1);
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[1].responseFormat, "json_object");
});

test("runStructuredCompletion: 鉴权错误不做格式回退或输出修复", async () => {
  const provider = new QueueProvider([
    new ProviderError("auth_failed", "auth failed", { status: 401 }),
    '{"ok":true}',
  ]);

  await assert.rejects(
    () => runStructuredCompletion({ provider, contract: OK_CONTRACT, request: request() }),
    (error) => error instanceof ProviderError && error.code === "auth_failed",
  );
  assert.equal(provider.requests.length, 1);
});

test("parseStructuredOutput: 最终结构错误包含可机器读取的 Ajv issues", () => {
  assert.throws(
    () => parseStructuredOutput(OK_CONTRACT, '{"ok":"yes"}'),
    (error) => {
      assert.ok(error instanceof StructuredOutputValidationError);
      assert.equal(error.contractId, "test.ok");
      assert.equal(error.issues[0].path, "/ok");
      assert.equal(error.issues[0].keyword, "type");
      return true;
    },
  );
});
