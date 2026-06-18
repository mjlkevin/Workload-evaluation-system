# Role Driven AI Home Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-driven AI home workbench as the default `/` experience while preserving the current traditional dashboard as a switchable view.

**Architecture:** Add a `businessRole` identity field alongside the existing system `role`, expose it through auth APIs and user management, then refactor the current homepage into a container with AI and traditional modes. The AI mode uses local role presets for prompts, workflows, and empty states, with light integration to existing requirement and assessment routes.

**Tech Stack:** TypeScript Express API in `apps/api`, JSON file-backed auth store, React 18 + Vite prototype in `ui/V2_PROTOTYPE`, Vitest + Testing Library for frontend tests, Node test runner for API module tests.

---

## File Structure

Backend:

- Modify `apps/api/src/types/index.ts` to add `BusinessRole`, `businessRole` on `AuthUser`, `PublicUser`, and `AuthJwtPayload`.
- Modify `apps/api/src/middleware/auth.ts` to normalize, sign, verify, and expose `businessRole`.
- Modify `apps/api/src/modules/auth/auth.usecase.ts` to default new users, list users, return current user, and update a user's business role.
- Modify `apps/api/src/routes/auth.routes.ts` to add `PATCH /auth/users/:userId/business-role`.
- Modify `apps/api/src/modules/modules.handlers.test.ts` or add `apps/api/src/modules/auth/auth.business-role.test.ts` for backend regression coverage.

Frontend data/auth:

- Modify `ui/V2_PROTOTYPE/src/hooks/useUsers.js` to map `businessRole`.
- Modify `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx` to display and edit system role and business role separately.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js` and `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` to include business roles and update mock API support.
- Add `ui/V2_PROTOTYPE/src/__tests__/useUsers.test.js` for mapping and fallback behavior.

Homepage:

- Rename or extract existing `HomePage.jsx` internals into `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`.
- Create `ui/V2_PROTOTYPE/src/pages/HomeWorkspace.jsx` as the `/` container.
- Create `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx` for the role-driven AI home UI.
- Create `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js` for role labels, prompt presets, workflow presets, and fallback mapping.
- Modify `ui/V2_PROTOTYPE/src/App.jsx` to render `HomeWorkspace` at `/`.
- Modify `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx` so the account meta uses current user/business role when available.
- Add `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`.
- Add `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`.

Verification:

- Run `npm run test:modules -w apps/api`.
- Run `npm run test --prefix ui/V2_PROTOTYPE`.
- Run `npm run build --prefix ui/V2_PROTOTYPE`.
- Browser-check `/`, `/users`, and role-specific homepage states.

---

## Task 1: Backend Business Role Model

**Files:**

- Modify: `apps/api/src/types/index.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/modules/auth/auth.usecase.ts`
- Modify: `apps/api/src/routes/auth.routes.ts`
- Test: `apps/api/src/modules/modules.handlers.test.ts`

- [ ] **Step 1: Write backend tests for business role exposure**

Add imports to `apps/api/src/modules/modules.handlers.test.ts`:

```ts
import { updateUserBusinessRole } from "./auth/auth.usecase";
```

Add tests near the auth tests:

```ts
test("auth.usecase: me returns businessRole with valid token", () => {
  const req = createMockReq({ token: getActiveUserToken() });
  const res = createMockRes();
  me(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { user: { businessRole?: string } } };
  assert.equal(body.code, 0);
  assert.ok(body.data.user.businessRole);
});

test("auth.usecase: updateUserBusinessRole changes only business role", () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  const target = store.users.find((x) => x.status === "active" && x.role !== "admin");
  assert.ok(admin, "active admin required");
  assert.ok(target, "active non-admin target required");

  withFileSnapshotRestore(config.auth.usersFile, () => {
    const req = createMockReq({
      token: signAuthToken(admin),
      params: { userId: target.id },
      body: { businessRole: "sales" },
    });
    const res = createMockRes();
    updateUserBusinessRole(req, res as unknown as Response);

    assert.equal(res.statusCode, 200);
    const body = res.body as { code: number; data: { user: { role: string; businessRole: string } } };
    assert.equal(body.code, 0);
    assert.equal(body.data.user.role, target.role);
    assert.equal(body.data.user.businessRole, "sales");
  });
});

