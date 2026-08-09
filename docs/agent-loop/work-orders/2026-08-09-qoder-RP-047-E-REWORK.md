# Qoder Work Order — RP-047 Batch E 返工 · B1 Boot 真实接线 + B2 409 文案拦截

> 来源：Gate E 主会话独立审计不通过（2026-08-09），用户裁决「退回返工」。
> 审计证据见 `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md` 与总看板
> changes 事件 `BE-2026-08-09-gate-e-audit-blocked`。

## 1. 合同坐标

- 执行位置：**同一 worktree** `.claude/worktrees/rp-047-e-resilience-rollout`，
  同一分支 `qoder/rp-047-e-resilience-rollout`，不新建分支。
- baseCommit：`1feda52`（Batch E 业务实现提交，返工在其上追加提交）。
- 原工单：`docs/agent-loop/work-orders/2026-08-09-qoder-RP-047-E.md` 的 §5 硬口径、
  §6 冻结参数、§8 Forbidden 全部继续有效；本工单仅追加/修订下述范围。
- 状态权威：handoff 原文件 `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md`
  追加「返工节」，状态停在「已回填 / 待主会话复审」。

## 2. 返工范围（仅三项，超出即停止回填）

### B1（阻断）：Boot 接真实 dispatch，G-E1 成立

审计事实：`harness-boot.ts` L37-42 注入 workflow 的 dispatch 是抛错占位
（`throw new Error("dispatch not wired in boot; ...")`）；`main.ts` 仅传
`{ repo, enabled }`，无 dispatch 注入位；且 `workbench-chat.workflow.ts` 内
dispatch 入参硬编码 `modelChat: async () => ({ answer: "", rawContent: "" })`、
`businessRole`/`model` 固定值——flag-on 时任何 run 在 workflow step 必失败或
产出空回复，G-E1「提交闭环」不成立。

返工要求：

1. `startHarnessRuntime` 增加 dispatch 注入位（可选参数，默认组装真实分发入口；
   测试注入通道保留）。`main.ts` 传入真实组装结果。
2. 真实组装必须**复用**同步链路同款口径（参考
   `services/ai/handlers/workbench-chat.handler.ts` L80-110 的组装方式）：
   `resolveBusinessRole(user)` + `HOME_ROLE_PRESETS` 角色标签与 prompt +
   `normalizeKimiModelName(config.kimi.model)` + 真实 `modelChat`
   （`resolveActiveRequirementKimiApiKey` + 既有 kimi chat 客户端，
   apiKey 缺失时抛 `required_or_env_missing` 与同步路径同口径）。
   - 默认方案：在 `services/ai/handlers/workbench-shared.ts` 抽取共享组装函数
     （允许 modelChat 注入以支持测试），同步 handler 改为调用该函数，
     **同步路径行为逐字不变**（既有回归全绿为准）。
   - 备选方案：boot 闭包直接 import 同款 helper 自行组装（允许少量接线重复，
     禁止改变任何 helper 行为）。
   - `services/ai/workbench-dispatch.service.ts` 仅允许补导出，零行为变更。
3. `workbench-chat.workflow.ts` 不再硬编码 modelChat/businessRole/model：
   dispatch 依赖签名收敛为「workflow 只负责提取 content 与 run 身份，
   完整 dispatch 入参组装归 boot 注入侧」。workflow 元数据（workflowId、
   version、effectKey、deduplicationKey）**冻结口径零变更**，
   既有 4 条守护测试语义保持（允许随签名同步更新 stub）。
4. 新增 boot 级接线守护测试（`harness-boot.test.ts` 扩充）：
   - boot 组装出的 workflow dispatch **不是占位**（可调用且不抛
     "dispatch not wired" 错误）；
   - focused 端到端守护（Testcontainers DB 实跑或等价 mock 链）：boot 默认组装
     + 注入 stub modelChat → 提交 run → worker 执行 → outbox → projector →
     Session assistant 消息可见。此条即 G-E1 自动化证据。

### B2（阻断）：前端 409 文案呈现与拦截，F4 落地

审计事实：`useChatMessages.js` L249-253 对 409 `SESSION_HAS_ACTIVE_RUN`
静默回退旧同步路径、无任何文案——工单 Step 4 F4 明确要求「前端文案呈现」，
且回退后在活跃 run 存在时仍执行同步发送，违反停止边界精神。

返工要求：

1. submitRun catch 分支显式区分三态：
   - `503` / `ASYNC_RUNS_DISABLED`：维持现状（缓存 `runsDisabledRef` + 回退同步路径）；
   - `409` / `SESSION_HAS_ACTIVE_RUN`：**呈现用户可见文案**（工作台既有 toast
     或内联提示，文案示例「该会话存在进行中的任务，请等待完成后再发送」），
     **直接 return，不回退旧同步路径**；loading/发送态复位；
   - 其他错误：维持现状（静默回退），不在本次范围扩大。
2. 新增守护测试（`run-submit.test.jsx` 扩充）：409 时旧同步路径零调用、
   文案可见、503 回退行为不回退（既有 2 条继续通过）。

### O2（观察项转实施）：handoff 补完整人工验收指引

审计事实：handoff 缺 Step 4 要求的人工验收指引。

返工要求：在 handoff 返工节写入完整指引——flag 启用方式
（`WES_AI_DURABLE_RUNS_ENABLED=true` 进程环境变量启动 API，**不编辑主
checkout .env.local**）、预期行为、A/B 并行、离页/刷新/关页/重登/明确停止/
逆序返回（roadmap Task 5 Step 7 口径）、受限项声明。

### 明确不实施（登记缓办）

