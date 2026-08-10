// ============================================================
// API 服务入口 - 仅负责启动应用
// ============================================================

import { createApp } from "./app";
import { config } from "./config/env";
import { runConfigIntegrityCheck } from "./ops/config-integrity";
import { logger } from "./utils/logger";
import { startHarnessRuntime } from "./modules/harness/harness-boot";
import { createHarnessRuntimeRepository } from "./modules/harness/harness-runtime.repository";
import { isDurableRunsEnabledFromEnv } from "./modules/harness/harness-runtime.usecase";
import { resolveKek } from "./modules/system/credentials.store";

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

// KEK 状态验证（仅 warn，不阻塞启动）
const kek = resolveKek();
if (!kek) {
  logger.warn(
    { event: "startup" },
    "[api] CREDENTIAL_KEK not configured: model config credential storage unavailable",
  );
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
