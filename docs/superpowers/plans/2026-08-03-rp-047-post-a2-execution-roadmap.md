# RP-047 Post-A2 Integration and Batch B-E Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已经通过 Codex Gate 的 Batch A2 安全集成到业务主线，并按 B、C、D、E 四个独立批次完成后台续跑、异步接口、多会话前端和灰度韧性闭环，最终在证据齐全后关闭 RP-047。

**Architecture:** 服务端 Harness Run 是任务生命周期唯一权威；Worker 与浏览器解耦，租约、检查点、事件、输出和 outbox 负责恢复与幂等。所有批次串行推进，每批一个 Qoder worktree、一个分支、一个结构化 handoff、一次 Codex Gate；只集成当前批次的最小已验证 patch。现有同步入口保留到 Batch E 灰度与回滚验证完成。

**Tech Stack:** TypeScript 5.8、Node.js 24、Express 4、Drizzle ORM 0.45、PostgreSQL 17 Testcontainers、Vite 5、React 18.3、现有 V2 组件体系与 Node test runner。

---

## 0. 当前基线与执行权

当前事实冻结在 2026-08-03：

- 业务主线：`codex/role-driven-ai-home-workbench @ cd02e8d`。
- A1 审计分支：`qoder/rp-047-a-durable-run-foundation @ fae8a7d`，结论为 `REJECTED`，禁止集成。
- A2 候选分支：`qoder/rp-047-a2-durable-run-foundation @ d9790fe`，结论为 `ACCEPTED_PENDING_USER`。
- A2 与当前主线分叉于 `7221503`；主线有 25 个独有提交，A2 有 8 个独有提交，因此禁止整分支 merge。
- 主工作区已有 `config/auth/users.json`、`config/versions/records.json` 两个运行态修改，所有批次必须保留，禁止 stage、restore、覆盖或带入提交。
- Batch B-E 当前保持锁定；完成上一批集成 Gate 后，Codex 才发布下一批详细计划和 Work Order。

### 角色分工

| 角色 | 责任 | 权限边界 |
|---|---|---|
| 用户 | 决定开始集成、最终人工验收和 RP 关闭 | 不需要维护内部过程文件 |
| Codex | 编制计划、发布 Work Order、独立 Gate、最小 patch 集成、看板同步 | 不创建需求池无人值守实现 Loop，不自动领取下一批 |
| Qoder | 在独立 worktree 中实施、测试、提交 handoff | 只能到“已回填 / 待 Codex 复核”，不得合并主线或标记已交付 |

### 全程硬门禁

- [ ] 每批开始前读取 `AGENTS.md`、`codex-project-registry.md`、`QODER.md`、`skills/speak-plainly/SKILL.md`、`skills/wes-qoder-worktree-protocol/SKILL.md`、其 `references/protocol.md` 和 `skills/wes-multi-agent-collaboration/SKILL.md`。
- [ ] Qoder 编辑前输出完整 Worktree Contract ACK；项目入口必须是 `/Users/kevin/AI/Workload-evaluation-system`。
- [ ] 每批先写失败测试，再实现，结束时提交逐文件清单、验证命令、风险、人工验收缺口和看板建议。
- [ ] 每批只允许一个业务目标和固定 Allowed Paths；发现基线漂移、共享文件冲突、真实密钥、权限/DB 边界变化时立即停止。
- [ ] `allowNextTask` 默认 `false`；只有上一批已集成并完成主线复验后，才可发布下一批工单。

## Task 1: 将 Batch A2 最小 patch 集成到主线

**Integration identity:**

- Source: `qoder/rp-047-a2-durable-run-foundation @ d9790fe`
- Target: `codex/role-driven-ai-home-workbench @ cd02e8d`
- Temporary integration branch: `codex/rp-047-a2-integration`
- Integration worktree: `.claude/worktrees/rp-047-a2-integration`

**Files:** A2 声明的 16 个文件；以 `git diff --name-status 7221503..d9790fe` 为唯一允许集合。不得包含 `config/auth/users.json`、`config/versions/records.json` 或其他主线运行态文件。

- [ ] **Step 1: 预检与隔离**

  Run:

  ```bash
  git status --short --branch
  git worktree list --porcelain
  git rev-list --left-right --count codex/role-driven-ai-home-workbench...qoder/rp-047-a2-durable-run-foundation
  git diff --name-status 7221503..d9790fe
  ```

  Expected: 主工作区仅保留两个已知运行态修改；分叉计数为 `25 8`；A2 变更集合为 16 个声明文件。

