const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`invalid_json_response: ${url} -> ${text}`);
  }
  return { status: response.status, body };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const parsed = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    parsed[key] = value;
  }
  return parsed;
}

function resolveJwtSecret(projectRoot) {
  const apiEnv = parseEnvFile(path.resolve(projectRoot, "apps/api/.env.local"));
  if (apiEnv.JWT_SECRET) return apiEnv.JWT_SECRET;
  const rootEnv = parseEnvFile(path.resolve(projectRoot, ".env.local"));
  if (rootEnv.JWT_SECRET) return rootEnv.JWT_SECRET;
  return "dev-jwt-secret-change-me";
}

// S1（2026-08-25）：users 域已切 PG（requireAuth 从 PG 重查），config/auth/users.json
// 已移出 git 跟踪并归档。auth context 改从 PG 读取：优先 process.env.DATABASE_URL，
// 本地手动运行（node scripts/...）时回退 apps/api/.env.local / apps/api/.env。
function resolveDatabaseUrl(projectRoot) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const envPath of [
    path.resolve(projectRoot, "apps/api/.env.local"),
    path.resolve(projectRoot, "apps/api/.env"),
    path.resolve(projectRoot, ".env.local")
  ]) {
    const parsed = parseEnvFile(envPath);
    if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  }
  return null;
}

async function loadActiveUser(projectRoot) {
  const connectionString = resolveDatabaseUrl(projectRoot);
  if (!connectionString) {
    throw new Error("database_url_missing: 设置 DATABASE_URL（env 或 apps/api/.env.local）");
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT user_id AS id, username, role FROM users WHERE status = 'active' ORDER BY created_at ASC LIMIT 1"
    );
    if (rows.length > 0) return rows[0];
    // CI 上 PG users 表为空（db:migrate 只建表不播种）：seed 固定集成测试用户。
    const bcrypt = require("bcryptjs");
    const { rows: inserted } = await client.query(
      `INSERT INTO users (user_id, username, password_hash, role, business_role, status, created_at)
       VALUES ($1, 'itest-admin', $2, 'admin', 'admin', 'active', now())
       ON CONFLICT (username) DO NOTHING
       RETURNING user_id AS id, username, role`,
      [randomUUID(), bcrypt.hashSync("ItestAdmin123!", 10)]
    );
    if (inserted.length > 0) return inserted[0];
    const { rows: existing } = await client.query(
      "SELECT user_id AS id, username, role FROM users WHERE username = 'itest-admin'"
    );
    return existing[0] || null;
  } finally {
    await client.end();
  }
}

async function buildAuthContext(projectRoot) {
  const activeUser = await loadActiveUser(projectRoot);
  if (!activeUser) {
    throw new Error("active_user_missing: PG users 表无 active 记录且 seed 失败");
  }

  const secret = resolveJwtSecret(projectRoot);
  const token = jwt.sign(
    {
      sub: activeUser.id,
      username: activeUser.username,
      role: activeUser.role === "admin" ? "admin" : "user"
    },
    secret,
    { expiresIn: "8h" }
  );

  return {
    token,
    role: activeUser.role === "admin" ? "admin" : "user"
  };
}

async function waitForServerReady(baseUrl, maxRetry = 40) {
  // W5-D 之后 /health 移到根路径（无 /api/v1 前缀），方便 LB/Docker 探活
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const { status } = await requestJson(`${baseUrl}/health`);
      if (status === 200) {
        return;
      }
    } catch (_err) {
      // Retry until server is up.
    }
    await sleep(500);
  }
  throw new Error("api_server_not_ready");
}

function stopProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (_err) {
    try {
      child.kill("SIGTERM");
    } catch (_killErr) {
      // Best-effort cleanup for integration subprocesses.
    }
  }
}

