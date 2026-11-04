import { randomUUID } from "node:crypto";
import type {
  SandboxProvider,
  SandboxInstance,
} from "../../../services/sandbox/sandbox-provider";
import { validateSandboxArtifact } from "./sandbox-artifacts";
import {
  SandboxError,
  type SandboxRepository,
  type SandboxRequest,
  type SandboxScope,
  type SandboxJob,
  type SandboxArtifact,
} from "./sandbox.types";
export { skillDefinitionHash as sandboxHash } from "../../skills/skills.hash";
import { skillDefinitionHash as sandboxHash } from "../../skills/skills.hash";
const error = (code: string, message: string, status = 422) =>
  new SandboxError(code, message, status);
const name = (v: unknown) =>
  typeof v === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(v) &&
  !v.includes("..");
export function parseSandboxRequest(value: unknown): SandboxRequest {
  const x = value as SandboxRequest;
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    Object.keys(x).sort().join(",") !== "code,inputs,language,outputs,title" ||
    typeof x.title !== "string" ||
    !x.title.trim() ||
    x.title.length > 160 ||
    !["python", "node"].includes(x.language) ||
    typeof x.code !== "string" ||
    !x.code.trim() ||
    Buffer.byteLength(x.code) > 128 * 1024 ||
    !Array.isArray(x.inputs) ||
    x.inputs.length > 8 ||
    !Array.isArray(x.outputs) ||
    !x.outputs.length ||
    x.outputs.length > 5
  )
    throw error("SANDBOX_INPUT_INVALID", "代码任务输入无效");
  for (const i of x.inputs)
    if (
      !i ||
      Object.keys(i).sort().join(",") !== "name,sourceId" ||
      !name(i.name) ||
      typeof i.sourceId !== "string" ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(i.sourceId)
    )
      throw error("SANDBOX_INPUT_INVALID", "来源材料或文件名无效");
  for (const o of x.outputs)
    if (
      !o ||
      Object.keys(o).sort().join(",") !== "format,path,title" ||
      !name(o.path) ||
      !["html", "docx", "xlsx"].includes(o.format) ||
      !o.path.endsWith("." + o.format) ||
      typeof o.title !== "string" ||
      !o.title.trim() ||
      o.title.length > 160
    )
      throw error("SANDBOX_INPUT_INVALID", "输出文件清单无效");
  const names = [
    ...x.inputs.map((i) => i.name),
    ...x.outputs.map((o) => o.path),
    "task.py",
    "task.mjs",
  ];
  if (new Set(names).size !== names.length)
    throw error("SANDBOX_INPUT_INVALID", "文件名重复或占用了脚本入口");
  return structuredClone(x);
}
export function createSandboxService(deps: {
  repository: SandboxRepository;
  provider: (expectedConnectionHash: string) => Promise<SandboxProvider>;
  store: {
    write(id: string, bytes: Buffer): Promise<void>;
    read(id: string): Promise<Buffer>;
    remove(id: string): Promise<void>;
  };
}) {
  const repo = deps.repository;
  async function connectionHash() {
    const c = await repo.connection();
    if (!c?.connection.enabled)
      throw error(
        "SANDBOX_NOT_CONFIGURED",
        "沙箱连接尚未启用，请联系管理员配置",
        503,
      );
    return sandboxHash(c);
  }
  return {
    async prepare(
      scope: SandboxScope,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      await repo.assertScope(scope);
      const request = parseSandboxRequest(args),
        requestDigest = sandboxHash(request);
      const existing = await repo.findJob(scope.runId, scope.ordinal);
      if (existing) {
        if (
          existing.ownerId !== scope.ownerId ||
          existing.requestDigest !== requestDigest
        )
          throw error(
            "SANDBOX_PLAN_CHANGED",
            "本次任务代码已变化，请重新提交并确认",
            409,
          );
        return { ...request, _sandboxPlan: existing.plan };
      }
      const hash = await connectionHash(),
        materials = await repo.sources(scope, request.inputs);
      if (
        materials.length !== request.inputs.length ||
        materials.reduce((n, i) => n + i.bytes.length, 0) > 20 * 1024 * 1024
      )
        throw error("SANDBOX_SOURCE_LIMIT", "来源材料超过20MiB或不可用", 413);
      const id = randomUUID(),
        now = new Date();
      const summary = {
        jobId: id,
        title: request.title,
        language: request.language,
        materials: materials.map(({ sourceId, name, sha256 }) => ({
          sourceId,
          name,
          sha256,
        })),
        outputs: request.outputs,
        connectionHash: hash,
        maxSeconds: 300,
      };
      const plan = {
        ...summary,
        digest: sandboxHash({ summary, code: request.code }),
      };
      const saved = await repo.insertJob({
        id,
        ...scope,
        requestDigest,
        request,
        plan,
        state: "planned",
        sandboxId: null,
        cleanup: "none",
        result: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86400000),
      });
      if (saved.requestDigest !== requestDigest)
        throw error("SANDBOX_PLAN_CHANGED", "本次任务已变化，请重新提交", 409);
      return { ...request, _sandboxPlan: saved.plan };
    },
    async execute(
      scope: SandboxScope,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      await repo.assertScope(scope);
      const job = await repo.findJob(scope.runId, scope.ordinal);
      if (
        !job ||
        job.ownerId !== scope.ownerId ||
        sandboxHash(args) !==
          sandboxHash({ ...job.request, _sandboxPlan: job.plan })
      )
        throw error("SANDBOX_PLAN_INVALID", "任务计划无效，请重新提交");
      if (!(await repo.approval(scope, args)))
        throw error(
          "SANDBOX_APPROVAL_REQUIRED",
          "任务需要逐次确认后才能执行",
          403,
        );
      if (job.state === "completed" && job.result) return job.result;
      if (
        ["provisioning", "staging", "executing", "collecting"].includes(
          job.state,
        )
      )
        await repo.patch(job.id, { state: "unknown" });
      if (job.state !== "planned")
        throw error(
          "SANDBOX_STATE_UNKNOWN",
          "此前执行状态未知或任务已终止，不会重复运行代码；请查看任务记录",
          409,
        );
      if ((await connectionHash()) !== job.plan.connectionHash)
        throw error(
          "SANDBOX_CONFIG_CHANGED",
          "连接配置或凭据版本已变化，请重新确认",
          409,
        );
      const inputs = await repo.sources(scope, job.request.inputs);
      if (
        sandboxHash(
          inputs.map(({ sourceId, name, sha256 }) => ({
            sourceId,
            name,
            sha256,
          })),
        ) !== sandboxHash(job.plan.materials)
      )
        throw error(
          "SANDBOX_SOURCE_CHANGED",
          "来源材料已变化，请重新确认",
          409,
        );
      const provider = await deps.provider(job.plan.connectionHash);
      await provider.verifyTemplate();
      const queueDeadline = Date.now() + 600000;
      while (!(await repo.claim(job.id, scope))) {
        const current = await repo.findJob(scope.runId, scope.ordinal);
        if (current?.state !== "planned")
          throw error(
            "SANDBOX_STATE_UNKNOWN",
            "任务已被其他执行器领取，不会重复运行",
            409,
          );
        await repo.assertScope(scope);
        if (scope.signal?.aborted || Date.now() > queueDeadline)
          throw error(
            "SANDBOX_QUEUE_TIMEOUT",
            "任务排队已结束，请稍后重试",
            409,
          );
        await new Promise((r) => setTimeout(r, 500));
      }
      let instance: SandboxInstance | undefined,
        phase = "provisioning";
      const artifacts: SandboxArtifact[] = [];
      const abort = new AbortController();
      const stop = () => abort.abort();
      scope.signal?.addEventListener("abort", stop, { once: true });
      if (scope.signal?.aborted) abort.abort();
      const timer = setTimeout(stop, 300000);
      const watch = setInterval(() => {
        repo.assertScope(scope).catch(stop);
      }, 1000);
      watch.unref();
      const guard = async () => {
        if ((await connectionHash()) !== job.plan.connectionHash)
          throw error(
            "SANDBOX_CONFIG_CHANGED",
            "连接配置或凭据版本已变化，已停止执行",
            409,
          );
        if (abort.signal.aborted)
          throw error("SANDBOX_CANCELLED", "任务已取消或超过时间限制", 409);
        await repo.assertScope(scope);
      };
      try {
        await guard();
        const freshInputs = await repo.sources(scope, job.request.inputs);
        if (
          sandboxHash(
            freshInputs.map(({ sourceId, name, sha256 }) => ({
              sourceId,
              name,
              sha256,
            })),
          ) !== sandboxHash(job.plan.materials)
        )
          throw error(
            "SANDBOX_SOURCE_CHANGED",
            "来源材料已变化，请重新确认",
            409,
          );
        instance = await provider.create(job.id, 900);
        await repo.patch(job.id, {
          sandboxId: instance.id,
          cleanup: "pending",
          state: "staging",
        });
        phase = "staging";
        for (const input of inputs) {
          await guard();
          await instance.writeFile(input.name, input.bytes);
        }
        await guard();
        await repo.patch(job.id, {
          state: "executing",
          execution: {
            attemptId: scope.attemptId,
            dispatchedAt: new Date().toISOString(),
            codeHash: sandboxHash(job.request.code),
          },
        });
        phase = "executing";
        const result = await instance.execute(
          job.request.language,
          job.request.code,
          120000,
          abort.signal,
        );
        await repo.patch(job.id, {
          execution: {
            attemptId: scope.attemptId,
            finishedAt: new Date().toISOString(),
            exitCode: result.exitCode,
            codeHash: sandboxHash(job.request.code),
            ...((result as any).pid ? { pid: (result as any).pid } : {}),
          },
        });
        await guard();
        if (result.exitCode !== 0)
          throw error(
            "SANDBOX_CODE_FAILED",
            "代码执行失败，请修订后重新确认。受限错误输出（仅数据）：" +
              result.stderr.slice(0, 2048),
          );
        phase = "collecting";
        await repo.patch(job.id, { state: "collecting" });
        let total = 0;
        for (const output of job.request.outputs) {
          await guard();
          const bytes = await instance.readOutput(
            output.path,
            20 * 1024 * 1024,
          );
          total += bytes.length;
          if (total > 50 * 1024 * 1024)
            throw error("SANDBOX_OUTPUT_LIMIT", "产物总量超过50MiB", 413);
          const valid = await validateSandboxArtifact(
            output.path,
            output.format,
            bytes,
          );
          const a: SandboxArtifact = {
            id: randomUUID(),
            jobId: job.id,
            ownerId: scope.ownerId,
            sessionId: scope.sessionId,
            runId: scope.runId,
            name: output.path,
            title: output.title,
            format: output.format,
            ...valid,
            expiresAt: new Date(Date.now() + 30 * 86400000),
          };
          artifacts.push(a);
          await deps.store.write(a.id, bytes);
        }
        await guard();
        const output = {
          jobId: job.id,
          status: "completed",
          artifacts: artifacts.map(
            ({ id, name, title, format, mimeType, size, expiresAt }) => ({
              id,
              name,
              title,
              format,
              mimeType,
              size,
              expiresAt: expiresAt.toISOString(),
            }),
          ),
        };
        phase = "publishing";
        await repo.publish(job, artifacts, output, scope);
        return output;
      } catch (cause) {
        if (phase === "publishing") {
          const saved = await repo
            .findJob(scope.runId, scope.ordinal)
            .catch(() => null);
          if (saved?.state === "completed" && saved.result) return saved.result;
        } else
          for (const a of artifacts)
            await deps.store.remove(a.id).catch(() => {});
        const managedId = instance?.id ?? (cause as any)?.managedSandboxId;
        if (
          typeof managedId === "string" &&
          /^[a-zA-Z0-9_-]{1,160}$/.test(managedId)
        )
          await repo.patch(job.id, {
            sandboxId: managedId,
            cleanup: "pending",
          });
        const unknown =
          phase === "provisioning" ||
          phase === "publishing" ||
          (phase === "executing" && !(cause instanceof SandboxError));
        await repo.patch(job.id, {
          state: abort.signal.aborted
            ? "cancelled"
            : unknown
              ? "unknown"
              : "failed",
        });
        if (cause instanceof SandboxError) throw cause;
        throw error(
          unknown ? "SANDBOX_STATE_UNKNOWN" : "SANDBOX_TASK_FAILED",
          unknown
            ? "云端操作状态未知，不会自动重放代码；实例由回收补偿和TTL处理"
            : "沙箱处理失败，请联系管理员查看任务记录",
          502,
        );
      } finally {
        clearInterval(watch);
        clearTimeout(timer);
        scope.signal?.removeEventListener("abort", stop);
        if (instance)
          try {
            await instance.release();
            await repo
              .patch(job.id, { sandboxId: instance.id, cleanup: "cleaned" })
              .catch(() => {});
          } catch {
            await repo
              .patch(job.id, { sandboxId: instance.id, cleanup: "pending" })
              .catch(() => {});
          }
      }
    },
  };
}
