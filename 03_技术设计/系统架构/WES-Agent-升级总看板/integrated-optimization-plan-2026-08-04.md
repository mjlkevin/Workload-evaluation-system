# WES AI 工作台综合优化计划方案

> **制定日期**: 2026-08-04
> **状态**: 方案草案 / 待决策
> **输入来源**: ① 2026-08-03 架构分析与优化计划（architecture-optimization-plan-2026-08-03.md、codex-briefing-2026-08-03.md）② 开源工具雷达（github-radar.html，GT-001 DeepEval / GT-002 Langfuse）③ 需求池（01_需求管理/未来需求池.md 与总看板主台账）
> **架构约束**: 严格遵循 AGENTS.md 架构边界（§2 存储边界、§3 权限、§7 前端约定、§12 禁止事项）
> **事实基线**: 阶段 1H-B 已交付 / 1H-C 规划中 / RP-047 A2 已于 2026-08-03 合入业务主线（88054d5）

---

## 一、执行摘要

本方案把三个信息源收敛为 **10 项优化措施（O1–O10）**，总预估工时 **约 160–175h**（O3 于 2026-08-06 并入 RP-047 Batch B+C，由 10h 扩至粗估 50–65h；同日 O10 作为 RP-049 新措施纳入 16h；其余项不变），按 4 个 Sprint + Gate 驱动串行批次排布：

| 优先级 | 优化项 | 来源 | 预估工时 |
|--------|--------|------|---------|
| **P0** | O1 前端组件拆分 | 架构瓶颈 #1 | 19h |
| **P0** | O2 Agent 工具扩展 | 架构瓶颈 #2 | 15h |
| **P1** | O3 Harness 持久执行与异步事件通道（并入 RP-047 Batch B+C） | 架构瓶颈 #3 / RP-029 批次 1 / RP-047 | 粗估 50–65h |
| **P1** | O4 AI 服务层 handler 化重构 | 架构分析 | 15h |
| **P1** | O5 AI 会话 × Harness 统一视图 | 架构瓶颈 #3 / RP-047 衔接 | 11h |
| **P1** | O6 AI 输出质量回归基线 | 雷达 GT-001 DeepEval | 8h |
| **P1** | O10 AI 工作台兜底路由与静态回复策略优化 | ISS-2026-08-06-001 / RP-049 | 16h |
| **P2** | O7 Trace 观测演进映射 | 雷达 GT-002 Langfuse / RP-030 | 10h |
| **P2** | O8 SSE 前端流式 UX | RP-029 批次 2 | 6h |
| **P2** | O9 AI 模块 facade 落地迁移 | 架构分析 | 10h |
| | **合计** | | **约 160–175h** |

**核心判断**：

1. 三个架构瓶颈（前端巨型聚合、Agent 工具仅 1 个、JSON/PG 双轨）仍是本方案主线，与 2026-08-03 优化计划一致；
2. 雷达两项收录（DeepEval、Langfuse）**均不引入完整框架**，只借鉴方法论落地轻量版（O6、O7），遵守"收录 ≠ 引入"口径；
3. 需求池中与 AI 工作台直接相关的缺口（RP-029、RP-035、RP-047、RP-004、RP-005）已逐项映射到优化项或明确维持待规划；
4. 全部措施均以**不破坏"文件是上下文，用户意图才触发工作流"产品口径**为硬约束（见第十节支持矩阵）；
5. 2026-08-06 新增用户反馈（ISS-2026-08-06-001 兜底回复僵硬）经分诊为 RP-049 并已细化实现计划，纳入本方案为 **O10（P1）**，排在 O4 之前（双方改同一服务文件，见 §5.10）。

---

## 二、当前架构事实基线（摘要）

### 2.1 AI 工作台核心链路

```
AiHomeWorkbench.jsx（2602 行）sendMessage
  │
  ├─ 有附件 → POST /ai/parse-basic-info（文件解析，同步）
  │     ├─ 前端 isExplicitReportRequest 闸门 ──是──→ createHarnessRun → bindHarnessFile
  │     │                                          → submitHarnessParseResult → generateHarnessReportV1
  │     └──────────────────────────────否──→ 仅作为上下文进入普通对话
  │
  └─ 无附件 / 普通对话 → POST /ai/home-workbench/chat（或 /chat/stream SSE）
        │
        ▼
  chat.service.ts（911 行）homeWorkbenchChat
        │  鉴权 → ensureHomeAiSession → appendAiSessionEvent
        │  显式报告路径二次判定（后端闸门）→ 角色预设注入（HOME_ROLE_PRESETS 7 角色）
        ▼
  workbench-intent.service.ts（216 行）routeWorkbenchIntent
        │  10 种意图规则路由 + RP-003 模型二次分类兜底（confidence ≥ 0.6）
        ▼
  workbench-dispatch.service.ts（1002 行）dispatchHomeWorkbenchTurn
        │  capability / wes_data_query / write_action / report / knowledge
        │  / attachment_qa / attachment_summary / domain_qa …
        ▼
  harness.usecase.ts（1126 行）受控任务运行时
        uploaded → parsing → evidence_ready → analyzing → report_v1_ready
        → clarifying → report_v2_ready → completed / failed* / cancelled
        confirmHarnessAction（幂等锁）→ enter_formal_estimation → 项目 + 评估草稿
```

