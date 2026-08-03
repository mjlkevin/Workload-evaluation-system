# WES AI Agent 架构分析与优化方案汇报

> **汇报对象**: Codex（总架构负责人）
> **汇报日期**: 2026-08-03
> **汇报人**: Qoder
> **事实基线**: 阶段 1H-B 已交付 / 阶段 1H-C 规划中
> **关联文档**: [analysis-report-2026-08-03.md](./analysis-report-2026-08-03.md) | [architecture-optimization-plan-2026-08-03.md](./architecture-optimization-plan-2026-08-03.md)

---

## 执行摘要

WES AI Agent 架构已完成 **从 0 到 1** 建设，具备文件理解、报告生成、知识库问答、人工确认等核心能力。Harness 审计底座（PostgreSQL 8 张表）设计优秀，提供完整的追溯和回归测试基础设施。

**当前最紧迫的三个架构瓶颈：**

| 排名 | 问题 | 影响 | 建议优先级 |
|------|------|------|-----------|
| 1 | 前端 AiHomeWorkbench.jsx **2602 行**单文件巨型聚合 | 开发效率低、违反 AGENTS.md §7 约定 | **P0** |
| 2 | Agent 工具生态**仅 1 个注册工具**，18 个业务模块仅 5 个与 AI 交互 | AI 能力边界受限，无法发挥 Agent 价值 | **P0** |
| 3 | AI 会话（JSON）与 Harness Run（PostgreSQL）**双轨并行** | 状态不一致、数据孤岛、体验断裂 | **P1** |

**建议优化路径**：3 个 Sprint，总计约 86h 预估工时，严格遵循 AGENTS.md 架构边界约定。

---

## 一、架构现状四维分析

### 1.1 需求侧分析

#### 已满足的核心业务需求（8 项）

| 需求领域 | 实现状态 | 代码模块 |
|---------|---------|---------|
| 文件理解与解析 | ✅ Excel/Word/PDF → 结构化摘要 | `chat.service.ts` → `parseBasicInfo` |
| 需求解析报告 v1/v2 | ✅ 双阶段报告 + schema 校验 | `harness.usecase.ts` |
| 意图路由 | ✅ 10 种意图类型（规则+模型混合） | `workbench-intent.service.ts` |
| 知识库问答 | ✅ 智谱知识库 + RAG Baseline | `knowledge-tool.service.ts` |
| 企业画像 | ✅ 客户名称 → 信息摘要 + 消歧 | `chat.service.ts` |
| AI 会话管理 | ✅ 多会话 CRUD + 持久化 | `useAiSessions.js` + `ai-sessions` |
| 人工确认链路 | ✅ AI 建议 → 用户确认 → 传统草稿 | `harness.usecase.ts` |
| 审计留痕 | ✅ 模型调用/工具事件/证据追溯 | `harness` PostgreSQL 表组 |

#### 关键需求缺口（5 项）

| 需求编号 | 缺口描述 | 影响 |
|---------|---------|------|
| RP-047 | 会话级多通道运行时缺失 | 状态分散在 localStorage + JSON + PostgreSQL 三处 |
| RP-035 | AI Native Command Center 未实现 | 仍是"聊天+报告"模式，非"工作流驱动" |
| RP-029 | 流式输出 UX 未完成 | 后端 SSE 就绪，前端逐字渲染缺失 |
| RP-024 | Napkin 视觉生成未闭环 | PPT 页面生成能力缺失 |
| RP-001 | 低代码工作流设计器暂缓 | 工作流模板硬编码在前端 |

#### 需求趋势判断

AI Agent 正从 **"辅助工具"** 向 **"工作流引擎"** 演进：

```
Phase 1A-1F（已完成）: 文件上传 → 解析 → 报告 → 确认 → 草稿
Phase 1G（当前）:      意图路由 + 知识库 + 多角色预设
Phase 1H（进行中）:    多通道运行时 + 工作流设计器 + AI Native 首页
下一阶段:              AI 驱动的项目管理闭环
```

---

### 1.2 产品侧分析

#### 产品定位

> **"AI 辅助决策，不代替用户"** — AI/Harness 生成报告和建议，正式业务必须经人工确认

#### 目标达成情况（9 项）

