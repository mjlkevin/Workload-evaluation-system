const { spawn } = require("node:child_process");

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

    const templates = await requestJson(`${baseUrl}/api/v1/templates`);
    assert(templates.status === 200, "templates_status_not_200");
    const templateId = templates.body?.data?.list?.[0]?.templateId;
    assert(templateId, "template_id_missing");

    const templateDetail = await requestJson(`${baseUrl}/api/v1/templates/${templateId}`);
    assert(templateDetail.status === 200, "template_detail_status_not_200");
    const itemId = templateDetail.body?.data?.items?.[0]?.templateItemId;
    assert(itemId, "template_item_missing");

    const ruleSet = await requestJson(`${baseUrl}/api/v1/rule-sets/active`);
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
      items: [{ templateItemId: itemId, included: true }]
    };
    const calc = await requestJson(`${baseUrl}/api/v1/estimates/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calcPayload)
    });
    assert(calc.status === 200, "calculate_status_not_200");
    assert(typeof calc.body?.data?.totalDays === "number", "calculate_total_missing");

    const invalidCalc = await requestJson(`${baseUrl}/api/v1/estimates/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...calcPayload, items: [] })
    });
    assert(invalidCalc.status === 400, "invalid_calculate_status_not_400");
    assert(invalidCalc.body?.code === 42201, "invalid_calculate_code_mismatch");

    const sessionStart = await requestJson(`${baseUrl}/api/v1/sessions/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, ruleSetId })
    });
    assert(sessionStart.status === 200, "session_start_status_not_200");
    const sessionId = sessionStart.body?.data?.sessionId;
    assert(sessionId, "session_id_missing");
    const sessionCalc = await requestJson(`${baseUrl}/api/v1/sessions/${sessionId}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCount: 51,
        difficultyFactor: 0.1,
        orgCount: 2,
        orgSimilarityFactor: 0.6,
        items: [{ templateItemId: itemId, included: true }]
      })
    });
    assert(sessionCalc.status === 200, "session_calculate_status_not_200");
    assert(sessionCalc.body?.data?.sessionId === sessionId, "session_calculate_id_mismatch");

    const forbiddenImport = await requestJson(`${baseUrl}/api/v1/templates/import-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Role": "operator" },
      body: JSON.stringify(templateDetail.body?.data)
    });
    assert(forbiddenImport.status === 400, "forbidden_import_status_not_400");
    assert(forbiddenImport.body?.code === 40301, "forbidden_import_code_mismatch");

    const idempotencyKey = `itest-${Date.now()}`;
    const export1 = await requestJson(`${baseUrl}/api/v1/estimates/export/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(calcPayload)
    });
    const export2 = await requestJson(`${baseUrl}/api/v1/estimates/export/excel`, {
      method: "POST",
      headers: {
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
            "rbac_forbidden_import",
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