### 2.2 关键架构事实

| 事实 | 现状 |
|------|------|
| 意图路由 | 10 种 WorkbenchIntent，优先级：clientAction → 问候 → 能力发现 → WES 数据查询 → 写动作 → v2 显式 → 报告生成 → 附件问答/摘要 → 知识库 → domain_qa 兜底 |
| 双轨存储 | AI 会话 JSON（data/ai-sessions.json）+ Harness PostgreSQL 8 张表；经 aiSessionId 与 metadata.links 关联 |
| 会话管理 | appendAiSessionEvent 统一事件追加，ownerUserId 数据隔离 |
| 角色预设 | sales / pre_sales / delivery / pm / pmo / dev / admin 共 7 种 BusinessRole，注入 system prompt |
| 流式能力 | RP-029 批次 1 后端 SSE（homeWorkbenchChatStream）已就绪，前端逐字渲染未闭环 |
| 审计底座 | Harness 8 表：runs / files / evidences / artifacts / tool_events / model_runs / scores / cases |
| Agent 编排 | orchestrator.ts 84 行，工具注册表仅 1 个 buildEstimateTool |

### 2.3 "文件是上下文，意图才触发工作流"四处防护

1. **前端闸门**：AiHomeWorkbench.jsx L2113 `isExplicitReportRequest(text)`，上传文件不自动创建 Run；
2. **后端闸门**：chat.service.ts L474 同样判定 `parsedAttachment && isExplicitReportRequest(...)`；
3. **意图路由**：有附件但无报告意图时仅路由到 `attachment_qa` / `attachment_summary`；
4. **状态机防护**：v1 后追问不自动生成 v2；写动作 `requiresConfirm`；stage 校验；ToolEvent 留痕。

---

## 三、输入源盘点

### 3.1 需求池状态映射

**主台账口径**（总看板 requirements.html）：需求池共 40 项 = 22 项已交付 + 8 项已交付待验收回填 + 8 项待规划/待确认/待验收 + 2 项暂缓。

与 AI 工作台相关的需求：

| 需求 | 状态 | 业务价值 | 本方案处置 |
|------|------|---------|-----------|
| RP-047 会话级多通道运行时 | A2 已合入主线（88054d5）；Batch B–E 锁定未启动 | 消除 localStorage+JSON+PG 三处状态分散 | 2026-08-06 用户决策：Batch B+C 完整范围并入 O3（见 §5.3）；Batch D 由 O5 衔接，Batch E 后续独立批次 |
| RP-035 AI Native Command Center | 已分析 / 待设计（P1） | 首页从文档导航升级为 AI 指挥中心 | 依赖 O5 统一视图数据地基，排在本方案 Sprint 3 之后 |
| RP-029 流式输出（3 批） | 批次 1 后端已就绪；前端 UX 未完成 | 实时响应体验 | O3 补 Harness 侧推送，O8 承接批次 2 前端逐字渲染 |
| RP-024 Napkin 视觉生成 | 待规划 | PPT 页面生成闭环 | 不纳入本方案，维持待规划 |
| RP-001 低代码工作流设计器 | 暂缓（工作流模板硬编码在前端） | 工作流配置化 | 不纳入本方案；O1 前端拆分时将模板选择器独立为组件，为未来设计器预留接口 |
| RP-004 Run Timeline / Artifact Workspace | 已分析 / 待规划（P1） | Harness run 全链路可视 | O1 的 WorkspacePanel 组件与之天然衔接 |
| RP-005 售前估算助手 v1 | 已分析 / 待拆分（P1） | 材料→需求包→初估最小闭环 | 依赖 O2 工具扩展（估算/查询类工具） |
| RP-008 WPS WebOffice 文档资产 | 已分析 / 待规划（P1） | 附件持久化与在线编辑 | 需独立文档资产域建设，单独排期，不纳入本方案 |
| RP-028 Kimi Provider 稳定性 | 已分析 / 待规划（P1） | 超时/重试/Token 审计 | 建议并入 RP-027 技术债修复合并实施 |
| RP-049 AI 工作台兜底路由与静态回复策略优化 | 2026-08-06 新增（ISS-2026-08-06-001 分诊，实现计划已细化） | 常规提问默认获得模型自然回复，消除静态模板僵硬 | 纳入本方案为 O10（见 §5.10），Sprint 2 排在 O4 之前 |