- [ ] **Step 2: 从当前主线建立集成 worktree**

  Run:

  ```bash
  git worktree add -b codex/rp-047-a2-integration .claude/worktrees/rp-047-a2-integration codex/role-driven-ai-home-workbench
  ```

  Expected: 新 worktree clean，HEAD 为执行时的业务主线 HEAD。若不再是 `cd02e8d`，先重新检查 A2 与新主线的文件冲突，不直接继续。

- [ ] **Step 3: 按提交顺序应用 A2，不做整分支 merge**

  在集成 worktree 中依次应用：

  ```bash
  git cherry-pick c94f9da 0483224 a16527e 312d33e 748af1a dc93bb3 39d5ea9 d9790fe
  ```

  Expected: 仅引入 A2 的 16 个文件。若发生冲突，只允许在这 16 个文件中解决；任何额外文件冲突立即停止并重新制定最小 patch。

- [ ] **Step 4: 运行集成态独立验证**

  Run:

  ```bash
  RP047_DOCKER_HOST=$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')
  DOCKER_HOST="$RP047_DOCKER_HOST" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock USE_TESTCONTAINERS=true npm run test:harness -w apps/api
  npm run test:modules
  npm run test:ai
  npm run test:integration
  npm run build:api
  npm run build:web
  git diff --check HEAD~8..HEAD
  git diff --exit-code HEAD~8..HEAD -- package-lock.json ui/V2_PROTOTYPE/package-lock.json
  ```

  Expected: Harness 全部通过且 0 skip；modules、AI、integration、API/Web build 全部退出 0；两个 lockfile 无变化。测试数量以集成时主线实际套件为准，不沿用旧的 143 项基线硬编码判断。

- [ ] **Step 5: 检查迁移与副作用边界**

  - `0014_talented_deathstrike.sql` 必须是 additive migration。
  - Testcontainers 结束后不得新增长期容器。
  - `config/auth/users.json`、`config/versions/records.json` 不得出现在集成分支 diff。
  - `config/system/requirement-settings.json` 如被测试触发变化，只能在确认是已知测试副作用后精确恢复，不得 broad restore。

- [ ] **Step 6: Codex 发布 Integration Gate**

  Gate 只允许三种结论：`INTEGRATED_READY`、`REWORK_REQUIRED`、`USER_DECISION_REQUIRED`。通过后把集成分支以最小已验证提交进入业务主线，更新总看板为“Batch A 已集成 / Batch B 待发布工单”；失败则只返工集成分支，不修改 A2 审计历史。

- [ ] **Step 7: 封存旧分支**

  在主线确认包含 A2 patch 后：为 A1 保留拒收审计 tag，为 A2 保留集成来源 tag；确认两个 Qoder worktree clean 后移除 worktree，再删除本地 A1/A2 分支。远端 push、远端分支删除不在本计划自动执行范围。

## Task 2: Batch B — Worker、检查点与恢复协调器

**Branch:** `qoder/rp-047-b-worker-recovery`

**Primary files:**

- Create: `apps/api/src/modules/harness/harness-runtime.worker.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.worker.test.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.recovery.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.recovery.test.ts`
- Create: `apps/api/src/modules/harness/harness-session-projector.ts`
- Create: `apps/api/src/modules/harness/harness-session-projector.test.ts`
- Modify: `apps/api/src/modules/harness/harness-runtime.repository.ts`
- Modify: `apps/api/src/modules/harness/harness-runtime.types.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`
- Modify: `apps/api/src/modules/ai-sessions/ai-sessions.repository.ts`
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.ts`
- Modify focused tests adjacent to the modified AI Session and dispatch owners.

- [ ] **Step 1:** Codex 基于已集成主线编写 Batch B 详细 implementation plan 和 Qoder Work Order，固定 Allowed Paths、fake workflow、故障注入点和停止条件。
- [ ] **Step 2:** Qoder 先用 fake workflow/provider 写 RED：输入后崩溃、工具成功后崩溃、模型流中断、最终消息投影前后崩溃。
- [ ] **Step 3:** 实现 Worker 认领、45 秒 lease、15 秒 heartbeat、优雅停机和硬退出后的租约过期。
- [ ] **Step 4:** 实现 10 秒 Recovery Coordinator、最多 3 次自动恢复、2/10/30 秒退避和 `RECOVERY_LIMIT_EXCEEDED`。
- [ ] **Step 5:** 实现 structural + semantic 混合检查点；模型流中断从 `model_input_ready` 重做，不拼接中断文本。
- [ ] **Step 6:** 使用稳定 `effectKey` 和 outbox deduplication key，保证工具副作用与 Session 消息投影不重复。
- [ ] **Step 7:** 接入现有 workbench dispatch 时必须传递服务端 `AbortSignal`，但不改变前端和现有同步 API。
- [ ] **Step 8:** 运行 focused fault-injection、Testcontainers Harness、`test:modules`、`test:ai`、API/Web build；Codex 独立复跑并发布 Gate B。

**Gate B 完成定义:** 四类崩溃均能从最近兼容检查点恢复；工具和消息无重复；取消请求在安全边界结束；A2 迁移、owner、并发与错误安全回归保持绿色。

## Task 3: Batch C — 异步 Run API 与可回放事件

**Branch:** `qoder/rp-047-c-async-run-api`

**Primary files:**

- Create: `apps/api/src/modules/harness/harness-runtime.usecase.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.controller.ts`
- Create focused tests for both files.
- Create: `apps/api/src/routes/ai-runs.routes.ts`
- Create: `apps/api/src/routes/ai-runs.routes.test.ts`
- Modify: `apps/api/src/routes/ai-sessions.routes.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/modules/ai-sessions/ai-sessions.usecase.ts`
- Modify: `docs/openapi.yaml`
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`

