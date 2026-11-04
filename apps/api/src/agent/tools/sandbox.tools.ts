import type { AgentTool } from "../agent.types";
import type { RuntimeContext } from "../context/context.types";
import {
  SandboxError,
  type SandboxScope,
} from "../../modules/harness/sandbox/sandbox.types";
function scope(runtime?: RuntimeContext): SandboxScope {
  if (
    !runtime?.harnessRunId ||
    !runtime.aiSessionId ||
    !runtime.harnessAttemptId ||
    !runtime.toolStepKey ||
    !Number.isSafeInteger(runtime.toolOrdinal) ||
    runtime.toolOrdinal! < 1
  )
    throw new SandboxError(
      "SANDBOX_HOST_REQUIRED",
      "沙箱仅支持持久工作台任务，不能直接执行",
      403,
    );
  return {
    ownerId: runtime.actor.userId,
    sessionId: runtime.aiSessionId,
    runId: runtime.harnessRunId,
    attemptId: runtime.harnessAttemptId,
    ordinal: runtime.toolOrdinal!,
    stepKey: runtime.toolStepKey,
    signal: runtime.abortSignal,
  };
}
export function buildSandboxTool(
  options: {
    service?: Pick<
      ReturnType<
        typeof import("../../modules/harness/sandbox/sandbox.service").createSandboxService
      >,
      "prepare" | "execute"
    >;
  } = {},
): AgentTool {
  return {
    name: "sandbox_execute",
    description:
      "在受控云沙箱运行Python或Node代码，生成HTML/Word(docx)/Excel(xlsx)文件。只有用户明确要求处理或生成文件才调用，问用途应直接介绍。inputs.sourceId必须来自系统材料目录，材料以指定文件名进入任务目录。输出必须为真实文件；代码和材料外发须逐次确认。无需文件的文字问答直接回复。不要联网或安装依赖；可用Python标准库zipfile生成OOXML。",
    capability: "estimates:read",
    mutates: false,
    exfiltrates: true,
    sandboxReadSafe: false,
    category: "documents",
    discoverable: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "language", "code", "inputs", "outputs"],
      properties: {
        title: { type: "string", maxLength: 160 },
        language: { enum: ["python", "node"] },
        code: { type: "string", maxLength: 131072 },
        inputs: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sourceId", "name"],
            properties: {
              sourceId: { type: "string" },
              name: { type: "string" },
            },
          },
        },
        outputs: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "format", "title"],
            properties: {
              path: { type: "string" },
              format: { enum: ["html", "docx", "xlsx"] },
              title: { type: "string" },
            },
          },
        },
      },
    },
    async prepareForApproval(args, user, runtime) {
      if (user.id !== runtime?.actor.userId)
        throw new SandboxError(
          "SANDBOX_HOST_REQUIRED",
          "当前执行身份无效",
          403,
        );
      try {
        return await (
          options.service ??
          (await import("../../modules/harness/sandbox/sandbox.module"))
            .sandboxService
        ).prepare(scope(runtime), args);
      } catch (e) {
        if (e instanceof SandboxError) throw e;
        throw new SandboxError(
          "SANDBOX_UNAVAILABLE",
          "沙箱暂不可用，请联系管理员",
          503,
        );
      }
    },
    async execute(args, user, runtime) {
      if (user.id !== runtime?.actor.userId)
        throw new SandboxError(
          "SANDBOX_HOST_REQUIRED",
          "当前执行身份无效",
          403,
        );
      try {
        return await (
          options.service ??
          (await import("../../modules/harness/sandbox/sandbox.module"))
            .sandboxService
        ).execute(scope(runtime), args);
      } catch (e) {
        if (e instanceof SandboxError) throw e;
        throw new SandboxError(
          "SANDBOX_UNAVAILABLE",
          "沙箱暂不可用，请联系管理员",
          503,
        );
      }
    },
  };
}
