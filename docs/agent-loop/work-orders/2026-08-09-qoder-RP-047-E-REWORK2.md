# Qoder Work Order — RP-047 Batch E 二次返工 · 新通道消息落库双缺陷修复（离页返回消息丢失）

> 来源：2026-08-09 用户人工验收第 3 条不通过（问题池 ISS-2026-08-09-002）。
> 现象：开关（`WES_AI_DURABLE_RUNS_ENABLED=true`）开启状态下，用户在会话
> `c118bc00-1e5d-4d49-a6b0-841f17c99e63` 发送「利润中心是什么」后切走页面再返回，
> 本轮用户消息与 AI 回复均不可见。
> 主会话只读取证结论：消息未真丢（run 正常完成、回复全文在库），但数据落库链路
> 存在两个系统性缺陷，影响 flag-on 下的**每一轮**对话。

## 1. 缺陷事实（主会话已取证，执行会话须复现）

### 缺陷 A（阻断）：projector 取错字段，assistant 消息落成空内容

- outbox 写入侧 payload 结构为 `{ trace, answer, intent, suggestedActions }`
  （证据：`SELECT payload FROM harness_session_outbox` keys 实测）；
- `harness-session-projector.ts` L84-87 读取 `payload.message`，不存在时回退
  `{ role: "assistant", content: "" }` → `data/ai-sessions.json` 中该会话末尾
  出现 2 条空 assistant 消息；
- `payload.answer` 内容完整（已抽样核实全文），即「回复在库、投影落空」。

### 缺陷 B（阻断）：用户消息在 flag-on 链路从未写入会话存储

- 旧同步路径「用户消息 + AI 回复」一并写会话；新路径仅 outbox 投影 assistant
  事件，run 提交链路无用户消息落库动作；
- 证据：该会话文件中 12 条历史消息完好，本轮「利润中心是什么」user 消息不存在；
- 直接后果：离页返回后前端取到的会话缺本轮用户消息，验收口径「离页/刷新/关页
  回页后消息水合不丢不重」不成立。

### 观察项 C（核查，不扩大修复）：意图误判疑点

- outbox payload 显示「利润中心是什么」被 modelClassification 归为
  `unsupported_or_out_of_scope`（routingRule 仍为 default_domain_qa）；
- 要求复现并给结论：确属误判则记录根因与修复建议（不在本批实施），
  判定合理则说明理由。

## 2. 合同坐标

- 执行位置：**新建 worktree** `.claude/worktrees/rp-047-e-rework-msg-landing`，
  分支 `qoder/rp-047-e-rework-msg-landing`。
- baseCommit：`cb5875d`（当前 main HEAD）。
- 初始化硬步骤（协议已固化）：worktree 建好后先执行仓库根 `npm install`；
  验证涉及前端时另在 `ui/V2_PROTOTYPE/` 执行 `npm install`；两步 exit=0 方可开工。
- 状态权威：handoff 原文件 `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md`
  追加「二次返工节」，状态停在「已回填 / 待主会话复审」。
- 原工单与首次返工工单的 §不回退口径（G-E2/G-E3/G-E4/G-E5）全部继续有效。

## 3. 返工范围（仅三项，超出即停止回填）

### C1（阻断）：outbox payload 与 projector 契约对齐

修复方向（二选一，以契约文档注释为准优先方案 1）：

1. **写入侧对齐契约**：outbox enqueue 处 payload 改为
   `{ message: { role, content, metadata? }, ...既有 trace/intent 等保留 }`，
   projector/sink 零改动；或
2. **投影侧兼容**：projector 读取 `payload.message ?? 由 answer 包装`。

要求：
- 选定方案后 RED 先行：focused 端到端守护测试——提交 run → worker 完成 →
  outbox → projector → 会话 assistant 消息**内容非空且与 answer 一致**；
- 既有已 published 的坏数据不要求回填修复（登记说明即可）。

### C2（阻断）：flag-on 提交链路写入用户消息

- run 提交成功（202）前或提交事务内，用户消息按旧同步路径同款结构幂等写入
  会话 messages（复用 ai-sessions 仓库公开 API，来源键可用
  `clientMessageId` 或 run 维度 deduplicationKey，防重放重复）；
- RED 先行：提交后立即可从会话存储读到本轮 user 消息；重复提交不产生重复消息；
- 503 回退同步路径行为零变更（旧路径本来就自己写，不得双写）。

### C3（核查）：意图误判疑点结论

按 §1 观察项 C 复现并写入 handoff 结论，不改分类代码（除非复现证明是
一行内的显式笔误且在本批 Allowed Paths 内，否则只记录）。

## 4. 基线事实（开工前必须复现，按实际计数报告）

| 套件 | 参考计数（main HEAD cb5875d） |
|---|---|
| test:web | 264 |
| test:modules | 265 |
| test:ai | 256 |
| test:harness | 173（遇既有 DB 串行隔离 flake 以单文件重跑为准） |
| test:integration | 1 |
| build:api / build:web | exit 0 |