| 产品目标 | 达成度 | 说明 |
|---------|-------|------|
| 文件上传 → AI 理解 | ✅ | 支持 Excel/Word/PDF，含 evidence 留痕 |
| 需求解析报告 v1/v2 | ✅ | 双阶段报告，schema 校验 |
| 人工确认 → 传统草稿 | ✅ | `enter_formal_estimation` 动作确认 |
| 草稿可追溯 | ✅ | 草稿与 Harness Run 双向关联 |
| 多角色 AI 助手 | ✅ | 7 种 BusinessRole 预设 prompt |
| 知识库问答 | ✅ | 智谱知识库 + RAG Baseline |
| 流式实时响应 | ⚠️ | 后端 SSE 就绪，前端 UX 未完成 |
| AI 工作流驱动 | ❌ | 当前仍是"聊天窗口"模式 |
| 多 Agent 协作 | ❌ | 仅单一 Kimi Provider |

#### AI 工作台与传统页面整合问题

1. **数据孤岛**：AI 会话数据（`data/ai-sessions.json`）与 Harness 运行数据（PostgreSQL）缺乏统一视图
2. **状态不一致**：前端 `useAiSessions` 与 Harness Run 状态机是两套独立体系
3. **跳转断裂**：AI 工作台 → 传统评估页面，上下文（Harness Run ID、Evidence 引用）无法完整传递

---

### 1.3 前端架构分析

#### 当前架构

```
AiHomeWorkbench.jsx（2602 行，前端最大单文件）
├── SessionRail（会话列表 - 361行）
│   ├── 右键菜单（复制ID/重命名/删除）
│   └── 重命名模态框
├── 对话区（内联在主文件中）
│   ├── 消息列表（用户/AI 气泡）
│   ├── CopyMessageButton
│   ├── InteractiveFormCard（结构化表单）
│   └── 工作流模板选择器
├── ArtifactPanel（产物面板 - 168行）
│   ├── 会话进度 Timeline（4步）
│   ├── 产物卡片列表
│   └── PendingActionCard（待确认动作）
└── CompanyLookupDialog（企业查询弹窗）
```

#### 关键问题

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| **单文件巨型聚合** | 🔴 高 | 2602 行包含状态管理、API 调用、Markdown 渲染、文件解析、Harness 交互、UI 布局，违反 AGENTS.md §7 |
| **状态管理分散** | 🔴 高 | useAiSessions + useState + localStorage + Harness API 四套状态体系 |
| **三栏布局不完整** | 🟡 中 | 缺少"结构化工作区"独立面板，Evidence 溯源查看未实现 |
| **SSE 未闭环** | 🟡 中 | `eventsHandler` 只返回一次性状态快照，非实时推送 |

#### 前后端交互模式

```
前端                          后端
  │                             │
  ├─ POST /ai/parse-basic-info ─→ 文件解析（同步）
  ├─ POST /harness/runs ────────→ 创建 Harness Run
  ├─ POST /harness/runs/:id/files → 绑定文件
  ├─ POST /harness/runs/:id/parse-result → 提交解析结果
  ├─ POST /harness/runs/:id/report-v1 → 生成 v1 报告（LLM）
  ├─ POST /harness/runs/:id/answers → 提交补充信息
  ├─ POST /harness/runs/:id/report-v2 → 生成 v2 报告（LLM）
  ├─ POST /harness/runs/:id/actions/:actionId/confirm → 确认动作
  ├─ GET  /harness/runs/:id/events → SSE 事件流（占位实现）
  │                             │
  ├─ POST /ai/home-workbench-chat → AI 对话（意图路由 + 分发）
  └─ POST /ai/home-workbench-chat-stream → 流式对话（SSE）
```

**核心问题**：`chat.service.ts`（AI 对话）和 `harness.usecase.ts`（任务运行）是两套独立链路，前端需维护两套状态。

---

### 1.4 后端架构分析

#### Agent 编排层（`apps/api/src/agent/`）

**当前实现**（orchestrator.ts，84 行）：

```typescript
export async function runAgent(params: RunAgentParams): Promise<string> {
  const tools = registry.listToolsFor(user);  // RBAC 能力位过滤
  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await runner.chatCompletion({ messages, tools, toolChoice: "auto" });
    if (reply.toolCalls) { /* 执行工具，写操作需确认 */ }
    else { return reply.content; }
  }
}
```

**优势**：清晰的 Tool-Use 编排、RBAC 能力位控制、写操作确认机制、可注入假 Provider 测试

**不足**：

