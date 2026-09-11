// ============================================================
// 测试夹具：驱动一轮**真实**工作台对话（批次 2b-3 抽为可复用形态）
// ============================================================
// 与 workbench-conversation-events.e2e.test.ts 里那个 driveTurn 同一装配，只把
// 「库连接 / 用户 / 会话 / 正文 / 分片」参数化，供后续批次的端到端用例复用——
// 2b-1 / 2b-2 那两个 e2e 文件保持原样不动（它们是已交付判据的冻结证据，
// 换装配会把它们的结论一起带走）。
//
// 刻意不 mock 的部分（mock 了就等于验自己）：
//  · 提交口用真实 usecase `createAiRunsUsecase.submitRun`（HTTP POST /runs 的同一落库口），
//    所以 user/message 是在**真入队事务**里落的，不是测试替身补的；
//  · 执行用真实 boot 装配 + 真实 worker + 真实 repository（真库 postgres）；
//  · 会话读写用真实 ai-sessions 仓储——批次 2b-3 之后，「读取口换源」这一步正发生在
//    这条真实读路径上，mock 掉它就等于把被测对象换掉了。
// 只替换最外层的模型 provider（fake 流式），否则判据依赖外部模型服务、不可重跑。

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { createHarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessWorkflowRegistry } from "../modules/harness/harness-runtime.worker";
import { startHarnessRuntime } from "../modules/harness/harness-boot";
import { createAiRunsUsecase } from "../modules/harness/harness-runtime.usecase";
import { getAiSession } from "../modules/ai-sessions/ai-sessions.usecase";
import type { AuthUser } from "../types";

export type DriveWorkbenchTurnInput = {
  databaseUrl: string;
  owner: AuthUser;
  sessionId: string;
  content: string;
  /** 本轮模型实发的流式分片；拼接结果即答复正文 */
  deltas: string[];
  attachments?: Array<{ name: string; size?: number; type?: string; parsedSummary?: string }>;
  /** submissionKey 前缀，便于在事件表里按批辨认夹具 */
  submissionPrefix?: string;
  /** 拿到 runId 的第一时间回调（用例据此登记清理，异常路径也不漏） */
  onRunCreated?: (runId: string) => void;
};

/**
 * 真 usecase 提交 → 真 boot + 真 worker → 真库落 Run、事件与会话消息。
 * 返回本轮 runId 与预期答复正文。
 */
export async function driveWorkbenchTurn(input: DriveWorkbenchTurnInput): Promise<{ runId: string; answer: string }> {
  const phasePool = new Pool({ connectionString: input.databaseUrl, max: 6 });
  const phaseDb = drizzle(phasePool);
  const phaseRepo = createHarnessRuntimeRepository(phaseDb);
  const answer = input.deltas.join("");

  try {
    const usecase = createAiRunsUsecase({
      repo: phaseRepo,
      enabled: true,
      findSession: (user: AuthUser, sessionId: string) => getAiSession(user, sessionId),
    });
    const submitted = await usecase.submitRun(input.owner, input.sessionId, {
      submissionKey: `${input.submissionPrefix ?? "b2b3"}-${randomUUID()}`,
      content: input.content,
      ...(input.attachments ? { attachments: input.attachments } : {}),
    });
    if (submitted.status !== 202) {
      throw new Error(`提交未成功（status=${submitted.status}）：${JSON.stringify(submitted).slice(0, 200)}`);
    }
    const runId = submitted.data.runId;
    input.onRunCreated?.(runId);

    let modelTurns = 0;
    const fakeProvider = {
      name: "kimi",
      defaultModel: "kimi-b2b3",
      isAvailable: () => true,
      chatCompletion: async () => {
        throw new Error("chatCompletion_should_not_be_called");
      },
      streamChatCompletion: () => {
        modelTurns += 1;
        return (async function* () {
          for (const delta of input.deltas) {
            yield { contentDelta: delta, model: "kimi-b2b3", finishReason: "stop" };
          }
        })();
      },
    };

    let bootError: unknown = null;
    const runtime = startHarnessRuntime({
      repo: phaseRepo,
      enabled: true,
      resolveApiKey: () => ({ apiKey: "placeholder" }),
      getProvider: () => fakeProvider as never,
      resolveScenario: async () => ({
        model: "kimi-b2b3",
        baseUrl: "https://b2b3.invalid/v1",
        credentialScope: "requirement_kimi",
        timeoutMs: 5_000,
        modelSource: "env_default",
      }),
      createModelChat: () => async () => ({
        answer: "本用例不参与模型二次分类",
        rawContent: "本用例不参与模型二次分类",
        provider: "stub",
        model: "stub",
        attempts: 1,
        finishReason: "stop",
      }),
      toolCallProgressIntervalMs: 0,
      createWorker: ({ registry }) => ({
        start: async () => {
          try {
            const worker = createHarnessRuntimeWorker({
              repository: phaseRepo,
              registry: registry as HarnessWorkflowRegistry,
              workerId: `b2b3-${randomUUID().slice(0, 8)}`,
              timing: { claimPollIntervalMs: 10, leaseMs: 5_000, heartbeatIntervalMs: 2_000, concurrency: 1 },
            });
            for (let i = 0; i < 10; i += 1) {
              if (!(await worker.runNextAttempt())) break;
            }
          } catch (err) {
            bootError = err;
          }
        },
        stop: async () => {},
        runNextAttempt: async () => false,
        isStopping: () => false,
      }),
    });
    await runtime.stop();
    if (bootError) {
      throw new Error(`驱动一轮真实对话不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    }
    if (modelTurns < 1) {
      throw new Error("provider 必须真的被调用（否则这一轮是空跑）");
    }
    return { runId, answer };
  } finally {
    await phasePool.end();
  }
}