计数不符时：先确认是否依赖未装（协议硬步骤），仍不符即停止回填疑点。

## 5. 不回退口径（返工后必须继续成立）

- G-E2：flag off 字节级回退旧同步路径；503 探测守护通过。
- G-E3：effectKey `workbench_chat_answer` + deduplicationKey
  `${runId}:assistant:1` 双证据口径零变更。
- G-E4：唯一 cancel 触发路径仍是用户显式停止。
- G-E5：`/ai/home-workbench/chat` 同步链路保留；409 文案拦截行为不变。
- 零新依赖（含 dev）；DB schema 与迁移文件零变更；package-lock 零 diff。
- 前端零改动（本批根因在数据层；若复现证明前端空消息渲染另有缺陷，
  记录疑点不在本批修）。

## 6. Allowed Paths（超出即停止并回填疑点）

- `apps/api/src/modules/harness/harness-session-projector.ts`（仅限方案 2 时）
- `apps/api/src/modules/harness/harness-session-projector.test.ts`
- `apps/api/src/modules/harness/workbench-chat.workflow.ts`（outbox enqueue 与用户消息落库接线）
- `apps/api/src/modules/harness/workbench-chat.workflow.test.ts`
- `apps/api/src/modules/harness/harness-boot.ts` / `harness-boot.test.ts`（仅接线需要时）
- `apps/api/src/modules/harness/harness.usecase.ts` / `harness.usecase.test.ts`（仅 run 提交写用户消息需要时）
- `docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md`

若 outbox enqueue 实际位置在上述之外，停止并回填疑点，由主会话扩批。

## 7. 验证命令（全量）

```bash
# 前端（ui/V2_PROTOTYPE）
npm run test:web && npm run build

# 后端（apps/api）
npm run test:modules && npm run test:ai && npm run test:integration && npm run build

# harness DB 实跑
cd apps/api && DOCKER_HOST=unix:///Users/kevin/.colima/default/docker.sock \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
USE_TESTCONTAINERS=true npm run test:harness

# 守护 diff（依赖与 schema 零变更）
git diff --stat cb5875d -- package-lock.json apps/api/drizzle/
# 预期：零输出
```

## 8. 提交与回填

1. 业务实现提交（可 1-2 笔）：`fix(harness): Batch E 二次返工 · 新通道消息落库双缺陷` 格式。
2. handoff 更新单独一笔：追加「二次返工节」（缺陷复现证据、方案选择理由、
   新增测试清单、全量验证计数、C3 结论），状态停在「已回填 / 待主会话复审」。
3. 回填必须附全量验证命令的**完整输出摘录**（计数与 exit code），不接受仅结论。
4. 不合并 main、不自宣「已交付」。

## 9. 停止条件

- 触碰 Allowed Paths 之外文件；
- 冻结参数（workflowId/version/effectKey/deduplicationKey）被迫变更；
- 同步路径行为被迫变更；
- 基线计数无法解释的偏差（排除依赖未装后）。

## 10. 初始化提示词（派单时复制给执行会话）

```text
你是 RP-047 Batch E 二次返工（新通道消息落库双缺陷修复）的执行会话
（按 Qoder worktree 协议执行）。项目入口 /Users/kevin/AI/Workload-evaluation-system。
请依次执行：

1. 读取必读清单：AGENTS.md、QODER.md、skills/wes-qoder-worktree-protocol/SKILL.md、
   skills/speak-plainly/SKILL.md、本工单全文
   （docs/agent-loop/work-orders/2026-08-09-qoder-RP-047-E-REWORK2.md）、
   既有 handoff（docs/agent-loop/handoffs/2026-08-09-qoder-RP-047-E.md）。
2. 新建 worktree .claude/worktrees/rp-047-e-rework-msg-landing
   （分支同名，base=cb5875d）；初始化后必须先 npm install（根目录 +
   ui/V2_PROTOTYPE），两步成功才开工；输出 Worktree Contract ACK。
3. 复现 §1 两个缺陷（DB 查询 + 文件核对），复跑 §4 基线；不符即停止回填疑点。
4. RED 先行实施 C1 → C2，C3 只出结论；严守 §6 Allowed Paths 与 §9 停止条件；
   §5 不回退口径全部保持；前端零改动。
5. 结束前跑 §7 全量验证（附完整输出摘录），按 §8 提交业务实现 + handoff
   二次返工节，状态停在"已回填 / 待主会话复审"。

主会话补充预警：
- 缺陷 A 优先方案 1（写入侧对齐 projector 契约），契约注释以 projector 为准。
- 缺陷 B 的用户消息落库必须幂等（来源键去重），且 503 回退路径不得双写。
- 历史坏数据（2 条空 assistant 消息）不回填修复，handoff 登记说明即可。
- flag 启用一律走进程环境变量注入，不编辑主 checkout .env.local。
- 预计 2-4 小时；受阻按 §9 停止并回填，不要硬扛。
```