| 不足 | 影响 |
|------|------|
| 工具注册表仅 1 个 `buildEstimateTool` | Agent 能力边界极度受限 |
| `context/` 有 RuntimeContext/RunState 类型但未使用 | 编排器无上下文感知 |
| 每次调用独立消息列表，不关联 AI Session/Harness Run | 无会话记忆 |
| 同步阻塞式，不支持 SSE 流式推送 | 无法实时展示工具执行过程 |

#### Harness 数据库存储（PostgreSQL 8 张表）

| 表名 | 用途 | 关键设计 |
|------|------|---------|
| `harness_runs` | 任务运行 | 16 种 stage 状态机 |
| `harness_files` | 绑定文件 | attachmentId 关联 |
| `harness_evidences` | 证据 | sourceType + tableSnapshot |
| `harness_artifacts` | 任务产物 | 6 种 artifactType，JSONB content |
| `harness_tool_events` | 工具事件 | actionId + status |
| `harness_model_runs` | 模型调用 | provider/model/elapsedMs/fallbackReason |
| `harness_scores` | 评分 | scoreType + passed |
| `harness_cases` + `harness_expected_answers` | 回归样本 | caseKey + expected JSONB |

**优势**：完整审计链路、状态机驱动、幂等确认、回归测试基础设施

**不足**：SSE 事件推送未实现、缺少 WebSocket/长轮询、ModelRun 与 Artifact 关联弱

#### 18 个业务模块与 AI Agent 集成状况

```
AI Agent 可触达（5 个）：
├── estimates（评估计算）→ buildEstimateTool 已注册
├── project-evaluations（项目评估）→ confirmHarnessAction 创建草稿
├── system（系统配置）→ resolveActiveRequirementKimiApiKey
├── ai-sessions（AI 会话）→ appendAiSessionEvent
└── trace（追踪）→ recordWorkbenchTurnTrace

未集成（13 个）：
├── rules（规则引擎）→ 未暴露给 Agent
├── templates（模板）→ 未暴露给 Agent
├── wbs（工作分解）→ 未暴露给 Agent
├── presales（售前）→ 未暴露给 Agent
├── collab（协作）→ 未暴露给 Agent
└── ... 其他 8 个模块
```

#### AI 服务层（`services/ai/`）

| 服务 | 行数 | 职责 | 问题 |
|------|------|------|------|
| `chat.service.ts` | 910 | AI 对话入口、文件解析、企业画像 | 多职责耦合 |
| `workbench-dispatch.service.ts` | 1001 | 意图分发器（10 种意图） | 新增意图需修改此文件 |
| `workbench-intent.service.ts` | 215 | 意图路由器 | 正常 |
| `extractor.service.ts` | 529 | 文件内容提取 | 正常 |
| `knowledge-tool.service.ts` | 605 | 知识库查询工具 | 正常 |

**架构问题**：`modules/ai/` 是 facade（仅 re-export），实际实现在 `services/ai/`，违反 AGENTS.md §5 模块约定。

---

## 二、架构优化建议与实施方案

### 2.1 优化目标

| 目标 | 衡量指标 | 当前值 | 目标值 |
|------|---------|-------|-------|
| 前端可维护性 | AiHomeWorkbench.jsx 行数 | 2602 行 | ≤300 行（入口文件） |
| Agent 工具覆盖 | 注册工具数量 | 1 个 | ≥8 个 |
| 数据一致性 | AI 会话与 Harness 统一视图 | 双轨并行 | 统一查询接口 |
| 实时性 | Harness Run 状态更新延迟 | 手动刷新 | ≤2s SSE 推送 |
| 服务层可维护性 | 单文件最大行数 | 1001 行 | ≤300 行 |

### 2.2 优化方案总览

| 优先级 | 优化项 | 影响 | 预估工时 |
|--------|--------|------|---------|
| **P0** | 前端组件拆分 | 开发效率 | 19h |
| **P0** | Agent 工具扩展 | AI 能力边界 | 15h |
| **P1** | Harness SSE 实时推送 | 用户体验 | 10h |
| **P1** | AI 服务层重构 | 可维护性 | 15h |
| **P1** | 数据一致性改善 | 数据完整性 | 11h |
| **P2** | AI 模块 facade 迁移 | 技术债务 | 10h |
| **P2** | SSE 前端流式 UX | 用户体验 | 6h |

---

### 2.3 P0：前端组件拆分

**问题**：2602 行单文件巨型聚合，违反 AGENTS.md §7"避免单文件巨型聚合"

**目标目录结构**：