**已交付可复用能力**（不在本方案范围，作为依赖项）：RP-003 模型意图分类兜底、RP-006 多附件合并、RP-008 主体检索（主台账编号）、RP-025 错误分类、RP-030 统一 Trace、RP-031 多知识库路由。

> ⚠️ **编号口径勘误（治理项）**：`01_需求管理/未来需求池.md`（2026-06-29 复核版）中的 RP-001/003/006/008 与总看板主台账编号不一致（如该文件 RP-001 = exports/history 接线修复，主台账 RP-001 = 低代码工作流设计器）。本方案统一采用**主台账编号**；`未来需求池.md` 的编号对齐列入文档治理待办。

### 3.2 开源雷达收录项

| 编号 | 工具 | 三维评级（启发/优化/架构） | 本方案落点 |
|------|------|---------------------------|-----------|
| GT-001 | DeepEval（Python / Apache-2.0 / ⭐17,369） | ★★★★★ / ★★★★☆ / ★★★☆☆ | **O6**：借鉴 G-Eval + JSON Correctness 方法论，在 test:ai 中实现 TypeScript 轻量版，零依赖引入 |
| GT-002 | Langfuse（TS / MIT / ⭐32,428） | ★★★★★ / ★★★★☆ / ★★★★★ | **O7**：先做 trace/span 映射表 + PG 迁移 PoC，不部署自托管服务 |

**结合点核验结论**（摘自雷达页，已代码核验）：

- DeepEval：`test:ai` 约 20 个测试文件全部为确定性功能断言，**无真实模型输出质量回归线**；`apps/api/src/ai/contracts/` 已有结构校验但仅"结构能解析"层级；规则引擎回归已有 `rule-regression-check.js` 守护，但 LLM 参与环节（抽取器、AI 兜底路由）输出质量无监控；
- Langfuse：RP-030 统一 Trace 的 8 类 span 与 Langfuse trace/span 模型同构；trace 现为 JSON 文件存储而 PostgreSQL `traces` 表已在 db schema 定义；提示词资产实为 `config/rag/prompts.json`（knowledge span 已记录 prompt id/version/hash），具备 Prompt 版本管理雏形。

---

## 四、总体优化地图

```
架构瓶颈 #1（前端 2602 行）─────→ O1 前端组件拆分（P0）
架构瓶颈 #2（Agent 仅 1 工具）──→ O2 工具扩展（P0）
架构瓶颈 #3（JSON/PG 双轨）────→ O3 SSE（P1）+ O5 统一视图（P1）
服务层 1001/911 行多职责───────→ O4 handler 化（P1）+ O9 facade 落地（P2）
RP-029 流式前端缺口────────────→ O8（P2）
GT-001 DeepEval 候选───────────→ O6 输出质量回归基线（P1，新立项候选）
GT-002 Langfuse 候选───────────→ O7 Trace 观测演进（P2，新立项候选）
```

---

## 五、优化措施详述

### 5.1 O1 前端组件拆分（P0，19h）

**目标**：AiHomeWorkbench.jsx 2602 行 → 入口 ≤100 行、子组件 ≤200 行。

**结构**（沿用 2026-08-03 方案）：`pages/AiHomeWorkbench/` 下 index.jsx + hooks（useWorkbenchState / useHarnessRun / useChatMessages）+ components（ChatArea / WorkspacePanel / StatusPanel）+ utils（harnessPayload / reportParser / messageFormatter）。

**实施步骤**：

| 步骤 | 任务 | 工时 |
|------|------|------|
| F1 | 创建目录，提取 utils | 2h |
| F2 | useWorkbenchState 收敛分散 useState | 3h |
| F3 | ChatArea 拆分（MessageList/MessageBubble/Composer/WorkflowTemplates） | 4h |
| F4 | StatusPanel 拆分（改造 ArtifactPanel） | 3h |
| F5 | WorkspacePanel 新建（报告渲染 + 证据溯源，衔接 RP-004） | 4h |
| F6 | index.jsx 纯布局组装 | 2h |
| F7 | build:web + 功能回归（上传/报告/确认/会话） | 1h |

**验收标准**：build:web 通过；入口 ≤100 行；子组件 ≤200 行；上传→报告→确认→会话全链路回归通过；**前端 `isExplicitReportRequest` 闸门完整保留于 utils 并维持与后端口径一致**。

**口径支持**：F1 提取闸门函数时补一条双端一致性单测（同一组文案前后端判定结果一致）。

### 5.2 O2 Agent 工具扩展（P0，15h）

**目标**：注册工具 1 → ≥8；18 个业务模块的 AI 可触达面从 5 个扩展。

