# WES Low-Risk AutoFix Loop — Handoff (Round 3)

> 执行日期：2026-07-02
> 执行人：Qoder (WES Low-Risk AutoFix Loop)
> 审计报告：docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
> 状态：**已回填 / 待 Codex 复核**

---

## 目标

修复审计报告 CA-FE-016（P3 — optimization）：`ui/V2_PROTOTYPE/src/hooks/useMock.js` 在生产环境中暴露了 mock 切换全局变量 `window.__setUseMock` 和 `window.__USE_MOCK__`，允许任何人通过浏览器控制台启用 mock 模式，绕过真实 API 调用。

问题：
1. L61-62：全局 `window.__setUseMock` 在任何环境（包括生产）中注册
2. L15-16：`resolveMockFlag()` 在生产中也读取 `window.__USE_MOCK__` 覆盖值

本轮为 AutoFix Loop 第 3 轮。
- R1: CA-CFG-001（.env.example 弱密码）
- R2: CA-BE-017（请求 ID 传播）
- P0/P1 项仅记录风险不修复。

## Worktree

- projectRoot: /Users/kevin/AI/Workload-evaluation-system-agent
- worktreePath: /Users/kevin/AI/Workload-evaluation-system-agent/.worktrees/qoder-autofix-r3
- branch: qoder/code-audit-fix-20260702-r3
- baseCommit: 84611da
- taskId: CODE-AUDIT-FIX-20260702-R3

## 修复来源

- auditReportPath: docs/agent-loop/audits/2026-07-02-qoder-daily-code-audit.md
- fixedFindingIds: CA-FE-016
- autoFixReason: 添加 `import.meta.env.DEV` 环境守卫，Vite 静态替换，零运行时开销

## 变更文件

| 文件 | 意图 |
|------|------|
| `ui/V2_PROTOTYPE/src/hooks/useMock.js` | 全局 mock 变量添加 DEV 环境守卫 |

### 具体变更（+4/-4）

1. **L15**：`resolveMockFlag()` 中 `window.__USE_MOCK__` 读取添加 `import.meta.env.DEV &&` 前缀
   - 生产环境中 Vite 会将 `import.meta.env.DEV` 编译为 `false`，整个 if 分支被 tree-shaking 移除
2. **L61**：全局 `window.__setUseMock` 注册添加 `import.meta.env.DEV &&` 前缀
   - 生产环境中不再注册全局 setter，控制台无法切换 mock 模式

## 验证命令与结果

| 命令 | 结果 |
|------|------|
| `grep -n "import.meta.env.DEV" useMock.js` | **pass** — L15, L61 两处守卫均存在 |
| `npm run build:web`（从主工作区使用 patched 文件） | **pass** — 111 modules, 529ms 构建成功 |
| `git diff --stat` | **pass** — 仅 `useMock.js` 1 文件变更 (+4/-4) |
| 后端/AI/规则/集成测试 | **not run** — 本轮仅修改前端 hook，不涉及后端/AI/规则逻辑 |

## 风险

| 维度 | 评估 |
|------|------|
| 权限 | 无风险 — 不涉及 auth/JWT/RBAC |
| 数据 | 无风险 — 不涉及数据存储 |
| 兼容 | **极低风险** — 开发环境行为完全不变；生产环境中 mock 调试功能被禁用（预期行为，mock 模式在生产中不应可用） |
| 测试缺口 | useMock.js 无独立单元测试；改动为纯守卫添加，不影响 dev 模式逻辑 |
| 人工验收缺口 | 需确认是否有 E2E 测试依赖 `window.__setUseMock` 在生产环境中可用（不太可能） |
| scope risk | 无 — 严格限定在 CA-FE-016 范围 |

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

是。建议更新 `code-audit.html` 看板页面，记录 AutoFix Loop Round 3 已处理 CA-FE-016。

## 下一步建议

- **待 Codex 复核**：请 Codex Gate 审查 worktree `qoder/code-audit-fix-20260702-r3` 的变更
- 本轮三个 worktree 待复核：
  1. `qoder/code-audit-fix-20260702`（CA-CFG-001，.env.example 弱密码）
  2. `qoder/code-audit-fix-20260702-r2`（CA-BE-017，请求 ID 传播）
  3. `qoder/code-audit-fix-20260702-r3`（CA-FE-016，mock 全局变量环境守卫）
- 后续轮次可继续处理其他 P2-P3 autoFixEligible 项