- O1：Drill 3 `effectExists = true` 自证、Drill 4 硬编码静态断言——演练证据
  表述问题，不阻塞闭环，主会话另行建 issue。
- O3：`harness.routes.test.ts` 既有 DB 串行隔离 flake——非本批回归，主会话
  另行建 issue；返工中遇到该 flake 以单文件重跑通过为准，记录即可，不修复。

## 3. 基线事实（返工开工前必须复现）

在 worktree 内复跑，计数不符即停止回填疑点：

| 套件 | 预期计数 |
|---|---|
| test:web | 263（返工后按新增测试报告实际值） |
| test:modules | 265 |
| test:ai | 244 |
| test:harness | 173（遇 O3 flake 以单文件重跑为准） |
| test:integration | 1 |
| build:api / build:web | exit 0 |

## 4. 不回退口径（返工后必须继续成立）

- G-E2：flag off 字节级回退旧同步路径；503 探测守护测试常驻通过。
- G-E3：effectKey `workbench_chat_answer` + deduplicationKey
  `${runId}:assistant:1` 双证据口径零变更。
- G-E4：唯一 cancel 触发路径仍是用户显式停止；Batch D 零 cancel 守护通过。
- G-E5：`/ai/home-workbench/chat` 同步链路保留；isExplicitReportRequest
  闸门与 O10-A 快照集不动。
- 零新依赖（含 dev）；DB schema 与迁移文件零变更；package-lock 零 diff。

## 5. Allowed Paths（超出即停止并回填疑点）

- `apps/api/src/modules/harness/harness-boot.ts`
- `apps/api/src/modules/harness/harness-boot.test.ts`
- `apps/api/src/modules/harness/workbench-chat.workflow.ts`
- `apps/api/src/modules/harness/workbench-chat.workflow.test.ts`
- `apps/api/src/main.ts`
- `apps/api/src/services/ai/handlers/workbench-shared.ts`
- `apps/api/src/services/ai/handlers/workbench-chat.handler.ts`（仅限改调共享组装函数，行为零变更）
- `apps/api/src/services/ai/workbench-dispatch.service.ts`（仅限补导出）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`
- `ui/V2_PROTOTYPE/src/__tests__/run-submit.test.jsx`
- `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md`

## 6. RED 要求

先写失败测试（boot 接线守护、G-E1 focused 端到端、前端 409 守护），确认红，
再实施；禁止先改实现后补测。

## 7. 验证命令（全量）

```bash
# 前端（ui/V2_PROTOTYPE）
npm run test:web
npm run build

# 后端（apps/api）
npm run test:modules
npm run test:ai
npm run test:integration
npm run build

# harness DB 实跑（本机无 docker CLI，Colima socket 等价环境）
cd apps/api && DOCKER_HOST=unix:///Users/kevin/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
USE_TESTCONTAINERS=true npm run test:harness

# 守护 diff（依赖与 schema 零变更）
git diff --stat 1feda52 -- package-lock.json apps/api/drizzle/
# 预期：零输出
```

## 8. 提交与回填

1. 业务实现提交（可 1-2 笔）：`fix(harness): RP-047 Batch E 返工 · ...` 格式。
2. handoff 更新单独一笔提交：追加返工节（范围、验证计数、G-E1 focused 证据、
   人工验收指引全文），状态停在「已回填 / 待主会话复审」。
3. 不合并 main、不自宣「已交付」。

## 9. 停止条件

- 触碰 Allowed Paths 之外文件；
- 冻结参数（workflowId/version/effectKey/deduplicationKey）被迫变更；
- 基线计数无法解释的偏差；
- 同步路径行为被迫变更（B1 默认方案实施受阻时改用备选方案，仍受阻即停）。

## 10. 初始化提示词（派单时复制给执行会话）

```text
你是 RP-047 Batch E 返工的执行会话（按 Qoder worktree 协议执行）。项目入口
/Users/kevin/AI/Workload-evaluation-system。请依次执行：

1. 读取必读清单：AGENTS.md、QODER.md、skills/wes-qoder-worktree-protocol/SKILL.md、
   skills/speak-plainly/SKILL.md、skills/improving-wes-ui/SKILL.md、
   本返工工单全文（docs/agent-loop/work-orders/2026-08-09-qoder-RP-047-E-REWORK.md）、
   原工单 §5/§6/§8、既有 handoff 全文。
2. 既有 worktree .claude/worktrees/rp-047-e-resilience-rollout 与分支
   qoder/rp-047-e-resilience-rollout 继续使用（baseCommit=1feda52），
   输出 Worktree Contract ACK。
3. 复跑 §3 基线；计数不符即停止回填疑点。
4. 按 §2 顺序 RED 先行实施 B1 → B2 → O2；严守 §5 Allowed Paths 与 §9 停止条件；
   §4 不回退口径全部保持；O1/O3 不实施。
5. 结束前跑 §7 全量验证，按 §8 提交业务实现 + handoff 返工节，
   状态停在"已回填 / 待主会话复审"。

主会话补充预警：
- B1 的关键不只是换掉抛错占位：workflow 内硬编码的空 modelChat 一并是阻断
  证据，真实组装必须含可用的 modelChat 与角色/模型口径（参照同步 handler）。
- B2 只处理 409/503 两态显式化，其他错误行为不动，不扩大范围。
- harness.routes.test.ts 存在既有 DB 串行隔离 flake（O3），遇到以单文件
  重跑通过为准，记录不修复。
- flag 启用一律走进程环境变量注入，不编辑主 checkout .env.local。
- 预计返工 2-4 小时；超出预期受阻时按 §9 停止并回填，不要硬扛。
```