**工具清单**：buildEstimateTool（已有）+ buildProjectListTool / buildEstimateHistoryTool / buildKnowledgeQueryTool / buildRuleLookupTool（查询类）+ buildCreateProjectTool / buildGenerateWbsTool / buildExportReportTool（写操作类，含确认机制）。

**实施步骤**：A1 查询工具接口实现 4h → A2 写操作工具（need_confirm）4h → A3 注册进 createDefaultRegistry 1h → A4 RuntimeContext 注入编排循环 2h → A5 单测 3h → A6 test:modules 验证 1h。

**验收标准**：test:modules 通过；注册数 ≥8；写操作全部触发 need_confirm；RBAC 能力位过滤正确；test:security 门禁通过。

**口径支持**：所有工具入参中附件/证据只作为上下文引用（evidenceId/artifactId），工具本身不能因"存在文件"而自动触发；写工具沿用 requiresConfirm 语义。

### 5.3 O3 Harness 持久执行与异步事件通道（P1，完整承接 RP-047 Batch B + Batch C，粗估 50–65h）

**【2026-08-06 用户决策：范围重定义】** 原 O3（10h 简单 SSE 推送）经前置核对确认与 RP-047 Batch C 通道重复；用户决定**将 Batch B→C 完整功能范围并入 O3**，O3 升级为“持久执行引擎 + 异步事件通道”，实施内容以 `docs/superpowers/plans/2026-08-03-rp-047-post-a2-execution-roadmap.md` Task 2/Task 3 为唯一范围基准。

**目标**：AI 任务从“同步阻塞、页面不能关”升级为“后台续跑、崩溃可恢复、异步提交、事件可回放”：Run 状态更新从手动刷新 → 实时推送且断线重连不丢事件。

**基座事实**：A2 数据底座已合入主线（88054d5）：持久 Run 表、lease、事件序列、检查点、输出版本与 outbox 幂等原语已落位（harness-runtime.repository/types），B/C 直接在此地基上建设。

**阶段一 O3-B：Worker、检查点与恢复协调器（对应 Batch B，粗估 30–40h）**

实施内容（roadmap Task 2）：

1. Worker 认领与租约：45s lease + 15s heartbeat + 优雅停机与硬退出后租约过期；
2. Recovery Coordinator：10s 周期扫描、最多 3 次自动恢复、2/10/30s 退避、超限 `RECOVERY_LIMIT_EXCEEDED`；
3. 混合检查点：structural + semantic；模型流中断从 `model_input_ready` 重做，不拼接中断文本；
4. 幂等：稳定 `effectKey` + outbox deduplication key，工具副作用与 Session 消息投影不重复；
5. 接入 workbench dispatch 时传递服务端 `AbortSignal`，**不改变前端与现有同步 API**；
6. RED 先行：用 fake workflow/provider 先写四类崩溃失败测试（输入后崩、工具成功后崩、模型流中断、投影前后崩）。

**Gate B 验收（roadmap 原文）**：四类崩溃均能从最近兼容检查点恢复；工具和消息无重复；取消请求在安全边界结束；A2 迁移、owner、并发与错误安全回归保持绿色。

**阶段二 O3-C：异步 Run API 与可回放事件（对应 Batch C，粗估 20–25h，仅在 Gate B 通过且集成后开工）**

实施内容（roadmap Task 3）：

1. 异步提交：`POST /api/v1/ai-sessions/:sessionId/runs` 返回 202，含 `submissionKey`/`clientMessageId` 幂等防重；
2. 读取与动作：active Runs 列表、Run snapshot、SSE replay、cancel、inputs、confirm、retry；
3. SSE 断线重连：支持 `after` 与 `Last-Event-ID`；连接关闭只释放连接，不触发 cancel 或 aborted；
4. 安全：JWT + owner 隔离，猜测他人 runId 返 404 不泄露存在性；Session 有非终态 Run 时硬删除返 `409 SESSION_HAS_ACTIVE_RUN`；
5. feature flag 控制新入口，旧同步入口继续可用；同步更新 `docs/openapi.yaml` 与实现对齐说明。

**Gate C 验收（roadmap 原文）**：API 契约、状态码、owner 安全、SSE 回放和断线不取消全部有集成测试；旧路径未被删除，feature flag 可关闭新入口。

**执行机制（不可绕过）**：沿用 roadmap 角色分工与硬门禁——① 每批开工前由 Codex 基于已集成主线发布详细 implementation plan + Qoder Work Order（固定 Allowed Paths、fake workflow、故障注入点与停止条件）；② Qoder 在独立 worktree 实施（Worktree Contract ACK + RED 先行 + 结构化 handoff，状态只到“已回填/待复核”）；③ Codex 独立复验发布 Gate B / Gate C；④ 串行推进，`allowNextTask` 默认 false，Gate 通过并集成后才发下一批工单；⑤ 验证套件：Testcontainers `test:harness`、`test:modules`、`test:ai`、`test:integration`、`build:api`、`build:web`，两个 lockfile 零变更。

