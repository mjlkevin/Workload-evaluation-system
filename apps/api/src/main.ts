// ============================================================
// API 服务入口 - 仅负责启动应用
// ============================================================

import { createApp } from "./app";
import { config } from "./config/env";
import { runMigrations } from "./db/migrate";
import { runConfigIntegrityCheck } from "./ops/config-integrity";
import { logger } from "./utils/logger";
import { startHarnessRuntime } from "./modules/harness/harness-boot";
import { createHarnessRuntimeRepository } from "./modules/harness/harness-runtime.repository";
import { isDurableRunsEnabledFromEnv } from "./modules/harness/harness-runtime.usecase";
import { resolveKek, warmCredentialScopes } from "./modules/system/credentials.store";

const shouldRunIntegrityCheck = process.env.CONFIG_INTEGRITY_ON_STARTUP !== "false";
if (shouldRunIntegrityCheck) {
  const integrity = runConfigIntegrityCheck("startup", false);
  if (!integrity.ok) {
    logger.warn(
      { event: "startup", issues: integrity.issues.length },
      `[api] config integrity check found ${integrity.issues.length} issue(s), see logs/data-anomaly-repair.log`
    );
  }
}

async function bootstrap(): Promise<void> {
  // 启动时迁移（事项 7；D13：advisory lock 串行化多副本；D4：失败统一 fail-fast）。
  // 必须在任何 DB 访问（凭据预热 / harness boot / listen）之前完成，
  // 否则空库启动会因表不存在失败。
  await runMigrations().catch((err) => {
    logger.error({ event: "startup", err }, "[api] migration failed, exiting (fail-fast)");
    process.exit(1);
  });

  // KEK 状态验证（仅 warn，不阻塞启动）
  const kek = resolveKek();
  if (!kek) {
    logger.warn(
      { event: "startup" },
      "[api] CREDENTIAL_KEK not configured: model config credential storage unavailable",
    );
  }

  // ISS-2026-08-10-008：启动预热凭据缓存（fire-and-forget，失败降级不阻断启动）。
  // 预热范围 = 内置 kimi scope + 配置中全部供应商 scope（RP-055 多供应商）。
  if (kek) {
    void (async () => {
      try {
        const { loadRequirementSystemConfigStore } = await import("./modules/system/system.repository");
        const { credentialScopeForProvider } = await import("./modules/system/model-providers");
        const store = await loadRequirementSystemConfigStore();
        const scopes = new Set<string>(["kimi"]);
        for (const p of store.active.modelProviders || []) {
          scopes.add(credentialScopeForProvider(p.id));
        }
        const warmed = await warmCredentialScopes(Array.from(scopes));
        if (warmed.length > 0) {
          logger.info(
            { event: "startup", warmedScopes: warmed.length },
            `[api] credential cache warmed for ${warmed.length} scope(s)`,
          );
        }
      } catch {
        logger.warn({ event: "startup" }, "[api] credential cache warm skipped (store or DB unavailable)");
      }
    })();
  }

  const app = createApp();

  // RP-047 Batch E：Harness Runtime Boot 接线
  const harnessRuntimeRepo = createHarnessRuntimeRepository();
  const durableRunsEnabled = isDurableRunsEnabledFromEnv();
  const harnessRuntime = startHarnessRuntime({
    repo: harnessRuntimeRepo,
    enabled: durableRunsEnabled,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      { event: "startup", port: config.port, harnessEnabled: durableRunsEnabled },
      `[api] listening on http://localhost:${config.port}`
    );
    logger.info(
      { event: "startup", healthUrl: `http://localhost:${config.port}/health` },
      `[api] health check: http://localhost:${config.port}/health`
    );
  });

  // 优雅停机：SIGTERM/SIGINT 时先停 runtime 再关 server
  async function gracefulShutdown(signal: string) {
    logger.info({ event: "shutdown", signal }, `[api] received ${signal}, shutting down gracefully`);
    await harnessRuntime.stop();
    server.close(() => {
      logger.info({ event: "shutdown" }, "[api] server closed");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

void bootstrap();