```
ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/
├── index.jsx                      # 页面入口（≤100行，纯布局组装）
├── hooks/
│   ├── useWorkbenchState.js       # 收敛所有 useState 为单一状态机
│   ├── useHarnessRun.js           # Harness Run 生命周期管理
│   └── useChatMessages.js         # 消息列表与发送逻辑
├── components/
│   ├── ChatArea/                  # 对话区
│   │   ├── MessageList.jsx
│   │   ├── MessageBubble.jsx
│   │   ├── Composer.jsx           # 输入区（含附件上传）
│   │   └── WorkflowTemplates.jsx
│   ├── WorkspacePanel/            # 结构化工作区（新增）
│   │   ├── ReportViewer.jsx       # v1/v2 报告渲染
│   │   ├── EvidenceViewer.jsx     # 证据溯源查看
│   │   └── DraftLinker.jsx        # 草稿关联跳转
│   └── StatusPanel/               # 证据状态区（改造现有 ArtifactPanel）
│       ├── RunStageIndicator.jsx
│       ├── ModelRunTrace.jsx
│       └── ActionConfirmer.jsx
└── utils/
    ├── harnessPayload.js
    ├── reportParser.js
    └── messageFormatter.js
```

**实施步骤**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| F1 | 创建目录结构，提取工具函数到 `utils/` | 2h |
| F2 | 提取 `useWorkbenchState` hook，收敛分散的 useState | 3h |
| F3 | 拆分 ChatArea 组件（MessageList/MessageBubble/Composer） | 4h |
| F4 | 拆分 StatusPanel 组件（改造 ArtifactPanel） | 3h |
| F5 | 新建 WorkspacePanel 组件（报告渲染+证据溯源） | 4h |
| F6 | 改造 index.jsx 为纯布局组装 | 2h |
| F7 | 验证 build:web 通过 + 功能回归 | 1h |

**验收标准**：
- [ ] `npm run build:web` 通过
- [ ] AiHomeWorkbench/index.jsx ≤100 行
- [ ] 所有子组件文件 ≤200 行
- [ ] 功能回归：文件上传、报告生成、动作确认、会话管理正常

---

### 2.4 P0：Agent 工具扩展

**问题**：仅 1 个注册工具，18 个业务模块仅 5 个与 AI 交互

**新增工具清单**：

| 工具名 | 类型 | 能力位 | 说明 |
|--------|------|--------|------|
| `buildEstimateTool` | 写操作 | `estimate:write` | 已有：评估计算 |
| `buildProjectListTool` | 查询 | `project:read` | 新增：查询用户项目列表 |
| `buildEstimateHistoryTool` | 查询 | `estimate:read` | 新增：查询评估历史 |
| `buildKnowledgeQueryTool` | 查询 | `knowledge:read` | 新增：知识库查询 |
| `buildRuleLookupTool` | 查询 | `rule:read` | 新增：规则查询 |
| `buildCreateProjectTool` | 写操作 | `project:write` | 新增：创建项目草稿 |
| `buildGenerateWbsTool` | 写操作 | `wbs:write` | 新增：生成 WBS 草稿 |
| `buildExportReportTool` | 写操作 | `export:write` | 新增：导出报告 |

**实施步骤**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| A1 | 定义新增工具的 AgentTool 接口实现（4 个查询工具） | 4h |
| A2 | 实现写操作工具（含确认机制，3 个写操作工具） | 4h |
| A3 | 扩展 `createDefaultRegistry()` 注册所有工具 | 1h |
| A4 | 将 RuntimeContext 注入编排循环 | 2h |
| A5 | 补充工具单元测试 | 3h |
| A6 | 验证 test:modules 通过 | 1h |

**验收标准**：
- [ ] `npm run test:modules` 通过
- [ ] ToolRegistry 注册工具数 ≥8
- [ ] 所有写操作工具触发 `need_confirm` 事件
- [ ] RBAC 能力位正确过滤工具

---

### 2.5 P1：Harness SSE 实时推送

**问题**：SSE `eventsHandler` 只返回一次性状态快照，前端无法实时感知 Run 状态变化

**技术方案**：

```typescript
// 新增：Harness 事件总线
// apps/api/src/modules/harness/harness.event-bus.ts
export class HarnessEventBus {
  private listeners = new Map<string, Set<(event: HarnessEvent) => void>>();
  
  subscribe(runId: string, callback: (event: HarnessEvent) => void): () => void;
  publish(runId: string, event: HarnessEvent): void;
  unsubscribe(runId: string, callback: Function): void;
}
```