**范围外声明**：Batch D（前端多会话/后台任务体验）与 Batch E（灰度回滚）不属本 O3，分别由 O5 衔接与后续独立批次承接；RP-047 关闭与分支治理在证据齐全后另行安排。

**口径支持（硬约束）**：SSE/事件只推送已发生的状态变更，不引入任何“自动进入下一阶段”逻辑，stage 推进仍由用户意图动作触发；`isExplicitReportRequest` 双端闸门零变更；前端与现有同步 API 在 B/C 中不改（Batch E 前）。

**风险与对策**：① 范围显著大于原 O3，Sprint 排期改为 Gate 驱动串行，不硬套周历；② Batch B 故障注入复杂度高，靠 RED 先行 + fake workflow 控制；③ 现有单次快照端点 /harness/runs/:runId/events 在 Batch C 交付前保持原样，不提前改造。

### 5.4 O4 AI 服务层 handler 化重构（P1，15h）

**目标**：chat.service.ts ≤200 行、workbench-dispatch.service.ts ≤200 行；按意图拆 7 个 handler（capability / domain-qa / knowledge-query / attachment-qa / harness-report / wes-data-query / write-action）。

**实施步骤**：S1 Handler 接口 1h → S2 提取 7 个 handler 6h → S3 chat.service 精简为入口路由 2h → S4 dispatch 精简为分发器 2h → S5 handler 单测 3h → S6 test:ai 验证 1h。

**验收标准**：test:ai 通过；两主文件 ≤200 行；**意图路由行为零变更**（先补意图路由快照测试再动刀）；四处口径防护在重构后逐一回归。

**风险与对策**：这是唯一可能伤及意图行为的措施。对策 = 重构前先落"意图路由 + 闸门判定"快照测试集（固定输入 → 固定意图），重构后快照必须全绿。

### 5.5 O5 AI 会话 × Harness 统一视图（P1，11h）

**目标**：新增只读聚合接口 `GET /api/v1/ai-sessions/:sessionId/unified-view`，一次性返回会话事件 + 关联 Harness run + artifacts + pending actions，消除前端四套状态拼装。

**实施步骤**：D1 聚合 usecase 3h → D2 controller/路由 2h → D3 owner 隔离与响应结构 1h → D4 前端 useUnifiedView 替换分散拉取 3h → D5 测试 1h → D6 文档（openapi.yaml）1h。

**验收标准**：接口返回 `{code, message, data}`；非 owner 不可见；JWT 鉴权；openapi.yaml 同步。

**兼容性**：纯读聚合（JSON 会话 + PG Harness），不新增写入、不改变存储主路径，不触发 DB 迁移触发器。

**口径支持**：视图按"会话 → 由用户意图产生的 run"方向聚合展示，不反向赋予 run 触发会话动作的能力。

### 5.6 O6 AI 输出质量回归基线（P1，8h，源自 GT-001）

**目标**：为工作量评估、售前简报、需求解析报告三类核心产物建立"固定样本 → 结构断言 + 语义评分"的回归线，填补 test:ai 只有确定性断言的空白。

**实施步骤**：

| 步骤 | 任务 | 工时 |
|------|------|------|
| Q1 | 定义 TypeScript 轻量评测原语：JSON Correctness 断言器 + G-Eval 评分器（裁判模型可配置） | 2h |
| Q2 | 建立固定样本集（3 类产物 × 各 2 份输入样本），复用 harness_cases/expected_answers 表结构思路 | 2h |
| Q3 | 接入 `test:ai:quality` 独立 npm script（不进默认提交门禁，控 token 成本） | 2h |
| Q4 | 口径回归用例：上传文件仅提问 → 不创建 Run、不生成报告（意图口径守护用例） | 2h |

**验收标准**：`test:ai:quality` 可对 3 类产物输出结构完整性 + 结论稳定性评分；口径守护用例通过；成本约束生效（裁判调用只在显式命令中发生）。

**兼容性**：零新依赖、不引入 Python 栈；样本数据不含真实客户敏感内容（使用脱敏样本）。

**立项口径**：本项为雷达候选首次进入实施计划，执行前按 `skills/recording-wes-requirements` 在主台账补登记 RP 编号。

### 5.7 O7 Trace 观测演进映射（P2，10h，源自 GT-002）

**目标**：不部署 Langfuse，完成"自研 trace ↔ Langfuse 模型"映射表 + trace 存储从 JSON 迁移到已定义的 PG traces 表的 PoC，为 RP-030 后续演进定方向。