test("auth.usecase: updateUserBusinessRole rejects invalid role", () => {
  const store = loadUsersStore();
  const admin = store.users.find((x) => x.status === "active" && x.role === "admin");
  const target = store.users.find((x) => x.status === "active");
  assert.ok(admin, "active admin required");
  assert.ok(target, "active target required");

  const req = createMockReq({
    token: signAuthToken(admin),
    params: { userId: target.id },
    body: { businessRole: "bad_role" },
  });
  const res = createMockRes();
  updateUserBusinessRole(req, res as unknown as Response);

  assert.equal(res.statusCode, 400);
  assert.equal((res.body as { code?: number }).code, 40001);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: TypeScript compile or test failure because `businessRole` and `updateUserBusinessRole` do not exist yet.

- [ ] **Step 3: Add backend business role types**

In `apps/api/src/types/index.ts`, add:

```ts
export type BusinessRole =
  | "sales"
  | "pre_sales"
  | "delivery"
  | "pm"
  | "pmo"
  | "dev"
  | "admin";
```

Update `AuthUser`:

```ts
export type AuthUser = {
  id: string;
  username: string;
  passwordHash: string;
  /** admin：全权限；sub_admin：用户管理（不可动超级管理员/不可授 admin）；user：普通 */
  role: "admin" | "sub_admin" | "user";
  /** 业务身份：驱动首页 AI 提示词与工作流，不参与系统权限放行 */
  businessRole?: BusinessRole;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string;
};
```

Update `AuthJwtPayload`:

```ts
export type AuthJwtPayload = {
  sub: string;
  username: string;
  role: AuthUser["role"];
  businessRole: BusinessRole;
};
```

- [ ] **Step 4: Add auth normalization helpers**

In `apps/api/src/middleware/auth.ts`, update imports:

```ts
import { AuthJwtPayload, AuthUser, BusinessRole } from "../types";
```

Add helpers near the top of the file:

```ts
const BUSINESS_ROLES: BusinessRole[] = ["sales", "pre_sales", "delivery", "pm", "pmo", "dev", "admin"];

export function isBusinessRole(value: string): value is BusinessRole {
  return BUSINESS_ROLES.includes(value as BusinessRole);
}

export function defaultBusinessRoleForSystemRole(role: AuthUser["role"]): BusinessRole {
  if (role === "admin") return "admin";
  if (role === "sub_admin") return "pm";
  return "pre_sales";
}

export function resolveBusinessRole(user: Pick<AuthUser, "role" | "businessRole">): BusinessRole {
  return user.businessRole && isBusinessRole(user.businessRole)
    ? user.businessRole
    : defaultBusinessRoleForSystemRole(user.role);
}
```

Update `signAuthToken`:

```ts
export function signAuthToken(user: AuthUser): string {
  const expiresIn = config.jwt.expiresIn as jwt.SignOptions["expiresIn"];
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      businessRole: resolveBusinessRole(user),
    } satisfies AuthJwtPayload,
    config.jwt.secret,
    { expiresIn, algorithm: JWT_ALGORITHM }
  );
}
```

Update `verifyAuthToken` payload parsing:

```ts
const businessRoleRaw = asString(payload.businessRole);
const businessRole = isBusinessRole(businessRoleRaw)
  ? businessRoleRaw
  : defaultBusinessRoleForSystemRole(role);
if (!sub || !username) return null;
return { sub, username, role, businessRole };
```

Update `toPublicUser`:

```ts
export function toPublicUser(user: AuthUser): Omit<AuthUser, "passwordHash"> & { businessRole: BusinessRole } {
  const { passwordHash, ...rest } = user;
  return { ...rest, businessRole: resolveBusinessRole(user) };
}
```

- [ ] **Step 5: Add business role defaults and update endpoint**

In `apps/api/src/modules/auth/auth.usecase.ts`, update imports from middleware:

```ts
  isBusinessRole,
  defaultBusinessRoleForSystemRole,
```

When creating a new user in `register`, include:

```ts
businessRole: defaultBusinessRoleForSystemRole(role),
```

Add a new usecase after `updateUserRole`:

```ts
export function updateUserBusinessRole(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!canManageUsers(auth.user)) {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "user_mgmt_required" }]);
  }

  const userId = asString(req.params.userId);
  const rawBusinessRole = asString(req.body?.businessRole);
  if (!userId) {
    return fail(res, 40001, "参数错误", [{ field: "userId", reason: "required" }]);
  }
  if (!isBusinessRole(rawBusinessRole)) {
    return fail(res, 40001, "参数错误", [{ field: "businessRole", reason: "invalid" }]);
  }

  const store = loadUsersStore();
  const target = store.users.find((u) => u.id === userId);
  if (!target) {
    return fail(res, 40401, "资源不存在", [{ field: "userId", reason: "not_found" }]);
  }

  if (auth.user.role === "sub_admin" && target.role === "admin") {
    return fail(res, 40301, "权限不足", [{ field: "role", reason: "cannot_modify_super_admin" }]);
  }

  target.businessRole = rawBusinessRole;
  saveUsersStore(store);
  res.json(ok({ user: toPublicUser(target) }, randomUUID()));
}
```

In `apps/api/src/modules/auth/auth.controller.ts`, export the handler:

```ts
export {
  register,
  login,
  me,
  logout,
  listUsers,
  updateUserStatus,
  updateUserRole,
  updateUserBusinessRole,
  listInviteCodes,
  generateInviteCodeHandler,
} from "./auth.usecase";
```

In `apps/api/src/modules/auth/auth.module.ts`, export the handler:

```ts
export { updateUserBusinessRole } from "./auth.usecase";
```

In `apps/api/src/routes/auth.routes.ts`, add:

```ts
router.patch("/users/:userId/business-role", requireCapability("user:manage"), AuthModule.updateUserBusinessRole);
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: PASS. If the test file imports fail because `auth.module.ts` exports differ, update only the auth barrel export to match the existing module pattern.

- [ ] **Step 7: Commit backend role model**

Run:

```bash
git add apps/api/src/types/index.ts apps/api/src/middleware/auth.ts apps/api/src/modules/auth apps/api/src/routes/auth.routes.ts apps/api/src/modules/modules.handlers.test.ts
git commit -m "feat: add business role to auth users"
```

---

## Task 2: Frontend User Mapping and User Management

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/hooks/useUsers.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
- Create: `ui/V2_PROTOTYPE/src/__tests__/useUsers.test.js`

- [ ] **Step 1: Write useUsers mapping test**

Create `ui/V2_PROTOTYPE/src/__tests__/useUsers.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { mapUserToVM } from '../hooks/useUsers.js'

describe('mapUserToVM', () => {
  test('maps explicit businessRole from backend', () => {
    const vm = mapUserToVM({
      id: 'u-sales',
      username: 'sales01',
      role: 'user',
      businessRole: 'sales',
      status: 'active',
    })

    expect(vm.businessRole).toBe('sales')
    expect(vm.businessRoleLabel).toBe('销售员')
    expect(vm.role).toBe('user')
  })

  test('falls back businessRole from system role when missing', () => {
    expect(mapUserToVM({ username: 'root', role: 'admin' }).businessRole).toBe('admin')
    expect(mapUserToVM({ username: 'pm01', role: 'sub_admin' }).businessRole).toBe('pm')
    expect(mapUserToVM({ username: 'presales01', role: 'user' }).businessRole).toBe('pre_sales')
  })
})
```

- [ ] **Step 2: Run frontend tests and verify failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- useUsers
```

Expected: FAIL because `businessRole` mapping does not exist.

- [ ] **Step 3: Add role constants and mapper support**

In `ui/V2_PROTOTYPE/src/hooks/useUsers.js`, add constants above `mapUserToVM`:

```js
export const BUSINESS_ROLES = [
  { key: 'sales', label: '销售员' },
  { key: 'pre_sales', label: '售前顾问' },
  { key: 'delivery', label: '交付顾问' },
  { key: 'pm', label: '项目经理' },
  { key: 'pmo', label: 'PMO' },
  { key: 'dev', label: '开发顾问' },
  { key: 'admin', label: '管理视角' },
]

export function defaultBusinessRoleForSystemRole(role) {
  if (role === 'admin') return 'admin'
  if (role === 'sub_admin') return 'pm'
  return 'pre_sales'
}

export function businessRoleLabel(role) {
  return BUSINESS_ROLES.find((item) => item.key === role)?.label || role || '未配置'
}
```

Update `mapUserToVM`:

```js
const businessRole = user.businessRole || user.business_role || defaultBusinessRoleForSystemRole(role)
return {
  id: user.id || user.userId || username,
  username,
  email: user.email || `${username}@wes.local`,
  role,
  businessRole,
  businessRoleLabel: businessRoleLabel(businessRole),
  status: user.status === 'disabled' || user.disabled ? 'disabled' : 'active',
  lastLoginAt: user.lastLoginAt || user.lastLoginTime || null,
  createdAt: user.createdAt || null,
  locked: Boolean(user.locked || user.systemAccount || role === 'admin' || username === 'admin'),
  raw: user,
}
```

- [ ] **Step 4: Run mapper test**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- useUsers
```

Expected: PASS.

- [ ] **Step 5: Add mock backend support**

In `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`, ensure users include `businessRole`:

```js
export const mockUsers = [
  { id: 'u1', username: 'admin', role: 'admin', businessRole: 'admin', email: 'admin@wes.local' },
  { id: 'u2', username: 'pm', role: 'sub_admin', businessRole: 'pm', email: 'pm@wes.local' },
  { id: 'u3', username: 'arch', role: 'user', businessRole: 'pre_sales', email: 'arch@wes.local' },
]
```

In `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`, add a PATCH handler:

```js
http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ params, request }) => {
  const body = await request.json()
  return HttpResponse.json({
    success: true,
    data: {
      user: {
        id: params.userId,
        username: 'patched-user',
        role: 'user',
        businessRole: body.businessRole,
        status: 'active',
      },
    },
  })
}),
```

- [ ] **Step 6: Update UserManagement role UI**

In `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx`, update imports:

```js
import useUsers, { BUSINESS_ROLES, businessRoleLabel } from '../hooks/useUsers.js'
import { apiClient } from '../api/client.js'
```

Rename existing `dialog` comment to:

```js
const [dialog, setDialog] = useState(null) // 'systemRole' | 'businessRole' | 'demote' | null
const [pendingBusinessRole, setPendingBusinessRole] = useState('')
```

Update `openRoleDialog` to open system role:

```js
const openSystemRoleDialog = () => {
  if (selCount === 0) return
  setPendingRole('user')
  setDialog('systemRole')
}
```

Add business role dialog open and confirm:

```js
const openBusinessRoleDialog = () => {
  if (selCount === 0) return
  setPendingBusinessRole(selectedRows[0]?.businessRole || 'pre_sales')
  setDialog('businessRole')
}

