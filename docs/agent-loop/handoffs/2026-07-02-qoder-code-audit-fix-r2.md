# WES Low-Risk AutoFix Loop — Handoff (Round 2)

> 执行日期：2026-07-02
> 执行人：Qoder (WES Low-Risk AutoFix Loop)
> 审计报告：docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
> 状态：**已回填 / 待 Codex 复核**

---

## 目标

修复审计报告 CA-BE-017（P3 — architecture）：`apps/api/src/middleware/request-logger.ts` 缺少请求 ID 传播机制。

问题：
1. 传入 `x-request-id` 头无长度/字符验证，可能导致日志注入
2. 未设置 `X-Correlation-Id` 响应头，无法跨服务关联请求链路
3. 未使用的 `logger` 导入

本轮为 AutoFix Loop 第 2 轮。第 1 轮已修复 CA-CFG-001（.env.example 弱密码示例）。P0/P1 项仅记录风险不修复。

## Worktree

- projectRoot: /Users/kevin/AI/Workload-evaluation-system-agent
- worktreePath: /Users/kevin/AI/Workload-evaluation-system-agent/.worktrees/qoder-autofix-r2
- branch: qoder/code-audit-fix-20260702-r2
- baseCommit: 84611da
- taskId: CODE-AUDIT-FIX-20260702-R2

## 修复来源

- auditReportPath: docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
- fixedFindingIds: CA-BE-017
- autoFixReason: 纯中间件增强（输入校验 + 响应头添加），不改变业务逻辑，不涉及 auth/JWT/DB/API 契约边界

## 变更文件

| 文件 | 意图 |
|------|------|
| `apps/api/src/middleware/request-logger.ts` | 请求 ID 安全校验 + 跨服务传播头 + 清理未使用导入 |

### 具体变更（+14/-2）

1. **移除未使用导入**：`import { logger, childLogger }` → `import { childLogger }`
2. **添加 `sanitizeRequestId()` 函数**：
   - 正则 `/^[a-zA-Z0-9\-]{1,128}$/` 校验传入 `x-request-id`
   - 不合法时回退到 `randomUUID()`
3. **替换裸 header 读取**：`(req.headers["x-request-id"] as string) || randomUUID()` → `sanitizeRequestId(req.headers["x-request-id"] as string)`
4. **添加 `X-Correlation-Id` 响应头**：与 `X-Request-Id` 同值，供下游服务关联

## 验证命令与结果

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit -p apps/api/tsconfig.json` | **pass** — 无类型错误 |
| `npm run build:api` | **pass** — 构建成功 |
| `git diff --stat` | **pass** — 仅 `request-logger.ts` 1 文件变更 (+14/-2) |
| 前端/AI/规则/集成测试 | **not run** — 本轮仅修改后端中间件，不涉及前端/AI/规则逻辑；集成测试可覆盖但改动为纯增强型，不影响现有行为 |

## 风险

| 维度 | 评估 |
|------|------|
| 权限 | 无风险 — 不涉及 auth/JWT/RBAC |
| 数据 | 无风险 — 不涉及数据存储 |
| 兼容 | **极低风险** — `X-Correlation-Id` 为新增响应头，不影响已有消费方；`sanitizeRequestId` 对合法 ID 行为不变，仅拒绝异常输入（回退到 UUID） |
| 测试缺口 | request-logger 中间件无独立单元测试，依赖集成测试覆盖；改动为纯增强型 |
| 人工验收缺口 | 需确认 `X-Correlation-Id` 头名是否符合团队跨服务传播约定 |
| scope risk | 无 — 严格限定在 CA-BE-017 范围 |

### 未修复的 P0/P1 风险记录

本轮审计发现 6 P0 + 16 P1，以下 autoFixEligible 项因优先级/边界约束未在本轮处理：

| ID | Severity | 简述 | 未修复原因 |
|----|----------|------|-----------|
| CA-FE-003 | P0 | 退出登录改用 useNavigate | P0 需 Codex Gate 复核 |
| CA-BE-001 | P0 | 路径遍历守卫 | P0 需 Codex Gate 复核 |
| CA-BE-002 | P0 | JWT 默认密钥启动警告 | P0 需 Codex Gate 复核 |
| CA-SEC-002 | P0 | 清理空密码哈希用户 | P0 需 Codex Gate 复核 |
| CA-BE-003 | P1 | 添加速率限制 | P1 安全相关需评估 |
| CA-BE-006 | P1 | 删除冗余认证调用 | P1 涉及 auth 边界 |
| CA-SEC-005 | P1 | 邀请码 PRNG→crypto | P1 安全相关需评估 |
| CA-SEC-006 | P1 | AI 会话清理 | P1 需评估清理策略 |

## 是否建议看板同步

是。建议更新 `code-audit.html` 看板页面，记录 AutoFix Loop Round 2 已处理 CA-BE-017。

## 下一步建议

- **待 Codex 复核**：请 Codex Gate 审查 worktree `qoder/code-audit-fix-20260702-r2` 的变更
- 本轮两个 worktree 待复核：
  1. `qoder/code-audit-fix-20260702`（CA-CFG-001，.env.example 弱密码）— 在 `.worktrees/qoder-autofix-20260702`
  2. `qoder/code-audit-fix-20260702-r2`（CA-BE-017，请求 ID 传播）— 在 `.worktrees/qoder-autofix-r2`
- 后续轮次可继续处理其他 P2-P3 autoFixEligible 项