**实施步骤**：M1 映射表（8 类 span ↔ trace/span/generation，含 prompt id/version/hash 对齐 config/rag/prompts.json）3h → M2 traces PG 迁移 PoC（Harness 域已满足审计追溯触发器，trace 属 Harness 观测域内延展）4h → M3 Prompt 版本管理最小方案（prompts.json 增加 version 字段治理规则）3h。

**验收标准**：映射表入总看板监控页；PoC 证明 trace 读写不回归、脱敏规则不变；不改变非 Harness 域存储主路径。

**兼容性**：trace 归属 Harness 观测域（已有 PG 合法性）；若评审认定 trace 属独立域，则维持 JSON 存储，仅交付映射表。

### 5.8 O8 SSE 前端流式 UX（P2，6h，RP-029 批次 2）

**目标**：StreamRenderer 逐字渲染 + 思考过程折叠 + 中断/停止按钮，闭环已就绪的后端 SSE。

**实施步骤**：T6 StreamRenderer 组件 3h → T7 接入 home-workbench-chat-stream 1.5h → T8 中断/错误处理 1.5h。

**验收标准**：逐字渲染正常；中断后连接正确关闭；错误事件展示 RP-025 错误分类文案。

**口径支持**：流式通道复用同一 dispatch 与意图闸门，不新增绕过意图路由的旁路。

### 5.9 O9 AI 模块 facade 落地迁移（P2，10h）

**目标**：消除 `modules/ai/` 仅 re-export 的 facade 违例（AGENTS.md §5），实际实现迁入 `modules/ai/`，`services/ai/` 保留 barrel 向后兼容。

**实施步骤**：T1–T5 沿用 2026-08-03 方案（迁移 chat/dispatch/intent handler 入口 → repository 归位 → routes 更新 → services barrel → 全量测试）共 10h。

**验收标准**：test:modules / test:ai / build:api 全绿；新代码 import `modules/ai/ai.module`；外部契约（路由、响应结构）零变更。

**依赖**：必须在 O4（handler 化）完成后执行，避免两次大移动。

### 5.10 O10 AI 工作台兜底路由与静态回复策略优化（P1，16h，源自 ISS-2026-08-06-001 / RP-049）

**目标**：常规提问默认获得模型自然回复；静态模板只保留在问候语（额度保护）与超范围拦截两类场景；修复"关键词规则覆盖窄 + 模型分类替换过激 + 静态模板不感知问题"三层叠加（详见 `00_项目治理/里程碑与计划/RP-049-AI工作台兜底路由优化-实现计划.md`）。

**实施步骤**（三批次，Batch A 可独立交付）：

| 批次 | 任务 | 工时 |
|------|------|------|
| A | 分类替换收紧：只采纳 unsupported_or_out_of_scope 且阈值 0.6→0.85，分类结果始终写入 trace | 4h |
| B | 能力回复自然化（CAPABILITY_FACTS 单一事实源 + 模型辅助，失败降级如实标注 rule-static + fallbackReason）+ CAPABILITY_PATTERNS 补自然问法 | 8h |
| C | 回归加固：dispatch/intent 共 9 类新用例 + 6 条人工验收样本回填总看板 | 4h |

**排期与依赖**：
- **必须先于 O4**：双方修改同一批文件（`workbench-dispatch.service.ts` / `workbench-intent.service.ts`），O4 的 R3 快照基线须建立在 O10 修复后的行为上，避免同文件两次动刀与冲突；
- 与 O6 协同：O10 修复后的行为进入 O6 质量基线样本集；`trace.fallbackReason` 留痕为 O6/O7 观测提供数据；
- Batch A 可作为独立最小交付先行合并（只改 dispatch 一处 + 对应测试），不受 Sprint 节奏约束。

**验收标准**：test:ai / test:modules / build:api 全绿；7 类 dispatch 用例断言通过（含非超范围意图不采纳、问候静态保留、降级不伪装为模型输出）；人工验收 6 样本回填 testing.html。

**硬口径**：`isExplicitReportRequest` 闸门、附件路由（attachment_qa/attachment_summary）、报告生成、v2 提交路径全部零变更；`unsupported_or_out_of_scope` 拦截行为保留（仅收紧采纳条件），见第十节口径矩阵。

---

## 六、Sprint 计划与时间预估

