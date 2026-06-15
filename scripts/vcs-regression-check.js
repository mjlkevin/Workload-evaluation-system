/**
 * VCS Full-Chain Regression Test
 * Validates: checkout → edit → checkin → undo → promote → force-unlock
 * Run: node scripts/vcs-regression-check.js
 */

const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");

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
  return { status: response.status, body };
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

function buildTokens(projectRoot) {
  const usersPath = path.resolve(projectRoot, "config/auth/users.json");
  const usersStore = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
  const users = Array.isArray(usersStore?.users) ? usersStore.users.filter((x) => x && x.status === "active") : [];

  const adminUser = users.find((x) => x.role === "admin");
  const normalUser = users.find((x) => x.role !== "admin" && x.username !== "external-agent");
  if (!adminUser) throw new Error("active_admin_user_missing");
  if (!normalUser) throw new Error("second_active_user_missing");

  const secret = resolveJwtSecret(projectRoot);
  const sign = (user) =>
    jwt.sign(
      { sub: user.id, username: user.username, role: user.role === "admin" ? "admin" : "user" },
      secret,
      { expiresIn: "8h" }
    );

  return { adminUser, normalUser, adminToken: sign(adminUser), normalToken: sign(normalUser) };
}

async function run() {
  const projectRoot = process.cwd();
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const { adminUser, normalUser, adminToken, normalToken } = buildTokens(projectRoot);

  const auth = (token) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  });

  const results = [];
  const pass = (name) => results.push({ name, status: "PASS" });
  const fail = (name, reason) => results.push({ name, status: "FAIL", reason });

  try {
    // Health check
    const health = await requestJson(`${baseUrl}/api/v1/health`);
    assert(health.status === 200, "health not 200");
    pass("health_check");

    // === Step 1: Create a test version (admin has all capabilities) ===
    const createRes = await requestJson(`${baseUrl}/api/v1/versions`, {
      method: "POST",
      headers: auth(adminToken),
      body: JSON.stringify({
        type: "global",
        templateId: "tmpl-test",
        payload: { customerName: "VCS-Regression-Test", items: [] }
      })
    });
    assert(createRes.status === 200 && createRes.body.code === 0, `create version failed: ${JSON.stringify(createRes.body)}`);
    const versionId = createRes.body.data.record.id;
    const versionCode = createRes.body.data.record.versionCode;
    console.log(`Created version: ${versionId} (${versionCode})`);
    pass("create_version");

    // === Step 2: Checkout (exclusive lock) ===
    const checkoutRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkout`, {
      method: "POST",
      headers: auth(adminToken),
      body: JSON.stringify({ reason: "VCS regression test" })
    });
    assert(checkoutRes.status === 200 && checkoutRes.body.code === 0, `checkout failed: ${JSON.stringify(checkoutRes.body)}`);
    assert(checkoutRes.body.data.record.checkoutStatus === "checked_out", "checkout status not checked_out");
    pass("checkout");

    // === Step 2b: Double checkout should fail (already locked) ===
    const doubleCheckoutRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkout`, {
      method: "POST",
      headers: auth(adminToken)
    });
    assert(doubleCheckoutRes.status === 400 || doubleCheckoutRes.status === 409, "double checkout should fail");
    pass("checkout_double_lock_guard");

    // === Step 3: Save draft (edit while checked out) ===
    const saveDraftRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/save-draft`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ payload: { customerName: "VCS-Regression-Test-Edited", items: [{ name: "test" }] } })
    });
    assert(saveDraftRes.status === 200 && saveDraftRes.body.code === 0, `save-draft failed: ${JSON.stringify(saveDraftRes.body)}`);
    assert(saveDraftRes.body.data.record.checkoutStatus === "checked_out", "save-draft should keep checked_out status");
    pass("save_draft_edit");

    // === Step 4: Checkin (release lock, increment minor) ===
    const checkinRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkin`, {
      method: "POST",
      headers: auth(adminToken)
    });
    assert(checkinRes.status === 200 && checkinRes.body.code === 0, `checkin failed: ${JSON.stringify(checkinRes.body)}`);
    assert(checkinRes.body.data.record.checkoutStatus === "checked_in", "checkin status not checked_in");
    assert(checkinRes.body.data.record.minorNumber >= 1, "minor number should be >= 1 after checkin");
    pass("checkin");

    // === Step 5: Checkout again for undo test ===
    const checkout2Res = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/checkout`, {
      method: "POST",
      headers: auth(adminToken),
      body: JSON.stringify({ reason: "undo test" })
    });
    assert(checkout2Res.status === 200 && checkout2Res.body.code === 0, `checkout2 failed`);
    pass("checkout_second_time");

    // === Step 6: Undo checkout (discard changes) ===
    const undoRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/undo-checkout`, {
      method: "POST",
      headers: auth(adminToken)
    });
    assert(undoRes.status === 200 && undoRes.body.code === 0, `undo-checkout failed: ${JSON.stringify(undoRes.body)}`);
    assert(undoRes.body.data.record.checkoutStatus === "checked_in", "undo should restore checked_in");
    pass("undo_checkout");

    // === Step 7: Promote (archive + create new major version) ===
    const promoteRes = await requestJson(`${baseUrl}/api/v1/versions/${versionId}/promote`, {
      method: "POST",
      headers: auth(adminToken),
      body: JSON.stringify({ reason: "promote to next major" })
    });
    assert(promoteRes.status === 200 && promoteRes.body.code === 0, `promote failed: ${JSON.stringify(promoteRes.body)}`);
    const newVersionId = promoteRes.body.data.newRecord?.id;
    assert(newVersionId, "promote should return new record id");
    pass("promote");

    // === Step 8: Force-unlock by admin ===
    // The new version is auto-checked-out after promote, so force-unlock it
    const forceUnlockRes = await requestJson(`${baseUrl}/api/v1/versions/${newVersionId}/force-unlock`, {
      method: "PATCH",
      headers: auth(adminToken),
      body: JSON.stringify({ reason: "admin force-unlock regression test" })
    });
    assert(forceUnlockRes.status === 200 && forceUnlockRes.body.code === 0, `force-unlock failed: ${JSON.stringify(forceUnlockRes.body)}`);
    assert(forceUnlockRes.body.data.record.checkoutStatus === "checked_in", "force-unlock should restore checked_in");
    pass("force_unlock_by_admin");

    // === Step 8b: Force-unlock by non-admin should fail ===
    const forceUnlockForbiddenRes = await requestJson(`${baseUrl}/api/v1/versions/${newVersionId}/force-unlock`, {
      method: "PATCH",
      headers: auth(normalToken),
      body: JSON.stringify({ reason: "should fail" })
    });
    assert(forceUnlockForbiddenRes.status === 403, `force-unlock by non-admin should return 403, got ${forceUnlockForbiddenRes.status}`);
    assert(forceUnlockForbiddenRes.body.code === 40301, `force-unlock forbidden should have code 40301, got ${forceUnlockForbiddenRes.body.code}`);
    pass("force_unlock_non_admin_forbidden");

    // === Step 9: Cleanup - delete test versions ===
    try {
      await requestJson(`${baseUrl}/api/v1/versions/global/${versionCode}`, { method: "DELETE", headers: auth(adminToken) });
    } catch { /* ignore cleanup errors */ }

    pass("all_vcs_actions");

    // Print results
    console.log("\n=== VCS Regression Results ===");
    results.forEach(r => {
      const icon = r.status === "PASS" ? "✅" : "❌";
      console.log(`${icon} ${r.name}${r.reason ? ` — ${r.reason}` : ""}`);
    });

    const failed = results.filter(r => r.status === "FAIL");
    if (failed.length > 0) {
      console.error(`\n❌ ${failed.length} test(s) failed`);
      process.exit(1);
    } else {
      console.log(`\n✅ All ${results.length} VCS tests passed`);
    }
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

run();