**改造 eventsHandler**：

```typescript
// harness.controller.ts - eventsHandler 改造
export function eventsHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    const runId = asString(req.params.runId);
    
    // 发送当前状态快照
    const detail = await getHarnessRunDetail(auth.user, runId, repoFrom(deps));
    if (detail) {
      res.write(`event: run_state\n`);
      res.write(`data: ${JSON.stringify({ stage: detail.run.stage, status: detail.run.status })}\n\n`);
    }
    
    // 订阅后续状态变更
    const unsubscribe = harnessEventBus.subscribe(runId, (event) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
    });
    
    // 心跳保活（30s）
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30000);
    
    req.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  };
}
```

**实施步骤**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| H1 | 实现 HarnessEventBus 事件总线 | 2h |
| H2 | 在 usecase 状态变更处发布事件 | 2h |
| H3 | 改造 eventsHandler 支持持续推送 | 2h |
| H4 | 前端实现 useHarnessRunEvents hook | 2h |
| H5 | 集成测试 SSE 推送 | 2h |

**验收标准**：
- [ ] SSE 连接建立后能收到初始状态快照
- [ ] Run 状态变更时前端 ≤2s 收到推送
- [ ] 客户端断开后服务端正确清理资源
- [ ] 心跳保活机制正常工作

---

### 2.6 P1：AI 服务层重构

**问题**：`chat.service.ts` 910 行、`workbench-dispatch.service.ts` 1001 行，违反单一职责原则

**目标目录结构**：

```
services/ai/
├── handlers/
│   ├── capability-discovery.handler.ts   # ≤100行
│   ├── domain-qa.handler.ts             # ≤100行
│   ├── knowledge-query.handler.ts       # ≤150行
│   ├── attachment-qa.handler.ts         # ≤150行
│   ├── harness-report.handler.ts        # ≤200行
│   ├── wes-data-query.handler.ts        # ≤100行
│   └── write-action.handler.ts          # ≤100行
├── chat.service.ts          # 精简为入口路由（≤200行）
├── workbench-dispatch.service.ts  # 精简为分发器（≤200行）
└── workbench-intent.service.ts    # 保持不变（215行）
```

**实施步骤**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| S1 | 创建 handlers 目录，定义 Handler 接口 | 1h |
| S2 | 从 dispatch.service 提取各意图处理逻辑（7 个 handler） | 6h |
| S3 | 精简 chat.service.ts 为入口路由 | 2h |
| S4 | 精简 dispatch.service 为纯分发器 | 2h |
| S5 | 补充 handler 单元测试 | 3h |
| S6 | 验证 test:ai 通过 | 1h |

**验收标准**：
- [ ] `npm run test:ai` 通过
- [ ] chat.service.ts ≤200 行
- [ ] workbench-dispatch.service.ts ≤200 行
- [ ] 新增意图只需添加新 handler 文件，不修改现有文件

---

### 2.7 P1：数据一致性改善

**问题**：AI 会话数据（`data/ai-sessions.json`）与 Harness 运行数据（PostgreSQL）双轨并行

**新增 API**：

```
GET /api/v1/ai-sessions/:sessionId/unified-view
```

**响应结构**：

```typescript
{
  code: 0,
  message: "ok",
  data: {
    session: AiSessionRecord,           // AI 会话基础信息
    harnessRuns: HarnessRunRow[],       // 关联的 Harness Runs
    activeRun: HarnessRunRow | null,    // 当前活跃的 Run
    artifacts: MergedArtifact[],        // 合并后的产物列表
    pendingActions: MergedAction[],     // 合并后的待确认动作
    linkedRecords: LinkedRecords        // 关联的传统业务记录
  }
}
```

**实施步骤**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| D1 | 在 ai-sessions 模块新增 unified-view 查询 | 3h |
| D2 | 实现会话与 Harness Run 关联查询 | 2h |
| D3 | 实现产物与动作合并逻辑 | 2h |
| D4 | 新增 API 路由与控制器 | 1h |
| D5 | 前端集成统一视图 | 2h |
| D6 | 验证数据一致性 | 1h |

**验收标准**：
- [ ] 统一视图 API 返回完整的会话+Harness 数据
- [ ] 前端切换会话时能正确加载关联的 Harness Run
- [ ] 产物列表包含 AI 会话产物和 Harness 产物