- [ ] **Step 1:** 冻结 `POST /api/v1/ai-sessions/:sessionId/runs` 的 HTTP 202、`submissionKey`、`clientMessageId` 与响应 envelope 测试。
- [ ] **Step 2:** 实现当前用户 active Runs 列表、Run snapshot、SSE replay、cancel、inputs、confirm、retry 契约。
- [ ] **Step 3:** 所有读取和动作使用 JWT + owner 隔离；猜测其他用户 runId 返回 404，不泄露资源存在性。
- [ ] **Step 4:** SSE 支持 `after` 和 `Last-Event-ID`；连接关闭只释放连接，不触发 cancel 或 aborted 状态。
- [ ] **Step 5:** Session 有非终态 Run 时硬删除返回 `409 SESSION_HAS_ACTIVE_RUN`；重命名、切换和普通归档不影响 Run。
- [ ] **Step 6:** 新接口受 feature flag 控制，旧同步入口继续可用；更新 OpenAPI 和实现对齐说明。
- [ ] **Step 7:** 运行 route integration、Harness、modules、AI、API build；Codex 独立验证重复提交、跨 owner、断线重连、取消、retry 与删除冲突并发布 Gate C。

**Gate C 完成定义:** API 契约、状态码、owner 安全、SSE 回放和断线不取消全部有集成测试；旧路径未被删除，feature flag 可关闭新入口。

## Task 4: Batch D — 前端多会话与后台任务体验

**Branch:** `qoder/rp-047-d-multisession-ui`

**Business surface:** AI 工作台及登录后 Shell 的后台任务提示。执行前必须读取 `skills/improving-wes-ui/SKILL.md`，复用现有 V2 组件和状态约定，不引入 Redux、Zustand 或第二 UI 技术栈。

**Primary files:**