| Sprint | 周期 | 内容 | 工时 | 里程碑出口 |
|--------|------|------|------|-----------|
| **Sprint 1** | 第 1–2 周 | O1 + O2 | 34h | 前端入口 ≤100 行；注册工具 ≥8；build/test 全绿 |
| **Sprint 2** | 第 3–4 周 | O10 + O4 | 31h | 兜底路由优化落地（人工验收 6 样本）；服务主文件 ≤200 行 |
| **O3 专项**（Gate 驱动，不套周历） | Sprint 2 同期启动工单编制 | O3-B（Batch B）→ Gate B → O3-C（Batch C）→ Gate C | 粗估 50–65h | 四类崩溃可恢复、无重复；异步 API + SSE 回放带 feature flag 可用 |
| **Sprint 3** | 第 5–6 周 | O5 + O8 + O6 | 25h | 统一视图上线；流式 UX 闭环；质量回归线建立 |
| **Sprint 4**（可选） | 第 7–8 周 | O7 + O9 | 20h | trace 映射定稿；facade 落地 |

**排期约束**：

1. Sprint 2 开工前置条件 = RP-047 A2 集成决策完成（避免 SSE 通道重复建设）——已于 2026-08-03 满足（88054d5 合入）；2026-08-06 前置核对确认 Batch C 覆盖原 O3 通道，用户同日决策将 Batch B→C 完整范围并入 O3（见 §5.3）；O3 开工时点 = Codex 发布 Batch B 详细计划与 Work Order，O4 无依赖可独立开工；
2. O9 严格排在 O4 之后；
2a. O10 严格排在 O4 之前（同文件依赖：dispatch/intent 服务）；O10 Batch A 可独立先行合并；O6 因 Sprint 2 纳入 O10 而顺移至 Sprint 3（与 O5/O8 组合 25h，负载更均衡）；
3. RP-035（AI Native Command Center）设计启动安排在 Sprint 3 出口之后，以 O5 统一视图为数据地基；
4. 每 Sprint 结束打 git tag，回滚以 tag 为单位。

---

## 七、衡量指标体系

| 指标 | 当前值 | 目标值 | 测量方式 | 归属优化项 |
|------|--------|--------|---------|-----------|
| AI 工作台入口文件行数 | 2602 行 | ≤100 行 | wc -l | O1 |
| 子组件文件最大行数 | — | ≤200 行 | 脚本扫描 | O1 |
| Agent 注册工具数 | 1 | ≥8 | ToolRegistry 快照测试 | O2 |
| chat/dispatch 主文件行数 | 911 / 1002 | ≤200 / ≤200 | wc -l | O4 |
| Run 状态更新延迟 | 手动刷新 | ≤2s | SSE 集成测试计时 | O3 |
| 统一视图接口 | 0 | 1（覆盖 session+run+artifact） | 接口测试 | O5 |
| 输出质量回归覆盖 | 0 类产物 | ≥3 类产物 × 固定样本 | test:ai:quality | O6 |
| 意图口径回归用例 | 0 | ≥8 条（含文件不触发工作流用例） | 快照测试集 | O6 / O4 |
| AI 模块 facade 违例 | 存在 | 消除 | import 扫描 | O9 |

---

## 八、风险评估

| # | 风险 | 概率 | 影响 | 对策 |
|---|------|------|------|------|
| R1 | O1 拆分引入功能回归 | 中 | 高 | F7 全链路回归 + 每步可独立回滚 + git tag |
| R2 | O2 写工具权限泄漏 | 低 | 高 | 能力位过滤 + need_confirm + test:security 门禁 + 数据隔离复核 |
| R3 | O4 重构改变意图路由行为 | 中 | 高 | 先建快照测试集再动刀；快照全绿才可合并 |
| R4 | O3 并入 Batch B+C 后范围大、周期长，故障注入测试复杂度高 | 中 | 高 | Gate 机制分批串行（每批 Codex 工单 + 独立 Gate）；RED 先行 + fake workflow；allowNextTask 默认 false | 
| R5 | SSE 连接泄漏 / 服务端内存 | 中 | 中 | 心跳 + close 清理 + 单用户连接数上限 + 压测验证 |
| R6 | O6 裁判模型 token 成本失控 | 低 | 低 | 独立 script、不进默认门禁、样本集限量 |
| R7 | O7 被误读为引入第二套观测平台 | 低 | 中 | 只做映射表与 PoC，不部署自托管 Langfuse；评审纪要入 risks.html |
| R8 | 需求池编号双口径混用导致排期错项 | 中 | 中 | 本方案统一主台账编号；`未来需求池.md` 编号对齐列为文档治理待办 |
| R9 | O10 分类白名单收紧后知识命中率下降 | 低 | 低 | domain_qa 已有反幻觉约束兜底；上线后抽样 trace 评估，必要时单独把 knowledge_query 加入白名单（RP-049 计划已声明该取舍） |

---

## 九、架构兼容性检查（AGENTS.md 对照）