---

### 2.8 P2：技术债务清理

#### AI 模块 facade 迁移

**问题**：`modules/ai/` 只是 re-export，实际实现在 `services/ai/`，违反 AGENTS.md §5

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| T1 | 在 `modules/ai/` 下创建完整三层结构 | 2h |
| T2 | 迁移 `services/ai/` 实现到 `modules/ai/` | 4h |
| T3 | 更新所有 import 引用 | 2h |
| T4 | 保留 `services/ai/index.ts` 为 barrel re-export | 1h |
| T5 | 验证 test:modules 通过 | 1h |

#### SSE 前端流式 UX 完善

**问题**：RP-029 后端已支持 SSE 流式，但前端逐字渲染和停止按钮未实现

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| T6 | 实现前端 SSE 流式接收 hook | 2h |
| T7 | 实现逐字渲染组件 | 2h |
| T8 | 实现停止按钮与中断逻辑 | 1h |
| T9 | 验证流式体验 | 1h |

---

## 三、优先级排序与时间安排

### 3.1 Sprint 划分

#### Sprint 1（第 1 周）：前端拆分 + Agent 工具扩展

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | F1-F3: 前端工具函数提取 + ChatArea 拆分 | 3 个工具文件 + 4 个组件 |
| Day 3-4 | F4-F6: StatusPanel 拆分 + WorkspacePanel 新建 + 入口精简 | 6 个组件 + 入口文件 |
| Day 5 | F7: 前端验证 + A1-A2: Agent 查询工具实现 | build:web 通过 + 4 个工具 |
| Day 6-7 | A3-A6: Agent 写操作工具 + 注册表扩展 + 测试 | 8 个工具注册 + 测试通过 |

**Sprint 1 验收**：
- [ ] `npm run build:web` 通过
- [ ] `npm run test:modules` 通过
- [ ] AiHomeWorkbench/index.jsx ≤100 行
- [ ] ToolRegistry 注册工具数 ≥8

#### Sprint 2（第 2 周）：SSE 实时推送 + 服务层重构

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | H1-H3: HarnessEventBus + usecase 事件发布 + eventsHandler 改造 | SSE 推送能力 |
| Day 3 | H4-H5: 前端 SSE hook + 集成测试 | useHarnessRunEvents |
| Day 4-5 | S1-S3: handlers 目录 + 意图处理逻辑提取 | 7 个 handler 文件 |
| Day 6-7 | S4-S6: dispatch 精简 + 测试验证 | 服务层文件 ≤200 行 |

**Sprint 2 验收**：
- [ ] SSE 连接建立后能收到初始状态快照
- [ ] Run 状态变更时前端 ≤2s 收到推送
- [ ] `npm run test:ai` 通过
- [ ] chat.service.ts ≤200 行

#### Sprint 3（第 3 周）：数据一致性 + 技术债务

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | D1-D3: 统一会话视图服务实现 | unified-view API |
| Day 3 | D4-D6: 前端集成 + 验证 | 统一视图可用 |
| Day 4-5 | T1-T5: AI 模块 facade 迁移 | modules/ai 完整三层 |
| Day 6-7 | T6-T9: SSE 前端流式 UX | 逐字渲染 + 停止按钮 |

**Sprint 3 验收**：
- [ ] 统一视图 API 返回完整数据
- [ ] `npm run test:modules` 通过
- [ ] 流式对话支持逐字渲染和停止

---

## 四、前后端分别的改造计划

### 4.1 前端改造计划

| 改造项 | 涉及文件 | 改造内容 | 验证命令 |
|--------|---------|---------|---------|
| 组件拆分 | `pages/AiHomeWorkbench/` | 2602 行 → 入口 ≤100 行 + 子组件 ≤200 行 | `npm run build:web` |
| 状态收敛 | `hooks/useWorkbenchState.js` | 分散 useState → 单一状态机 | 功能回归 |
| SSE 集成 | `hooks/useHarnessRun.js` | 新增 SSE 订阅 hook | 手动测试 |
| 流式 UX | `components/ChatArea/StreamingMessage.jsx` | 逐字渲染 + 停止按钮 | 手动测试 |
| API 层复用 | `api/harness.js` | 保持现有 API 封装 | `npm run build:web` |

### 4.2 后端改造计划