async function run() {
  const projectRoot = process.cwd();
  const auth = await buildAuthContext(projectRoot);
  const authHeaders = {
    Authorization: `Bearer ${auth.token}`
  };

  const port = 3021;
  const baseUrl = `http://localhost:${port}`;
  const apiProcess = spawn("npm", ["run", "dev:api"], {
    env: { ...process.env, PORT: String(port) },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  apiProcess.stdout.on("data", (_chunk) => {
    // Keep quiet by default; failure cases throw with details.
  });
  apiProcess.stderr.on("data", (_chunk) => {
    // Keep quiet by default.
  });

  try {
    await waitForServerReady(baseUrl);

    const health = await requestJson(`${baseUrl}/health`);
    assert(health.status === 200, "health_status_not_200");
    assert(health.body.status === "ok", "health_status_not_ok");

    const templates = await requestJson(`${baseUrl}/api/v1/templates`, {
      headers: authHeaders
    });
    assert(templates.status === 200, "templates_status_not_200");
    const templateId = templates.body?.data?.list?.[0]?.templateId;
    assert(templateId, "template_id_missing");

    const templateDetail = await requestJson(`${baseUrl}/api/v1/templates/${templateId}`, {
      headers: authHeaders
    });
    assert(templateDetail.status === 200, "template_detail_status_not_200");
    const templateItems = Array.isArray(templateDetail.body?.data?.items) ? templateDetail.body.data.items : [];
    const itemId = templateItems[0]?.templateItemId;
    assert(itemId, "template_item_missing");
    const requestItems = templateItems.map((item, index) => ({
      templateItemId: item.templateItemId,
      included: index === 0
    }));

    const ruleSet = await requestJson(`${baseUrl}/api/v1/rule-sets/active`, {
      headers: authHeaders
    });
    assert(ruleSet.status === 200, "ruleset_status_not_200");
    const ruleSetId = ruleSet.body?.data?.ruleSetId;
    assert(ruleSetId, "ruleset_id_missing");

    const calcPayload = {
      templateId,
      ruleSetId,
      userCount: 51,
      difficultyFactor: 0.1,
      orgCount: 2,
      orgSimilarityFactor: 0.6,
      items: requestItems
    };
    const calc = await requestJson(`${baseUrl}/api/v1/estimates/calculate`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(calcPayload)
    });
    assert(calc.status === 200, `calculate_status_not_200: ${JSON.stringify(calc.body)}`);
    assert(typeof calc.body?.data?.totalDays === "number", "calculate_total_missing");

    const invalidCalc = await requestJson(`${baseUrl}/api/v1/estimates/calculate`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ...calcPayload, items: [] })
    });
    assert(invalidCalc.status === 400, "invalid_calculate_status_not_400");
    assert(invalidCalc.body?.code === 42201, "invalid_calculate_code_mismatch");

    const sessionStart = await requestJson(`${baseUrl}/api/v1/sessions/start`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, ruleSetId })
    });
    assert(sessionStart.status === 200, "session_start_status_not_200");
    const sessionId = sessionStart.body?.data?.sessionId;
    assert(sessionId, "session_id_missing");
    const sessionCalc = await requestJson(`${baseUrl}/api/v1/sessions/${sessionId}/calculate`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        userCount: 51,
        difficultyFactor: 0.1,
        orgCount: 2,
        orgSimilarityFactor: 0.6,
        items: requestItems
      })
    });
    assert(sessionCalc.status === 200, "session_calculate_status_not_200");
    assert(sessionCalc.body?.data?.sessionId === sessionId, "session_calculate_id_mismatch");

    const idempotencyKey = `itest-${Date.now()}`;
    const export1 = await requestJson(`${baseUrl}/api/v1/estimates/export/excel`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(calcPayload)
    });
    const export2 = await requestJson(`${baseUrl}/api/v1/estimates/export/excel`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(calcPayload)
    });
    assert(export1.status === 200 && export2.status === 200, "export_status_not_200");
    assert(
      export1.body?.data?.downloadUrl && export1.body?.data?.downloadUrl === export2.body?.data?.downloadUrl,
      "idempotency_replay_failed"
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "health",
            "template_list_detail",
            "rule_set_active",
            "calculate_success",
            "calculate_validation_error",
            "session_start_and_calculate",
            "export_idempotency_replay"
          ]
        },
        null,
        2
      )
    );
  } finally {
    stopProcessTree(apiProcess);
    await sleep(300);
  }
}

run().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
