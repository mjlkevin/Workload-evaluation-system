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

// 返回 PG users 表全部 active 用户；admin / 非 admin 任一角色缺失时自动 seed
// 集成测试用户（itest-admin / itest-member，幂等 ON CONFLICT DO NOTHING）。
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
    const missing = [];
    if (!rows.some((u) => u.role === "admin")) missing.push(["itest-admin", "admin"]);
    if (!rows.some((u) => u.role !== "admin")) missing.push(["itest-member", "user"]);
    if (missing.length > 0) {
      const bcrypt = require("bcryptjs");
      for (const [username, role] of missing) {
        await client.query(
          `INSERT INTO users (user_id, username, password_hash, role, business_role, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'active', now())
           ON CONFLICT (username) DO NOTHING`,
          [
            randomUUID(),
            username,
            bcrypt.hashSync(username === "itest-admin" ? "ItestAdmin123!" : "ItestMember123!", 10),
            role,
            role === "admin" ? "admin" : "pre_sales"
          ]
        );
      }
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

async function buildTokens(projectRoot) {
  const users = await loadActiveUsers(projectRoot);
  const adminUser = users.find((x) => x.role === "admin");
  const normalUser = users.find((x) => x.role !== "admin");
  if (!adminUser) throw new Error("active_admin_user_missing");
  if (!normalUser) throw new Error("second_active_user_missing_for_forbidden_check");

  const secret = resolveJwtSecret(projectRoot);
  const sign = (user) =>
    jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role === "admin" ? "admin" : "user"
      },
      secret,
      { expiresIn: "8h" }
    );

  return {
    managerUser: adminUser,
    memberUser: normalUser,
    managerToken: sign(adminUser),
    memberToken: sign(normalUser)
  };
}

async function run() {
  const projectRoot = process.cwd();
  const baseUrl = process.env.API_BASE_URL || "http://localhost:3000";
  const { managerUser, memberUser, managerToken, memberToken } = await buildTokens(projectRoot);

  const auth = (token) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  });

  const health = await requestJson(`${baseUrl}/api/v1/health`);
  assert(health.status === 200, "health_status_not_200");

  const createTeam = await requestJson(`${baseUrl}/api/v1/teams`, {
    method: "POST",
    headers: auth(managerToken),
    body: JSON.stringify({ name: `Team-UT-${Date.now()}` })
  });
  assert(createTeam.status === 200, `create_team_failed: ${JSON.stringify(createTeam.body)}`);
  const teamId = createTeam.body?.data?.teamId;
  assert(typeof teamId === "string" && teamId.length > 0, "team_id_missing");

  const addMember = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: auth(managerToken),
    body: JSON.stringify({ userId: memberUser.id, role: "implementer" })
  });
  assert(addMember.status === 200, `add_member_failed: ${JSON.stringify(addMember.body)}`);

  const addMemberInvalidRole = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/members`, {
    method: "POST",
    headers: auth(managerToken),
    body: JSON.stringify({ userId: memberUser.id, role: "bad-role" })
  });
  assert(addMemberInvalidRole.status === 400, "add_member_invalid_role_status_not_400");
  assert(addMemberInvalidRole.body?.code === 42201, "add_member_invalid_role_code_not_42201");

  const createReview = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews`, {
    method: "POST",
    headers: auth(memberToken),
    body: JSON.stringify({ globalVersionCode: `GL-UT-${Date.now()}`, title: "UT Team Review" })
  });
  assert(createReview.status === 200, `create_review_failed: ${JSON.stringify(createReview.body)}`);
  const reviewId = createReview.body?.data?.reviewId;
  assert(typeof reviewId === "string" && reviewId.length > 0, "review_id_missing");
  assert(createReview.body?.data?.createdBy === memberUser.id, "review_created_by_mismatch");

  const postComment = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews/${reviewId}/comments`, {
    method: "POST",
    headers: auth(memberToken),
    body: JSON.stringify({ content: "UT comment from member" })
  });
  assert(postComment.status === 200, `create_comment_failed: ${JSON.stringify(postComment.body)}`);

  const listComments = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews/${reviewId}/comments`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  assert(listComments.status === 200, `list_comments_failed: ${JSON.stringify(listComments.body)}`);
  assert(Array.isArray(listComments.body?.data?.items), "comments_items_missing");
  assert(listComments.body.data.items.length >= 1, "comments_items_empty");

  const closeByManager = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews/${reviewId}/status`, {
    method: "PATCH",
    headers: auth(managerToken),
    body: JSON.stringify({ status: "closed" })
  });
  assert(closeByManager.status === 200, `close_review_by_manager_failed: ${JSON.stringify(closeByManager.body)}`);
  assert(closeByManager.body?.data?.status === "closed", "close_review_status_not_closed");

  const closeByMember = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews/${reviewId}/status`, {
    method: "PATCH",
    headers: auth(memberToken),
    body: JSON.stringify({ status: "closed" })
  });
  assert(closeByMember.status === 400, "close_review_by_member_status_not_400");
  assert(closeByMember.body?.code === 40301, "close_review_by_member_code_not_40301");

  const listCommentsNotFound = await requestJson(`${baseUrl}/api/v1/teams/${teamId}/reviews/not-exist/comments`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  assert(listCommentsNotFound.status === 400, "list_comments_not_found_status_not_400");
  assert(listCommentsNotFound.body?.code === 40401, "list_comments_not_found_code_not_40401");

  const memberReadTeamDetail = await requestJson(`${baseUrl}/api/v1/teams/${teamId}`, {
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(memberReadTeamDetail.status === 200, "member_read_team_detail_status_not_200");

  const forbiddenTeamRead = await requestJson(`${baseUrl}/api/v1/teams/not-exist-team-id`, {
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(forbiddenTeamRead.status === 400, "unknown_team_read_status_not_400");
  assert(forbiddenTeamRead.body?.code === 40401, "unknown_team_read_code_not_40401");

  console.log(
    JSON.stringify(
      {
        ok: true,
        managerUserId: managerUser.id,
        memberUserId: memberUser.id,
        teamId,
        reviewId,
        checks: [
          "health",
          "team_create",
          "member_add",
          "member_add_invalid_role_validation",
          "review_create_by_member",
          "comment_create_and_list",
          "review_close_by_manager",
          "review_close_forbidden_for_member",
          "review_comments_not_found",
          "team_detail_member_access",
          "unknown_team_not_found"
        ]
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error(err.message || String(err));
  process.exit(1);
});
