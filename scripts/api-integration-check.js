const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

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

function buildAuthContext(projectRoot) {
  const usersPath = path.resolve(projectRoot, "config/auth/users.json");
  if (!fs.existsSync(usersPath)) {
    throw new Error("users_store_missing");
  }
  const store = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
  const users = Array.isArray(store?.users) ? store.users : [];
  const activeUser = users.find((x) => x && x.status === "active");
  if (!activeUser) {
    throw new Error("active_user_missing");
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
  for (let i = 0; i < maxRetry; i += 1) {
    try {
      const { status } = await requestJson(`${baseUrl}/api/v1/health`);
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

async function run() {
  const projectRoot = process.cwd();
  const auth = buildAuthContext(projectRoot);
  const authHeaders = {
    Authorization: `Bearer ${auth.token}`
  };

  const port = 3021;
  const baseUrl = `http://localhost:${port}`;
  const apiProcess = spawn("npm", ["run", "dev:api"], {
    env: { ...process.env, PORT: String(port) },
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

    const health = await requestJson(`${baseUrl}/api/v1/health`);
    assert(health.status === 200, "health_status_not_200");
    assert(health.body.code === 0, "health_code_not_0");

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
    apiProcess.kill("SIGTERM");
    await sleep(300);
  }
}

run().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