- Create: `ui/V2_PROTOTYPE/src/hooks/useBackgroundRuns.jsx`
- Create: `ui/V2_PROTOTYPE/src/hooks/useSessionRuntimeStore.js`
- Modify: `ui/V2_PROTOTYPE/src/api/ai.js`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/AiWorkbench/SessionRail.jsx`
- Modify the authenticated Shell owner under `ui/V2_PROTOTYPE/src/components/Layout/` after the Batch D plan identifies the exact component.
- Modify: `ui/V2_PROTOTYPE/src/index.css`
- Create focused tests under `ui/V2_PROTOTYPE/src/__tests__/` for background runs, session isolation and reconnect behavior.

- [ ] **Step 1: 会话隔离 RED/GREEN。** 会话 A 执行时切到 B 并发送；A/B 可并行，A 的事件和最终消息不能写入 B 或抢回当前会话。
- [ ] **Step 2: 后台运行 RED/GREEN。** `BackgroundRunProvider` 放在登录后 Shell；离开 AI 页面只关闭本地 SSE，服务端 Run 继续；Shell 显示活跃数量和一次性完成通知。
- [ ] **Step 3: 恢复 RED/GREEN。** 刷新或重新登录后先拉 Sessions，再拉 active/recent Runs，合并 snapshot，按 cursor 重连；登出清理浏览器敏感缓存但不取消服务端 Run。
- [ ] **Step 4: 明确停止。** 只有用户点击停止才调用 cancel；页面切换、刷新、关页、SSE 断线和登出都不得取消。
- [ ] **Step 5: SessionRail 状态。** 展示排队、执行、恢复、等待确认、完成未读、失败、取消；状态文本、图标和颜色不能只依赖颜色表达。
- [ ] **Step 6: 视觉与可访问性。** 完成 1440px、760px、键盘、焦点、ARIA live region 和无横向溢出验证；单轮最多处理三个已证实 UI 根问题。
- [ ] **Step 7:** 运行 focused tests、Web 全量、`build:web`、UI scope checker；再以联调环境执行 A/B 并行、离页、刷新、重新登录和明确停止人工验收。Codex 发布 Gate D。

**Gate D 完成定义:** 自动化证明会话隔离、后台继续、重连与明确停止；浏览器人工验收覆盖 1440px、760px 和键盘路径；没有引入第二状态/UI 栈。

## Task 5: Batch E — 全链路韧性、灰度与回滚

**Branch:** `qoder/rp-047-e-resilience-rollout`

**Primary files:** Batch E 详细计划必须在 Gate D 后根据实际 Worker/API/UI owner 列出；允许范围限于已有 Harness runtime、AI Run API、V2 后台运行组件、运行配置、OpenAPI 和运维文档，不删除旧同步入口。

- [ ] **Step 1:** 建立端到端故障矩阵：API 重启、Worker 硬退出、模型流中断、工具成功后崩溃、Session 写入后崩溃、SSE 断线和检查点版本不兼容。
- [ ] **Step 2:** 在干净 PostgreSQL 和已有 Harness 数据库各执行一次 `0014` 及后续迁移演练，记录向前与回滚边界。
- [ ] **Step 3:** 增加 `WES_AI_DURABLE_RUNS_ENABLED` 灰度开关；关闭时完整回到旧同步路径，不能遗留半激活 API/UI。
- [ ] **Step 4:** 记录最小可运维指标：队列等待、运行耗时、恢复次数、lease 过期、checkpoint 数、SSE 重连、outbox backlog、失败码分布。
- [ ] **Step 5:** 运行容量观察和故障注入，确认没有重复工具副作用、重复 Session 消息、跨 owner 泄露或无限恢复循环。
- [ ] **Step 6:** 更新 OpenAPI、实现对齐说明、运行手册、测试证据、风险与总看板；不得把演练结果描述成生产上线。
- [ ] **Step 7:** 完成用户人工验收：A/B 并行、离页、刷新、关页、重新登录、明确停止和逆序返回；Codex 发布最终 Gate E。

**Gate E 完成定义:** 自动化、构建、真实 PostgreSQL 迁移演练、API/Worker/模型故障演练、灰度回滚和用户人工验收分别有证据；旧路径仍可回退。

## Task 6: RP-047 关闭与分支治理

- [ ] **Step 1:** 确认 Batch A-E 均已进入业务主线，主线运行完整验证矩阵：Harness、modules、AI、integration、Web、API/Web build、安全扫描和 UI scope。
- [ ] **Step 2:** 检查 OpenAPI、实现对齐说明、运行手册、总看板 requirements/plan/testing/monitoring/risks/changes/sources/runtime 一致。
- [ ] **Step 3:** 只有用户人工验收有当前证据时，才把 RP-047 标为“已交付 / 已关闭”；否则保持“代码已集成 / 待人工验收”。
- [ ] **Step 4:** 对每个已集成 Qoder 分支保留来源 tag，确认 worktree clean 后移除 worktree 和本地分支；远端清理由用户另行授权。
- [ ] **Step 5:** 记录最终主线 commit、验证命令、残余风险、回滚开关和后续运维 owner。

## 批次总览与预计节奏

| 阶段 | 业务结果 | 建议工期 | 启动条件 |
|---|---|---:|---|
| A2 集成 | 持久 Run 数据基础进入主线 | 0.5-1 天 | 用户明确授权集成 |
| B | 后台 Worker 可续跑，故障不重复副作用 | 3-5 天 | A2 主线集成 Gate 通过 |
| C | 前端可通过异步 API 查询、订阅、取消和重试 | 2-4 天 | Gate B 通过 |
| D | A/B 会话并行，离页/刷新/登录后可恢复 | 3-5 天 | Gate C 通过 |
| E | 故障演练、灰度、回滚、运维证据齐全 | 2-4 天 | Gate D 与浏览器验收通过 |
| 关闭 | 主线回归、人工验收、看板和分支收口 | 0.5-1 天 | Gate E 通过 |

总工期建议按 11-20 个工作日管理；这是串行 Gate 的工程区间，不是承诺上线日期。任何批次出现 P1 阻断时，计划自动停在本批返工，不挪用下一批工期掩盖风险。

## Self-review

- 批次顺序与批准规格 A-E 一致；A2 集成被单列为先决任务。
- Qoder 实施、Codex Gate/集成、用户最终验收的权限没有混淆。
- 主工作区两个运行态修改、A1 拒收分支和 A2 最小 patch 边界均被显式保护。
- API、owner 隔离、SSE 不取消、Worker 恢复、effectKey/outbox 幂等、前端会话隔离、灰度回滚和人工验收都有对应 Gate。
- 本计划不自动启动 Batch B，不自动合并主线，不删除远端分支，不触碰真实密钥，不宣称 RP-047 已交付。