const applyBusinessRole = async () => {
  const targetRole = pendingBusinessRole
  const ids = Array.from(selected)
  try {
    for (const id of ids) {
      await apiClient.patch(`/auth/users/${id}/business-role`, { businessRole: targetRole })
    }
    setUsers((prev) => prev.map((u) => selected.has(u.id)
      ? { ...u, businessRole: targetRole, businessRoleLabel: businessRoleLabel(targetRole) }
      : u
    ))
    setDialog(null)
    setPendingBusinessRole('')
  } catch (err) {
    alert(err?.message || '修改业务角色失败')
  }
}
```

Change toolbar buttons:

```jsx
<button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} disabled={!canChangeRole} onClick={openSystemRoleDialog}>
  改系统角色
</button>
<button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} disabled={!canChangeRole} onClick={openBusinessRoleDialog}>
  改业务角色
</button>
```

Change table headers:

```jsx
<th>系统角色</th>
<th>业务角色</th>
```

Change user row cells:

```jsx
<td>{fmtRoleChip(u.role)}</td>
<td><span className="bdg brd" style={{ fontSize: 10.5, padding: '1px 7px' }}><span className="dot" />{u.businessRoleLabel}</span></td>
```

Change existing system role dialog guard from `dialog === 'role'` to:

```jsx
{dialog === 'systemRole' && (
```

Add business role dialog below the system role dialog:

```jsx
{dialog === 'businessRole' && (
  <DialogBackdrop onClose={() => setDialog(null)}>
    <DialogCard title="修改业务角色" subtitle={`已选 ${selCount} 人`}>
      <div style={{ display: 'grid', gap: 8 }}>
        {BUSINESS_ROLES.map((r) => (
          <label
            key={r.key}
            style={{
              display: 'flex',
              gap: 10,
              padding: '10px 12px',
              border: `1px solid ${pendingBusinessRole === r.key ? 'var(--brand)' : 'var(--line)'}`,
              borderRadius: 10,
              background: pendingBusinessRole === r.key ? 'var(--brand-soft)' : 'var(--bg-soft)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="businessRole"
              value={r.key}
              checked={pendingBusinessRole === r.key}
              onChange={() => setPendingBusinessRole(r.key)}
              style={{ marginTop: 4 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>用于首页 AI 工作台提示词与工作流分流</div>
            </div>
          </label>
        ))}
      </div>
      <DialogActions>
        <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={() => setDialog(null)}>
          取消
        </button>
        <button type="button" className="btn btn-pri" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={applyBusinessRole}>
          确认修改
        </button>
      </DialogActions>
    </DialogCard>
  </DialogBackdrop>
)}
```

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- useUsers
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: tests PASS and Vite build PASS.

- [ ] **Step 8: Commit user management business role**

Run:

```bash
git add ui/V2_PROTOTYPE/src/hooks/useUsers.js ui/V2_PROTOTYPE/src/pages/UserManagement.jsx ui/V2_PROTOTYPE/src/__tests__/mocks ui/V2_PROTOTYPE/src/__tests__/useUsers.test.js
git commit -m "feat: manage user business roles"
```

---

## Task 3: Role Presets and AI Home Workbench UI

**Files:**

- Create: `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js`
- Create: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Create: `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`

- [ ] **Step 1: Write preset tests**

Create `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { getAiHomePreset } from '../pages/aiHomePresets.js'

describe('getAiHomePreset', () => {
  test('returns sales preset', () => {
    const preset = getAiHomePreset('sales')
    expect(preset.label).toBe('销售员')
    expect(preset.placeholder).toContain('客户')
    expect(preset.workflows.map((item) => item.key)).toContain('new_project_from_file')
  })

  test('returns pre_sales preset', () => {
    const preset = getAiHomePreset('pre_sales')
    expect(preset.label).toBe('售前顾问')
    expect(preset.systemPrompt).toContain('业务需求及问题')
  })

  test('returns delivery preset', () => {
    const preset = getAiHomePreset('delivery')
    expect(preset.label).toBe('交付顾问')
    expect(preset.workflows.map((item) => item.key)).toContain('pull_pending_requirement_pack')
  })

  test('falls back to pre_sales for unknown role', () => {
    const preset = getAiHomePreset('bad-role')
    expect(preset.key).toBe('pre_sales')
  })
})
```

- [ ] **Step 2: Run preset tests and verify failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- aiHomePresets
```

Expected: FAIL because `aiHomePresets.js` does not exist.

- [ ] **Step 3: Implement role presets**

Create `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js`:

```js
export const AI_HOME_PRESETS = {
  sales: {
    key: 'sales',
    label: '销售员',
    headline: '从客户材料启动新项目需求评估',
    systemPrompt: '你是销售员的 AI 工作助手。帮助用户从客户资料、会议纪要或口述中识别商机背景、客户痛点、初步需求范围和下一步跟进动作。',
    placeholder: '上传客户材料，或描述客户背景、痛点和想评估的项目范围。',
    emptyHint: '可以上传客户资料、会议纪要、需求 Excel，AI 会先整理商机背景和售前待确认问题。',
    workflows: [
      { key: 'new_project_from_file', title: '上传材料创建新项目', desc: '解析客户资料并生成新项目草稿' },
      { key: 'sales_questions', title: '生成售前待确认问题', desc: '提炼需要向客户确认的关键信息' },
      { key: 'customer_summary', title: '生成客户沟通摘要', desc: '形成销售跟进纪要和下一步动作' },
    ],
  },
  pre_sales: {
    key: 'pre_sales',
    label: '售前顾问',
    headline: '解析原始需求，生成可评估需求包',
    systemPrompt: '你是售前顾问的 AI 工作助手。帮助用户解析 Excel、Word、PDF 或访谈纪要，识别业务需求及问题，生成需求包、模块建议、风险假设和实施评估输入。',
    placeholder: '附上原始需求文件，让 AI 识别业务需求及问题并生成实施评估输入。',
    emptyHint: '可以上传原始需求文档，AI 会生成业务主题、待确认问题和评估草稿。',
    workflows: [
      { key: 'parse_requirement_file', title: '解析需求文件', desc: '识别业务需求及问题一览' },
      { key: 'confirm_questions', title: '生成待确认问题', desc: '提炼售前需要回问客户的问题' },
      { key: 'assessment_seed', title: '生成实施评估输入', desc: '沉淀模块建议、范围和风险假设' },
    ],
  },
  delivery: {
    key: 'delivery',
    label: '交付顾问',
    headline: '拉取待评估需求包，补充实施评估',
    systemPrompt: '你是交付顾问的 AI 工作助手。帮助用户拉取待详细评估需求包，补充实施范围、人天、复杂度、依赖、风险和交付假设。',
    placeholder: '输入要评估的需求包，或让 AI 拉取待你详细评估的需求。',
    emptyHint: '可以从待办中选择需求包，AI 会辅助补充实施范围、人天和风险。',
    workflows: [
      { key: 'pull_pending_requirement_pack', title: '拉取待评估需求包', desc: '查看分配给你的需求包' },
      { key: 'implementation_scope', title: '补充实施范围', desc: '梳理模块范围、复杂度和依赖' },
      { key: 'pm_summary', title: '生成 PM 评估摘要', desc: '形成项目经理可接力的评估摘要' },
    ],
  },
  pm: {
    key: 'pm',
    label: '项目经理',
    headline: '接力评估包，检查交付物和项目风险',
    systemPrompt: '你是项目经理的 AI 工作助手。帮助用户接力评估包，检查范围、人天、WBS、交付物、项目风险和 PMO 审核准备。',
    placeholder: '让 AI 拉取待接力评估包，或输入你想检查的交付风险。',
    emptyHint: '可以查看待接力评估包，生成交付叙事和交付物。',
    workflows: [
      { key: 'pm_handoff', title: '查看待接力评估包', desc: '拉取需要 PM 接手的评估包' },
      { key: 'delivery_narrative', title: '生成交付叙事', desc: '整理范围、计划、风险和验收路径' },
      { key: 'generate_deliverables', title: '生成交付物', desc: '生成 PM 侧交付物草稿' },
    ],
  },
  pmo: {
    key: 'pmo',
    label: 'PMO',
    headline: '审核交付物规范度与完整性',
    systemPrompt: '你是 PMO 的 AI 工作助手。帮助用户审核交付物齐全性、规范性、方法论完整性，并生成驳回意见或封版检查建议。',
    placeholder: '让 AI 拉取待审核包，或输入你要检查的交付物问题。',
    emptyHint: '可以查看待审核包，自动检查交付物和方法论完整性。',
    workflows: [
      { key: 'pmo_reviews', title: '查看待审核包', desc: '拉取 PMO 待审核事项' },
      { key: 'auto_review', title: '自动审核', desc: '检查交付物齐全性和规范性' },
      { key: 'seal_check', title: '封版检查', desc: '生成封版前检查建议' },
    ],
  },
  dev: {
    key: 'dev',
    label: '开发顾问',
    headline: '评估开发范围、复杂度和技术风险',
    systemPrompt: '你是开发顾问的 AI 工作助手。帮助用户识别开发范围、接口、报表、集成复杂度和技术风险。',
    placeholder: '输入开发需求或接口说明，让 AI 帮你拆解开发评估点。',
    emptyHint: '可以上传开发需求说明，AI 会辅助拆解开发条目和风险。',
    workflows: [
      { key: 'dev_scope', title: '拆解开发范围', desc: '识别接口、报表、集成和二开点' },
      { key: 'dev_risk', title: '识别技术风险', desc: '分析系统集成和数据迁移风险' },
      { key: 'dev_summary', title: '生成开发评估摘要', desc: '形成开发顾问评估说明' },
    ],
  },
  admin: {
    key: 'admin',
    label: '管理视角',
    headline: '查看全局队列、异常流程与系统治理建议',
    systemPrompt: '你是管理员的 AI 工作助手。帮助用户查看全局项目队列、异常流程、角色配置和系统治理建议。',
    placeholder: '询问全局项目状态、异常流程、角色配置或系统治理建议。',
    emptyHint: '可以查看全局待办、异常项目和用户角色配置情况。',
    workflows: [
      { key: 'global_queue', title: '查看全局待办', desc: '汇总各角色待处理事项' },
      { key: 'exception_projects', title: '检查异常项目', desc: '识别超期、缺资料和流程卡点' },
      { key: 'manage_roles', title: '管理业务角色', desc: '进入用户管理补齐业务角色' },
    ],
  },
}

export function getAiHomePreset(role) {
  return AI_HOME_PRESETS[role] || AI_HOME_PRESETS.pre_sales
}
```

- [ ] **Step 4: Run preset tests**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- aiHomePresets
```

Expected: PASS.

- [ ] **Step 5: Implement AI home workbench component**

Create `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`:

```jsx
import React, { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAiHomePreset } from './aiHomePresets.js'

export default function AiHomeWorkbench({ currentUser }) {
  const preset = useMemo(() => getAiHomePreset(currentUser?.businessRole), [currentUser?.businessRole])
  const [composer, setComposer] = useState(preset.placeholder)
  const [selectedFile, setSelectedFile] = useState(null)
  const [messages, setMessages] = useState([])
  const fileInputRef = useRef(null)

  function chooseFile() {
    fileInputRef.current?.click()
  }

  function sendMessage() {
    const text = composer.trim()
    if (!text && !selectedFile) return
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: text || '请解析这个文件并启动工作流。', fileName: selectedFile?.name },
      { role: 'assistant', text: `${preset.label}工作流已准备：${preset.workflows[0]?.title || preset.headline}` },
    ])
    setComposer('')
  }

  return (
    <div className="aiw-page" style={{ minHeight: 'calc(100vh - 112px)' }}>
      <section className="aiw-grid">
        <aside className="aiw-left">
          <div className="aiw-panel-title">当前身份</div>
          <div className="aiw-panel-body">
            <div className="aiw-card">
              <h3>{preset.label}</h3>
              <div className="bd">{preset.headline}</div>
            </div>
            {preset.workflows.map((workflow) => (
              <button key={workflow.key} type="button" className="aiw-topic" onClick={() => setComposer(`${workflow.title}：${workflow.desc}`)}>
                <b>{workflow.title}</b>
                <span>{workflow.desc}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="aiw-chat">
          <div className="aiw-chat-head">
            <span className="bdg brd"><span className="dot" />AI 工作台</span>
            <span className="hint">{preset.systemPrompt}</span>
          </div>
          <div className="aiw-scroll">
            {!messages.length && (
              <div className="aiw-empty">
                <h2>{preset.headline}</h2>
                <p>{preset.emptyHint}</p>
                <button className="btn btn-pri" type="button" onClick={chooseFile}>选择文件</button>
              </div>
            )}
            {messages.map((message, index) => (
              <article className={`aiw-msg ${message.role === 'user' ? 'user' : ''}`} key={`${message.role}-${index}`}>
                <div className="aiw-avatar">{message.role === 'user' ? '我' : 'AI'}</div>
                <div className="aiw-bubble">
                  <div className="aiw-pad">
                    <div className="aiw-text">{message.text}</div>
                    {message.fileName && <div className="aiw-attach"><b>{message.fileName}</b></div>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="aiw-composer">
            <div className="aiw-compose-box">
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
              <button className="aiw-attach-btn" type="button" onClick={chooseFile}>＋</button>
              <textarea rows="1" value={composer} onChange={(event) => setComposer(event.target.value)} placeholder={preset.placeholder} />
              <button className="aiw-send" type="button" onClick={sendMessage}>➤</button>
            </div>
          </div>
        </section>

        <aside className="aiw-right">
          <div className="aiw-panel-title">沉淀结果</div>
          <div className="aiw-panel-body">
            <section className="aiw-card">
              <h3>当前文件</h3>
              <div className="bd">{selectedFile?.name || '尚未上传文件'}</div>
            </section>
            <section className="aiw-card">
              <h3>快捷入口</h3>
              <div className="bd" style={{ display: 'grid', gap: 8 }}>
                <Link className="btn btn-out" to="/requirements">需求列表</Link>
                <Link className="btn btn-out" to="/assessments">实施评估</Link>
                {preset.key === 'admin' && <Link className="btn btn-out" to="/users">用户管理</Link>}
              </div>
            </section>
          </div>
        </aside>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: Run build to catch JSX issues**

Run:

```bash
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: PASS.

- [ ] **Step 7: Commit AI home presets and component**

Run:

```bash
git add ui/V2_PROTOTYPE/src/pages/aiHomePresets.js ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js
git commit -m "feat: add role driven ai home workbench"
```

---

## Task 4: Home Workspace Container and Traditional Dashboard Preservation

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/pages/HomePage.jsx`
- Create: `ui/V2_PROTOTYPE/src/pages/HomeWorkspace.jsx`
- Modify: `ui/V2_PROTOTYPE/src/App.jsx`
- Create: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Extract current HomePage as traditional dashboard**

Copy the current contents of `ui/V2_PROTOTYPE/src/pages/HomePage.jsx` into a new component file `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`.

Change its export line from:

```jsx
export default function HomePage() {
```

to:

```jsx
export default function TraditionalHomeDashboard() {
```

Keep all existing current dashboard logic inside this component.

- [ ] **Step 2: Create current user hook**

Create `ui/V2_PROTOTYPE/src/hooks/useCurrentUser.js`:

```js
import { useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'
import { unwrap } from '../api/utils.js'
import { defaultBusinessRoleForSystemRole, businessRoleLabel } from './useUsers.js'

export default function useCurrentUser({ enabled = isAuthenticated() } = {}) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setUser(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get('/auth/me')
      .then((payload) => {
        if (cancelled) return
        const data = unwrap(payload) || {}
        const raw = data.user || payload?.user || {}
        const businessRole = raw.businessRole || defaultBusinessRoleForSystemRole(raw.role)
        setUser({ ...raw, businessRole, businessRoleLabel: businessRoleLabel(businessRole) })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [enabled])

  return { user, loading, error }
}
```

- [ ] **Step 3: Create HomeWorkspace**

Create `ui/V2_PROTOTYPE/src/pages/HomeWorkspace.jsx`:

```jsx
import React, { useEffect, useState } from 'react'
import PageShell from '../components/Layout/PageShell.jsx'
import useCurrentUser from '../hooks/useCurrentUser.js'
import AiHomeWorkbench from './AiHomeWorkbench.jsx'
import TraditionalHomeDashboard from './TraditionalHomeDashboard.jsx'

const VIEW_KEY = 'wes_home_view'

export default function HomeWorkspace() {
  const { user } = useCurrentUser()
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'ai')

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  return (
    <PageShell
      crumb="工作台 / 主页"
      title="主页"
      subtitle={view === 'ai' ? 'AI 对话式工作台' : '传统工作台'}
      actions={[
        <div key="switch" className="seg" style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', height: 32 }}>
          <button type="button" className={view === 'ai' ? 'on' : ''} onClick={() => setView('ai')} style={{ padding: '0 12px', border: 0, background: view === 'ai' ? 'var(--brand)' : '#fff', color: view === 'ai' ? '#fff' : 'var(--ink)', fontFamily: 'inherit', fontWeight: 700 }}>AI 工作台</button>
          <button type="button" className={view === 'traditional' ? 'on' : ''} onClick={() => setView('traditional')} style={{ padding: '0 12px', border: 0, borderLeft: '1px solid var(--line)', background: view === 'traditional' ? 'var(--brand)' : '#fff', color: view === 'traditional' ? '#fff' : 'var(--ink)', fontFamily: 'inherit', fontWeight: 700 }}>传统工作台</button>
        </div>,
      ]}
    >
      {view === 'ai' ? <AiHomeWorkbench currentUser={user} /> : <TraditionalHomeDashboard embedded />}
    </PageShell>
  )
}
```

- [ ] **Step 4: Simplify HomePage to wrapper**

Replace `ui/V2_PROTOTYPE/src/pages/HomePage.jsx` with:

```jsx
import HomeWorkspace from './HomeWorkspace.jsx'

export default HomeWorkspace
```

- [ ] **Step 5: Ensure TraditionalHomeDashboard does not nest PageShell**

In `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`, accept an `embedded` prop and remove or bypass its outer `PageShell` when embedded.

Use this shape:

```jsx
export default function TraditionalHomeDashboard({ embedded = false }) {
  // keep existing state and handlers
  const content = (
    <>
      {/* existing current HomePage content inside PageShell goes here */}
    </>
  )

  if (embedded) return content

  return (
    <PageShell crumb="工作台 / 主页" title="主页" actions={[/* existing actions */]}>
      {content}
    </PageShell>
  )
}
```

Move the existing JSX inside the current `PageShell` into `content`. Preserve the `+ 新建` action for the non-embedded path only. In embedded mode, keep the internal toolbar's `＋ 新建` button, so users still can create from traditional view.

- [ ] **Step 6: Update App import only if needed**

`ui/V2_PROTOTYPE/src/App.jsx` may keep:

```js
import HomePage from './pages/HomePage.jsx'
```

No route change is required if `HomePage.jsx` exports `HomeWorkspace`.

- [ ] **Step 7: Add HomeWorkspace test**

Create `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, beforeEach } from 'vitest'
import HomeWorkspace from '../pages/HomeWorkspace.jsx'

describe('HomeWorkspace', () => {
  beforeEach(() => {
    localStorage.removeItem('wes_home_view')
  })

  test('defaults to AI workbench', async () => {
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('AI 工作台')).toBeInTheDocument())
    expect(screen.getByText(/对话式工作台/)).toBeInTheDocument()
  })

  test('switches to traditional dashboard', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '传统工作台' }))
    expect(screen.getByText('评估方案列表')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run homepage tests and build**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: tests PASS and Vite build PASS.

- [ ] **Step 9: Commit homepage container**

Run:

```bash
git add ui/V2_PROTOTYPE/src/pages/HomePage.jsx ui/V2_PROTOTYPE/src/pages/HomeWorkspace.jsx ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx ui/V2_PROTOTYPE/src/hooks/useCurrentUser.js ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx ui/V2_PROTOTYPE/src/App.jsx
git commit -m "feat: make ai workbench the home entry"
```

---

## Task 5: Shell Account Role Display and Navigation Polish

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/Layout/WorkspaceTabs.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Use current user in shell account card**

In `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx`, import:

```js
import useCurrentUser from '../../hooks/useCurrentUser.js'
```

Inside `Shell`, add:

```js
const { user } = useCurrentUser()
const username = user?.username || 'mjlkevin'
const roleMeta = user?.businessRoleLabel || (user?.role === 'admin' ? '超级管理员' : '普通用户')
```

Replace hardcoded account block:

```jsx
<div className="av">{username.charAt(0).toUpperCase()}</div>
<div className="account">
  <div className="nm">{username}</div>
  <div className="meta">{roleMeta}</div>
</div>
```

- [ ] **Step 2: Update workspace tab title for root**

In `ui/V2_PROTOTYPE/src/components/Layout/WorkspaceTabs.jsx`, change static title for `/`:

```js
'/': 'AI 工作台',
```

If the existing `STATIC_TITLES` already has `/`, update only that value.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: PASS.

- [ ] **Step 4: Commit shell polish**

Run:

```bash
git add ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx ui/V2_PROTOTYPE/src/components/Layout/WorkspaceTabs.jsx
git commit -m "feat: show business role in shell"
```

---

## Task 6: Browser Verification

**Files:**

- No code changes expected.

- [ ] **Step 1: Start or reuse dev servers**

Run API if not already running:

```bash
npm run dev:api
```

Run V2 prototype if not already running:

```bash
npm run dev --prefix ui/V2_PROTOTYPE -- --host 127.0.0.1 --port 3002
```

Expected: API healthy on `http://localhost:3000`; V2 prototype open on `http://127.0.0.1:3002`.

- [ ] **Step 2: Verify default home**

Open:

```text
http://127.0.0.1:3002/
```

Expected:

- Page title shows homepage.
- `AI 工作台` segmented control is active.
- AI chat area is visible.
- Current account business role is visible in the AI workbench.
- `Kimi-help` is not visible.

- [ ] **Step 3: Verify traditional switch**

Click `传统工作台`.

Expected:

- Existing KPI cards appear.
- `评估方案列表` appears.
- Existing create and VCS toolbar actions remain visible.

- [ ] **Step 4: Verify user management business role**

Open:

```text
http://127.0.0.1:3002/users
```

Expected:

- User table has `系统角色` and `业务角色`.
- Selecting a non-locked user enables `改业务角色`.
- Confirming a business role changes the row chip without changing system role.

- [ ] **Step 5: Final regression commands**

Run:

```bash
npm run test:modules -w apps/api
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: all PASS.

---

## Self-Review

Spec coverage:

- Double role model is covered by Task 1 and Task 2.
- User management business role configuration is covered by Task 2 and Task 6.
- `/` default AI workbench with traditional view switch is covered by Task 3 and Task 4.
- Role-specific prompts and workflows are covered by Task 3.
- Shell/account display polish is covered by Task 5.
- Browser and regression verification are covered by Task 6.

Placeholder scan:

- No unresolved marker words or open-ended implementation instructions remain.
- All new functions referenced in later tasks are defined in earlier tasks.

Type consistency:

- Backend uses `BusinessRole` with lowercase string values.
- Frontend uses the same lowercase `businessRole` values.
- Existing system role field remains `role` and keeps `admin | sub_admin | user`.
