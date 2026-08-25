/**
 * Four Assessment Modules End-to-End Regression Test
 * Validates: Presales → Sales Briefing → PM Workbench → Dev Assessment
 * Flow: create → save → version association → export
 * Run: node scripts/four-assessment-regression.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`invalid_json_response: ${url}`);
  }
  return { status: response.status, body, headers: response.headers };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  const parsed = {};
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    parsed[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
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
// 参照 scripts/api-integration-check.js 先例（S1 同批适配）。
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

// 返回 PG users 表全部 active 用户；admin 缺失时自动 seed itest-admin
// （幂等 ON CONFLICT DO NOTHING）。
async function loadActiveUsers(projectRoot) {
  const connectionString = resolveDatabaseUrl(projectRoot);
  if (!connectionString) {
    throw new Error("database_url_missing: 设置 DATABASE_URL（env 或 apps/api/.env.local）");
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT user_id AS id, username, role FROM users WHERE status = 'active' ORDER BY created_at ASC"
    );
    if (!rows.some((u) => u.role === "admin")) {
      const bcrypt = require("bcryptjs");
      await client.query(
        `INSERT INTO users (user_id, username, password_hash, role, business_role, status, created_at)
         VALUES ($1, 'itest-admin', $2, 'admin', 'admin', 'active', now())
         ON CONFLICT (username) DO NOTHING`,
        [randomUUID(), bcrypt.hashSync("ItestAdmin123!", 10)]
      );
      const { rows: refreshed } = await client.query(
        "SELECT user_id AS id, username, role FROM users WHERE status = 'active' ORDER BY created_at ASC"
      );
      return refreshed;
    }
    return rows;
  } finally {
    await client.end();
  }
}

async function buildAuthContext(projectRoot) {
  const users = await loadActiveUsers(projectRoot);
  const adminUser = users.find((x) => x && x.role === "admin");
  assert(adminUser, "no active admin user");

  const secret = resolveJwtSecret(projectRoot);
  const token = jwt.sign(
    { sub: adminUser.id, username: adminUser.username, role: "admin" },
    secret,
    { expiresIn: "8h" }
  );
  return { token, adminUser };
}

function authHeader(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function run() {
  const projectRoot = process.cwd();
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const { token, adminUser } = await buildAuthContext(projectRoot);

  const results = [];
  const pass = (name) => results.push({ name, status: "PASS" });
  const fail = (name, reason) => results.push({ name, status: "FAIL", reason });

  try {
    // === Step 0: Health check ===
    const health = await requestJson(`${baseUrl}/api/v1/health`);
    assert(health.status === 200, "health not 200");
    pass("health_check");

    // === Step 1: Get templates and rules for version creation ===
    const templatesRes = await requestJson(`${baseUrl}/api/v1/templates`, {
      headers: authHeader(token)
    });
    assert(templatesRes.status === 200, `get templates failed: ${JSON.stringify(templatesRes.body)}`);
    const templateList = templatesRes.body.data?.list || templatesRes.body?.data?.templates || [];
    assert(templateList.length > 0, "no templates available");
    const templateId = templateList[0].templateId;
    pass("get_templates");

    const rulesRes = await requestJson(`${baseUrl}/api/v1/rule-sets/active`, {
      headers: authHeader(token)
    });
    assert(rulesRes.status === 200, `get rules failed: ${JSON.stringify(rulesRes.body)}`);
    const ruleSetId = rulesRes.body.data?.ruleSetId;
    assert(ruleSetId, "no active rule set");
    pass("get_active_rules");

    // Get template items for calculate/export
    const templateDetailRes = await requestJson(`${baseUrl}/api/v1/templates/${templateId}`, {
      headers: authHeader(token)
    });
    assert(templateDetailRes.status === 200, `get template detail failed: ${JSON.stringify(templateDetailRes.body)}`);
    const templateItems = templateDetailRes.body?.data?.items || [];
    const requestItems = templateItems.map((item, index) => ({
      templateItemId: item.templateItemId,
      included: index === 0
    }));
    assert(requestItems.length > 0, "no template items available");
    pass("get_template_items");

    // === Step 2: Create a test version ===
    const createVersionRes = await requestJson(`${baseUrl}/api/v1/versions`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        type: "global",
        templateId,
        payload: { customerName: "T5b-Regression-Test", items: [] }
      })
    });
    assert(createVersionRes.status === 200, `create version failed: ${JSON.stringify(createVersionRes.body)}`);
    const versionId = createVersionRes.body.data.record.id;
    const versionCode = createVersionRes.body.data.record.versionCode;
    console.log(`Created version: ${versionId} (${versionCode})`);
    pass("create_test_version");

    // === Step 3: Checkout the version ===
    const checkoutRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkout`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ reason: "T5b regression test" })
    });
    assert(checkoutRes.status === 200, `checkout failed: ${JSON.stringify(checkoutRes.body)}`);
    pass("checkout_version");

    // ========== Module 1: Presales (售前审查) ==========
    console.log("\n--- Module 1: Presales ---");

    // 1.1: Create requirement pack
    const createPackRes = await requestJson(`${baseUrl}/api/v1/presales/requirement-packs`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({})
    });
    assert(createPackRes.status === 201 && createPackRes.body.success, `create requirement pack failed: ${JSON.stringify(createPackRes.body)}`);
    const packId = createPackRes.body.data?.requirementPackId;
    assert(packId, "requirement pack id missing");
    console.log(`Created requirement pack: ${packId}`);
    pass("presales_create_requirement_pack");

    // 1.2: Get requirement pack
    const getPackRes = await requestJson(`${baseUrl}/api/v1/presales/requirement-packs/${packId}`, {
      headers: authHeader(token)
    });
    assert(getPackRes.status === 200 && getPackRes.body.success, `get requirement pack failed: ${JSON.stringify(getPackRes.body)}`);
    pass("presales_get_requirement_pack");

    // 1.3: List requirement packs
    const listPacksRes = await requestJson(`${baseUrl}/api/v1/presales/requirement-packs`, {
      headers: authHeader(token)
    });
    assert(listPacksRes.status === 200 && listPacksRes.body.success, `list requirement packs failed: ${JSON.stringify(listPacksRes.body)}`);
    pass("presales_list_requirement_packs");

    // 1.4: Generate SOW (may depend on AI, accept gracefully)
    const sowRes = await requestJson(`${baseUrl}/api/v1/presales/requirement-packs/${packId}/sow`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({ versionId })
    });
    if (sowRes.status === 200 || sowRes.status === 201) {
      pass("presales_generate_sow");
    } else {
      fail("presales_generate_sow", `status ${sowRes.status}: ${JSON.stringify(sowRes.body)}`);
    }

    // ========== Module 2: Sales Briefing (销售快报) ==========
    console.log("\n--- Module 2: Sales Briefing ---");

    // 2.1: Create sales brief
    const createBriefRes = await requestJson(`${baseUrl}/api/v1/sales/briefs`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        name: "T5b-Regression-Brief",
        customerName: "Test Corp"
      })
    });
    assert(createBriefRes.status === 201 && createBriefRes.body.success, `create brief failed: ${JSON.stringify(createBriefRes.body)}`);
    const briefId = createBriefRes.body.data?.opportunityBriefId;
    assert(briefId, "brief id missing");
    console.log(`Created sales brief: ${briefId}`);
    pass("sales_create_brief");

    // 2.2: Get sales brief
    const getBriefRes = await requestJson(`${baseUrl}/api/v1/sales/briefs/${briefId}`, {
      headers: authHeader(token)
    });
    assert(getBriefRes.status === 200 && getBriefRes.body.success, `get brief failed: ${JSON.stringify(getBriefRes.body)}`);
    pass("sales_get_brief");

    // 2.3: List sales briefs
    const listBriefsRes = await requestJson(`${baseUrl}/api/v1/sales/briefs`, {
      headers: authHeader(token)
    });
    assert(listBriefsRes.status === 200 && listBriefsRes.body.success, `list briefs failed: ${JSON.stringify(listBriefsRes.body)}`);
    pass("sales_list_briefs");

    // 2.4: Update sales brief
    const updateBriefRes = await requestJson(`${baseUrl}/api/v1/sales/briefs/${briefId}`, {
      method: "PATCH",
      headers: authHeader(token),
      body: JSON.stringify({ customerName: "T5b-Updated Corp" })
    });
    assert(updateBriefRes.status === 200 && updateBriefRes.body.success, `update brief failed: ${JSON.stringify(updateBriefRes.body)}`);
    pass("sales_update_brief");

    // 2.5: Generate quote
    const quoteRes = await requestJson(`${baseUrl}/api/v1/sales/briefs/${briefId}/quote`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        phases: [{ name: "Phase 1", minDays: 5, maxDays: 10 }],
        assumptions: ["Test assumption"]
      })
    });
    if (quoteRes.status === 200 && (quoteRes.body.success || quoteRes.body.code === 0)) {
      pass("sales_generate_quote");
    } else {
      fail("sales_generate_quote", `status ${quoteRes.status}: ${JSON.stringify(quoteRes.body)}`);
    }

    // 2.6: Recalculate
    const recalcRes = await requestJson(`${baseUrl}/api/v1/sales/briefs/${briefId}/recalculate`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        changes: [{ field: "userCount", from: 50, to: 100 }]
      })
    });
    if (recalcRes.status === 200) {
      pass("sales_recalculate");
    } else {
      fail("sales_recalculate", `status ${recalcRes.status}: ${JSON.stringify(recalcRes.body)}`);
    }

    // ========== Module 3: PM Workbench (PM 工作台) ==========
    console.log("\n--- Module 3: PM Workbench ---");

    // 3.1: Create handoff
    const createHandoffRes = await requestJson(`${baseUrl}/api/v1/pm/handoffs`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        versionId,
        fromRole: "presales",
        toRole: "pm",
        message: "T5b regression handoff"
      })
    });
    assert(createHandoffRes.status === 201 && createHandoffRes.body.success, `create handoff failed: ${JSON.stringify(createHandoffRes.body)}`);
    const handoffId = createHandoffRes.body.data?.handoffId;
    assert(handoffId, "handoff id missing");
    console.log(`Created handoff: ${handoffId}`);
    pass("pm_create_handoff");

    // 3.2: Get handoff
    const getHandoffRes = await requestJson(`${baseUrl}/api/v1/pm/handoffs/${handoffId}`, {
      headers: authHeader(token)
    });
    assert(getHandoffRes.status === 200 && getHandoffRes.body.success, `get handoff failed: ${JSON.stringify(getHandoffRes.body)}`);
    pass("pm_get_handoff");

    // 3.3: List handoffs
    const listHandoffsRes = await requestJson(`${baseUrl}/api/v1/pm/handoffs?toRole=pm`, {
      headers: authHeader(token)
    });
    assert(listHandoffsRes.status === 200 && listHandoffsRes.body.success, `list handoffs failed: ${JSON.stringify(listHandoffsRes.body)}`);
    pass("pm_list_handoffs");

    // 3.4: Create narrative
    const createNarrativeRes = await requestJson(`${baseUrl}/api/v1/pm/narratives`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        assessmentVersionId: versionId,
        orgAndModules: "T5b regression narrative - org and modules"
      })
    });
    assert(createNarrativeRes.status === 201 && createNarrativeRes.body.success, `create narrative failed: ${JSON.stringify(createNarrativeRes.body)}`);
    const narrativeId = createNarrativeRes.body.data?.narrativeId;
    assert(narrativeId, "narrative id missing");
    console.log(`Created narrative: ${narrativeId}`);
    pass("pm_create_narrative");

    // 3.5: Get narrative by version
    const getNarrativeRes = await requestJson(`${baseUrl}/api/v1/pm/versions/${versionId}/narrative`, {
      headers: authHeader(token)
    });
    assert(getNarrativeRes.status === 200 && getNarrativeRes.body.success, `get narrative by version failed: ${JSON.stringify(getNarrativeRes.body)}`);
    pass("pm_get_narrative_by_version");

    // 3.6: Generate deliverables
    const generateDeliverablesRes = await requestJson(`${baseUrl}/api/v1/pm/deliverables/generate`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        assessmentVersionId: versionId,
        types: ["WBS", "schedule", "resource", "risk"]
      })
    });
    if (generateDeliverablesRes.status === 200 || generateDeliverablesRes.status === 201) {
      if (generateDeliverablesRes.body.success) {
        pass("pm_generate_deliverables");
      } else {
        fail("pm_generate_deliverables", `unexpected body: ${JSON.stringify(generateDeliverablesRes.body)}`);
      }
    } else {
      fail("pm_generate_deliverables", `status ${generateDeliverablesRes.status}: ${JSON.stringify(generateDeliverablesRes.body)}`);
    }

    // 3.7: List deliverables by version
    const listDeliverablesRes = await requestJson(`${baseUrl}/api/v1/pm/versions/${versionId}/deliverables`, {
      headers: authHeader(token)
    });
    if (listDeliverablesRes.status === 200) {
      pass("pm_list_deliverables");
    } else {
      fail("pm_list_deliverables", `status ${listDeliverablesRes.status}: ${JSON.stringify(listDeliverablesRes.body)}`);
    }

    // 3.8: Create review
    const createReviewRes = await requestJson(`${baseUrl}/api/v1/pm/reviews`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        assessmentVersionId: versionId,
        reviewerId: adminUser.id,
        comments: "T5b regression review"
      })
    });
    if (createReviewRes.status === 201 && createReviewRes.body.success) {
      const reviewId = createReviewRes.body.data?.reviewId || createReviewRes.body.data?.id;
      console.log(`Created review: ${reviewId}`);
      pass("pm_create_review");
    } else {
      fail("pm_create_review", `status ${createReviewRes.status}: ${JSON.stringify(createReviewRes.body)}`);
    }

    // 3.9: Create seal
    const createSealRes = await requestJson(`${baseUrl}/api/v1/pm/seal`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        assessmentVersionId: versionId,
        reason: "T5b regression seal"
      })
    });
    if (createSealRes.status === 201 || (createSealRes.status === 200 && createSealRes.body.success)) {
      const sealId = createSealRes.body.data?.sealId || createSealRes.body.data?.id;
      console.log(`Created seal: ${sealId || 'N/A'}`);
      pass("pm_create_seal");
    } else {
      fail("pm_create_seal", `status ${createSealRes.status}: ${JSON.stringify(createSealRes.body)}`);
    }

    // ========== Module 4: Dev Assessment (开发评估) ==========
    console.log("\n--- Module 4: Dev Assessment ---");

    // 4.1: Create dev assessment
    const createDevRes = await requestJson(`${baseUrl}/api/v1/dev-assessments`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        assessmentVersionId: versionId,
        contractMode: "embedded",
        notes: "T5b regression dev assessment"
      })
    });
    assert(createDevRes.status === 201 && createDevRes.body.success, `create dev assessment failed: ${JSON.stringify(createDevRes.body)}`);
    const devId = createDevRes.body.data?.devAssessmentId;
    assert(devId, "dev assessment id missing");
    console.log(`Created dev assessment: ${devId}`);
    pass("dev_create_assessment");

    // 4.2: Get dev assessment
    const getDevRes = await requestJson(`${baseUrl}/api/v1/dev-assessments/${devId}`, {
      headers: authHeader(token)
    });
    assert(getDevRes.status === 200 && getDevRes.body.success, `get dev assessment failed: ${JSON.stringify(getDevRes.body)}`);
    pass("dev_get_assessment");

    // 4.3: List dev assessments
    const listDevRes = await requestJson(`${baseUrl}/api/v1/dev-assessments?assessmentVersionId=${versionId}`, {
      headers: authHeader(token)
    });
    assert(listDevRes.status === 200 && listDevRes.body.success, `list dev assessments failed: ${JSON.stringify(listDevRes.body)}`);
    pass("dev_list_assessments");

    // 4.4: Get dev assessment by version
    const getDevByVerRes = await requestJson(`${baseUrl}/api/v1/dev-assessments/versions/${versionId}/dev-assessment`, {
      headers: authHeader(token)
    });
    assert(getDevByVerRes.status === 200 && getDevByVerRes.body.success, `get dev assessment by version failed: ${JSON.stringify(getDevByVerRes.body)}`);
    pass("dev_get_assessment_by_version");

    // 4.5: Update dev assessment
    const updateDevRes = await requestJson(`${baseUrl}/api/v1/dev-assessments/${devId}`, {
      method: "PATCH",
      headers: authHeader(token),
      body: JSON.stringify({ notes: "T5b regression dev assessment - updated" })
    });
    assert(updateDevRes.status === 200 && updateDevRes.body.success, `update dev assessment failed: ${JSON.stringify(updateDevRes.body)}`);
    pass("dev_update_assessment");

    // ========== Cross-Module: Calculate & Export ==========
    console.log("\n--- Cross-Module: Calculate & Export ---");

    // 5.1: Calculate estimate
    const calcRes = await requestJson(`${baseUrl}/api/v1/estimates/calculate`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        templateId,
        ruleSetId,
        userCount: 51,
        difficultyFactor: 0.1,
        orgCount: 2,
        orgSimilarityFactor: 0.6,
        items: requestItems
      })
    });
    if (calcRes.status === 200) {
      pass("calculate_estimate");
    } else {
      fail("calculate_estimate", `status ${calcRes.status}: ${JSON.stringify(calcRes.body)}`);
    }

    // 5.2: Export
    const exportRes = await requestJson(`${baseUrl}/api/v1/estimates/export/excel`, {
      method: "POST",
      headers: authHeader(token),
      body: JSON.stringify({
        templateId,
        ruleSetId,
        userCount: 51,
        difficultyFactor: 0.1,
        orgCount: 2,
        orgSimilarityFactor: 0.6,
        items: requestItems
      })
    });
    if (exportRes.status === 200 || exportRes.status === 201) {
      pass("export_estimate");
    } else {
      fail("export_estimate", `status ${exportRes.status}: ${JSON.stringify(exportRes.body)}`);
    }

    // ========== Checkin (release lock) ==========
    const checkinRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkin`, {
      method: "POST",
      headers: authHeader(token)
    });
    assert(checkinRes.status === 200, `checkin failed: ${JSON.stringify(checkinRes.body)}`);
    pass("checkin_version");

    // ========== Print results ==========
    console.log("\n=== Four Assessment Module Regression Results ===");
    results.forEach(r => {
      const icon = r.status === "PASS" ? "✅" : "❌";
      console.log(`${icon} ${r.name}${r.reason ? ` — ${r.reason}` : ""}`);
    });

    const failed = results.filter(r => r.status === "FAIL");
    const passed = results.filter(r => r.status === "PASS");
    console.log(`\nSummary: ${passed.length} passed, ${failed.length} failed out of ${results.length} total`);

    if (failed.length > 0) {
      console.error("\n=== Failed Tests ===");
      failed.forEach(r => console.error(`  ${r.name}: ${r.reason}`));
      process.exit(1);
    } else {
      console.log("\nAll four assessment module tests passed");
    }
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);

    if (results.length > 0) {
      console.log("\n=== Partial Results Before Failure ===");
      results.forEach(r => {
        const icon = r.status === "PASS" ? "PASS" : "FAIL";
        console.log(`  ${icon} ${r.name}${r.reason ? ` — ${r.reason}` : ""}`);
      });
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