| 改造项 | 涉及文件 | 改造内容 | 验证命令 |
|--------|---------|---------|---------|
| Agent 工具扩展 | `agent/tools/*.ts` | 1 个工具 → 8 个工具 | `npm run test:modules` |
| 上下文注入 | `agent/orchestrator.ts` | 注入 RuntimeContext | `npm run test:modules` |
| SSE 事件推送 | `modules/harness/harness.event-bus.ts` | 新增事件总线 | 集成测试 |
| 服务层拆分 | `services/ai/handlers/*.ts` | 1001 行 → 7 个 handler | `npm run test:ai` |
| 统一视图 | `modules/ai-sessions/unified-view.usecase.ts` | 新增统一查询 | `npm run test:modules` |
| 模块迁移 | `modules/ai/` | facade → 完整三层 | `npm run test:modules` |

---

## 五、风险评估与应对策略

### 5.1 风险矩阵

| 风险 | 概率 | 影响 | 风险等级 | 应对策略 |
|------|------|------|---------|---------|
| 前端拆分引入回归 bug | 中 | 高 | 🔴 | 每步拆分后立即验证 build:web + 功能回归 |
| Agent 工具权限配置错误 | 低 | 高 | 🟡 | 工具注册时强制校验能力位，补充权限测试 |
| SSE 连接不稳定 | 中 | 中 | 🟡 | 实现心跳保活 + 断线重连机制 |
| 服务层拆分破坏现有功能 | 中 | 高 | 🔴 | 保持 dispatch.service 接口不变，内部实现替换 |
| 统一视图查询性能差 | 低 | 中 | 🟢 | 添加查询超时 + 分页限制 |
| AI 模块迁移遗漏引用 | 中 | 中 | 🟡 | 全局搜索 `services/ai` 引用，逐一更新 |

### 5.2 回滚策略

每个 Sprint 结束后打 tag，如发现问题可快速回滚：

```bash
# Sprint 1 完成后
git tag sprint-1-frontend-agent-complete

# Sprint 2 完成后
git tag sprint-2-sse-service-complete

# Sprint 3 完成后
git tag sprint-3-unified-view-complete
```

### 5.3 灰度发布策略

1. **前端拆分**：先在开发环境验证，无回归后合并主线
2. **Agent 工具**：新工具默认仅 admin 可用，验证稳定后开放给 user
3. **SSE 推送**：保留轮询作为降级方案，SSE 失败时自动切换
4. **统一视图**：新增 API 不影响现有接口，可独立验证

---

## 六、验证方案与成功指标

### 6.1 自动化验证

| 验证项 | 命令 | 成功标准 |
|--------|------|---------|
| 前端构建 | `npm run build:web` | 构建成功，无错误 |
| 后端构建 | `npm run build:api` | 构建成功，无错误 |
| 模块测试 | `npm run test:modules` | 全部测试通过 |
| 规则测试 | `npm run test:rules` | 全部测试通过 |
| 集成测试 | `npm run test:integration` | 全部测试通过 |
| AI 测试 | `npm run test:ai` | 全部测试通过 |

### 6.2 功能验证清单

#### 前端拆分验证

- [ ] AI 工作台页面正常加载
- [ ] 会话列表正常显示、切换、新建、重命名、删除
- [ ] 文件上传正常，能触发解析
- [ ] 报告 v1/v2 正常生成和显示
- [ ] 动作确认正常，能创建传统草稿
- [ ] 企业画像查询正常

#### Agent 工具验证

- [ ] 查询工具返回正确数据
- [ ] 写操作工具触发确认流程
- [ ] 无权限用户看不到对应工具
- [ ] 工具执行结果正确返回给 LLM

#### SSE 实时推送验证

- [ ] 建立 SSE 连接后收到初始状态
- [ ] Run 状态变更时收到推送
- [ ] 断线后能自动重连
- [ ] 心跳保活正常工作

#### 统一视图验证

- [ ] API 返回完整的会话+Harness 数据
- [ ] 前端切换会话时正确加载关联 Run
- [ ] 产物列表包含所有来源的产物

### 6.3 性能指标

| 指标 | 当前值 | 目标值 | 测量方法 |
|------|-------|-------|---------|
| AiHomeWorkbench 首屏加载时间 | 待测量 | ≤2s | Lighthouse |
| Harness Run 状态更新延迟 | 手动刷新 | ≤2s | SSE 时间戳 |
| Agent 工具调用响应时间 | 待测量 | ≤5s | 日志统计 |
| 统一视图 API 响应时间 | N/A | ≤500ms | 日志统计 |

