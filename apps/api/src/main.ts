// ============================================================
// API 服务入口 - 仅负责启动应用
// ============================================================

import { createApp } from "./app";
import { config } from "./config/env";

const app = createApp();

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] API docs: http://localhost:${config.port}/api/v1/health`);
});
