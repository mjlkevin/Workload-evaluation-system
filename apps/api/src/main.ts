// ============================================================
// API 服务入口 - 仅负责启动应用
// ============================================================

import { createApp } from "./app";
import { config } from "./config/env";
import { runConfigIntegrityCheck } from "./ops/config-integrity";

const shouldRunIntegrityCheck = process.env.CONFIG_INTEGRITY_ON_STARTUP !== "false";
if (shouldRunIntegrityCheck) {
  const integrity = runConfigIntegrityCheck("startup", false);
  if (!integrity.ok) {
    console.warn(
      `[api] config integrity check found ${integrity.issues.length} issue(s), see logs/data-anomaly-repair.log`
    );
  }
}

const app = createApp();

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] API docs: http://localhost:${config.port}/api/v1/health`);
});