### 6.4 代码质量指标

| 指标 | 当前值 | 目标值 |
|------|-------|-------|
| AiHomeWorkbench.jsx 行数 | 2602 | ≤100（入口） |
| chat.service.ts 行数 | 910 | ≤200 |
| workbench-dispatch.service.ts 行数 | 1001 | ≤200 |
| 单文件最大行数 | 2602 | ≤300 |
| Agent 注册工具数 | 1 | ≥8 |

---

## 七、AGENTS.md 架构边界一致性检查

| AGENTS.md 约定 | 本方案是否遵循 | 说明 |
|---------------|---------------|------|
| 唯一 Web 主线为 `ui/V2_PROTOTYPE` | ✅ | 所有前端改动在 V2_PROTOTYPE 内 |
| 唯一服务入口 `apps/api` | ✅ | 所有后端改动在 apps/api 内 |
| 传统 WES 记录仍以 JSON 文件存储 | ✅ | 不改动传统模块存储方式 |
| Harness 域使用 PostgreSQL | ✅ | 不改动 Harness 存储方式 |
| 新增接口挂 `apps/api/src/routes/*` | ✅ | 统一视图 API 挂在 ai-sessions 路由 |
| 页面变更优先分模块落地 | ✅ | 前端拆分为多个组件文件 |
| 复用 `src/api/*` 作为 API 访问层 | ✅ | 保持现有 API 封装 |
| 业务接口默认 JWT 鉴权 | ✅ | 所有新 API 保持 JWT 鉴权 |
| 响应结构 `{ code, message, data }` | ✅ | 所有新 API 保持标准响应结构 |
| 不引入第二前端/后端主实现 | ✅ | 不新增前端框架或后端服务 |
| 不跳过权限校验 | ✅ | Agent 工具扩展包含 RBAC 校验 |

---

## 八、后续扩展路线

### 8.1 Phase 1H-C 完成后（第 4 周起）

| 方向 | 需求来源 | 预估工时 |
|------|---------|---------|
| AI 工作流设计器（RP-001） | 需求池 | 40h |
| Napkin 视觉生成融合（RP-024） | 需求池 | 24h |
| 多 Agent 协作框架 | 产品规划 | 32h |
| 知识库 pgvector 接入 | 技术规划 | 16h |

### 8.2 Phase 2 规划（第 2 个月）

| 方向 | 说明 |
|------|------|
| AI Native 首页 | 从"文档导航"升级为"AI 工作流驱动" |
| 智能评估引擎 | 基于历史数据的自动评估建议 |
| 多模型路由 | 根据任务类型自动选择最优模型 |

---

## 九、汇报总结

### 当前架构状态

WES AI Agent 架构已完成从 0 到 1 建设，Harness 审计底座设计优秀（完整审计链路 + 状态机驱动 + 回归测试基础设施），但存在 **前端巨型聚合**、**Agent 工具匮乏**、**数据双轨并行** 三个关键瓶颈。

### 建议行动

1. **立即启动 Sprint 1**：前端组件拆分 + Agent 工具扩展（P0，34h）
2. **第 2 周启动 Sprint 2**：SSE 实时推送 + 服务层重构（P1，25h）
3. **第 3 周启动 Sprint 3**：数据一致性 + 技术债务（P1/P2，27h）

### 预期收益

- **开发效率**：前端单文件从 2602 行降至 ≤100 行入口，新功能开发速度提升 50%+
- **AI 能力**：Agent 工具从 1 个扩展至 8 个，覆盖项目查询、评估历史、知识库、规则、WBS、导出等核心场景
- **用户体验**：Harness Run 状态从手动刷新变为 ≤2s SSE 实时推送
- **可维护性**：服务层从 1001 行拆分为 7 个 handler，新增意图无需修改现有文件

### 需要 Codex 决策的事项

1. **Sprint 1 启动确认**：前端拆分和 Agent 工具扩展是否可按计划启动？
2. **Agent 工具权限**：新增写操作工具（创建项目/生成 WBS/导出报告）的默认权限策略？
3. **SSE 推送优先级**：是否接受保留轮询作为降级方案的灰度策略？
4. **统一视图 API**：新增 `/ai-sessions/:id/unified-view` 接口是否符合 API 设计规范？

---

*本汇报材料基于 2026-08-03 代码快照分析，严格遵循 AGENTS.md 架构边界约定。*
