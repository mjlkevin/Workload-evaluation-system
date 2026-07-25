# Codex Security Gate Review

date: 2026-07-14
projectRoot: `/Users/kevin/AI/Workload-evaluation-system-agent`
branch: `codex/wes-dirty-triage-20260629`
scope: Qoder 2026-07-02 P0/P1 findings plus the 2026-07-09 Codex Gate rework status

## Result

本轮完成三个低耦合修复，并完成 P0/P1 现状复核。不能据此宣布 Qoder 2026-07-09 Gate 已通过；该 Gate 仍以 `REWORK_REQUIRED` 为准，后续还需要补齐外部 handoff、风险收口和人工验收证据。

## Closed or mitigated findings

| Finding | Current status | Evidence |
|---|---|---|
| CA-FE-001 | 已修复 | `ui/V2_PROTOTYPE/src/pages/Login.jsx` 只保存近期用户名和时间戳，不再保存密码；`Login.test.jsx` 验证 localStorage 不含密码。 |
| CA-FE-003 | 已修复 | `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx` 使用按钮、`clearToken()` 和 `navigate('/login', { replace: true })`；`ShellUserMenu.test.jsx` 验证 SPA 路由切换。 |
| CA-BE-001 | 已有代码守卫 | `exports.usecase.ts` 校验解析后的路径仍位于 export 目录内；本轮未重复改动。 |
| CA-BE-002 | 生产环境已缓解，非生产警告仍开放 | `env.ts` 在 production 下拒绝默认或过短 JWT secret；开发环境启动警告尚未补齐。 |
| CA-SEC-002 | 数据迁移门禁未关闭 | `config/auth/users.json` 当前为 0 字节残留，不能直接作为生产用户源；认证测试和运行态用户已走 PostgreSQL。该文件不得在未做数据归属决策前纳入提交。 |
| CA-BE-003 | 已有代码守卫 | `auth.routes.ts` 对 register/login/password-reset 统一使用 `express-rate-limit`。 |
| CA-SEC-005 | 已修复 | `helpers.ts` 使用 `crypto.randomBytes` 生成邀请码尾段；模块测试会在 `Math.random` 被替换为抛错时验证其仍可生成邀请码。 |
| CA-SEC-007 | 已有代码守卫 | `metrics.routes.ts` 在 production 强制要求 `METRICS_TOKEN`，并校验 Bearer token。 |

## Remaining P0/P1 risks

| Finding | Decision | Required next action |
|---|---|---|
| CA-FE-002 | 保留开放 | 需要围绕 SSE 消息流重构最新消息引用，并用连续发送两条消息的集成场景验证，不能只改依赖数组。 |
| CA-FE-004 | 保留开放 | API client 成功响应仍直接调用 `res.json()`；需补非 JSON 响应测试后再做防御性解析。 |
| CA-FE-005 | 保留开放 | SSE delta 自动滚动依赖仍需前端专项验证。 |
| CA-FE-006 | 保留开放 | token 过期后的同页重新验证需要明确刷新/重认证策略。 |
| CA-SEC-004 | 保留开放 | `xlsx` 依赖风险需要 adapter-first 迁移和兼容性验证，不能在本轮直接升级或删除。 |
| CA-BE-004/005 | 保留开放 | 注册竞态和同步文件 I/O 属于存储层/并发模型问题，应随 PostgreSQL 运行态治理专项处理。 |
| CA-SEC-003/006 | 保留开放 | refresh token 和 AI session 清理需要数据保留策略、迁移与监控，不在本轮低耦合修复范围内。 |

## Verification

- `npm run test --prefix ui/V2_PROTOTYPE -- Login.test.jsx ShellUserMenu.test.jsx`: pass, 2 files / 6 tests.
- `npm run test:modules`: pass, 149 tests.
- 2026-07-13 已验证 `npm run test:integration`: pass, 1 test；本轮全量验收会再次执行。

## Gate decision

`REWORK_REQUIRED`。本轮修复和测试证据可作为下一次 Codex Gate 输入，但不改变 2026-07-09 Gate 的 `allowNextTask=false`，也不授权启动新的 Qoder unattended task。
