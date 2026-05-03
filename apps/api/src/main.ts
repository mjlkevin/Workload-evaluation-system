// ============================================================
// API 服务入口 - 仅负责启动应用
// ============================================================

import { createApp } from "./app";
import { config } from "./config/env";
import { runConfigIntegrityCheck } from "./ops/config-integrity";
import { logger } from "./utils/logger";

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

const app = createApp();

app.listen(config.port, () => {
  logger.info(
    { event: "startup", port: config.port },
    `[api] listening on http://localhost:${config.port}`
  );
  logger.info(
    { event: "startup", healthUrl: `http://localhost:${config.port}/health` },
    `[api] health check: http://localhost:${config.port}/health`
  );
});