| 边界条款 | 本方案对照 |
|---------|-----------|
| §2 传统域 JSON 为主、DB 迁移触发器 | O5 仅读聚合不迁移存储；O7 trace 迁移限于 Harness 观测域（已具审计追溯触发器合法性），非 Harness 域不动 |
| §2 业务层不直接依赖 JSON 文件结构 | O5/O9 通过 repository/usecase 访问，不新增文件路径直读 |
| §3 JWT 鉴权、{code,message,data} | 全部新接口遵守；O2 工具经 RBAC 能力位 |
| §7 页面分模块落地、复用 src/api/* | O1 拆到 pages/AiHomeWorkbench/ 子目录；O5/O8 前端经 src/api/* |
| §7 表格行编辑弹窗、弹窗拖拽等交互约定 | O1 拆分不改变既有交互语义 |
| §12 不引入第二前后端主实现 | O6 零依赖 TS 轻量版，不引入 Python 栈；O7 不部署 Langfuse 服务 |
| §12 不跳过权限/数据隔离/版本完整性 | O2/O5 验收项显式包含隔离复核 |
| 密钥处理 | O6/O7 任何样例不调用真实密钥入库；裁判模型密钥走既有运行时配置 |

---

## 十、"文件是上下文，用户意图才触发工作流"口径支持矩阵

| 优化项 | 口径影响面 | 支持/防护措施 |
|--------|-----------|-------------|
| O1 前端拆分 | 前端闸门 `isExplicitReportRequest` 移位 | 闸门函数提取至 utils，新增前后端口径一致性单测 |
| O2 工具扩展 | Agent 获得写能力 | 附件/证据仅作上下文引用入参；写工具强制 need_confirm；不因文件存在自动触发 |
| O3-B/C（Batch B+C） | 状态推送与自动恢复可能暗示"自动流转" | 只推送已发生事件；恢复只续跑原任务不跳阶段；stage 推进仍由用户意图动作触发 |
| O4 handler 化 | 四处防护代码移位 | 快照测试先行；重构后四处防护逐一回归（前端闸门、后端闸门、attachment-only 路由、写动作确认+stage 校验） |
| O5 统一视图 | 会话↔run 双向可见 | 只读聚合；视图方向固定为"会话 → 意图产生的 run" |
| O6 质量回归 | — | 专设口径守护用例：上传文件仅提问 → 不创建 Run、不生成报告 |
| O7 trace 映射 | — | trace 记录意图判定结果与 confidence，口径留痕能力增强 |
| O8 流式 UX | 流式通道可能绕路 | 复用同一 dispatch 与意图闸门，无旁路 |
| O9 facade 迁移 | 代码移动 | 契约零变更验收；口径测试全绿为合并前置 |
| O10 兜底路由优化 | 只改兜底分类与能力回复分支 | 四处防护零变更：前后端闸门、附件路由、报告/v2 路径不动；unsupported 拦截保留，仅收紧采纳条件 |

---

## 十一、待决策事项

| # | 事项 | 决策人 | 阻塞项 |
|---|------|--------|--------|
| D1 | 本方案整体批准（Sprint 1 是否开工） | 用户 / Codex | 全部 |
| D2 | RP-047 A2 集成授权（已于 2026-08-03 完成，88054d5）；**已于 2026-08-06 决策：Batch B→C 完整范围并入 O3**；后续动作：Codex 发布 Batch B 详细计划与 Work Order | 用户 | O3 |
| D3 | O6、O7 作为雷达候选首次实施，是否按需求池分诊补登记 RP | 用户 / 分诊流程 | O6、O7 |
| D4 | `未来需求池.md` 与主台账编号对齐的治理时点 | 用户 | 无（不阻塞实施） |
| D5 | O6 裁判模型选型（Kimi 现有 Provider 复用 vs 独立配置） | Codex | O6 Q1 |
| D6 | O10 实施开工批准（建议 Batch A 先行独立交付）；实施走 Qoder worktree 协议 + Codex 复核 | 用户 | O10 |

---

## 十二、关联文档

- `architecture-optimization-plan-2026-08-03.md` — 7 项措施原始版本（本方案 O1–O5、O8、O9 沿用其步骤编号 F/A/H/S/D/T）
- `analysis-report-2026-08-03.md` — 架构四维分析事实来源
- `codex-briefing-2026-08-03.md` — 三大瓶颈与需求缺口清单
- `github-radar.html` — GT-001 / GT-002 结合点论证与三维评级
- `01_需求管理/未来需求池.md` — RP-001~008、RP-028/029、RP-035 需求原文（注意编号口径差异）
- `00_项目治理/里程碑与计划/RP-049-AI工作台兜底路由优化-实现计划.md` — O10 实施细节（根因、三批改动、风险与验收样本）
- `skills/recording-wes-requirements/SKILL.md` — O6/O7 立项分诊依据

---

*本方案为草案，全部"目标值/工时"为规划口径，未经实施不构成已交付事实。*
