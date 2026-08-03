# WES AI Agent 架构全面分析报告

> **分析日期**: 2026-08-03
> **分析范围**: AI 工作台前端、后端、Harness 审计底座、Agent 编排层
> **事实基线**: 阶段 1H-B 已交付 / 阶段 1H-C 规划中
> **主线**: ui/V2_PROTOTYPE + apps/api

---

## 一、架构全景概览

当前 WES 的 AI Agent 架构呈现 **三层分离、双轨并行** 的格局：

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层 (Frontend)                   │
│  ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx (2602行)  │
│  ├── SessionRail (会话列表 - 361行)                      │
│  ├── ArtifactPanel (产物面板 - 168行)                     │
│  ├── InteractiveFormCard (交互表单 - 187行)               │
│  └── CompanyLookupDialog (企业查询 - 199行)               │
├─────────────────────────────────────────────────────────┤
│                   API 接口层 (Routes)                     │
│  /api/v1/ai/*     → AI 对话/文件解析/企业画像             │
│  /api/v1/agent/*  → Agent 编排 (Tool-Use Chat)           │
│  /api/v1/harness/* → Harness 任务运行/审计                │
│  /api/v1/ai-sessions/* → AI 会话管理                     │
├─────────────────────────────────────────────────────────┤
│                   后端服务层 (Services)                     │
│  services/ai/     → 核心业务逻辑 (chat/dispatch/intent)    │
│  agent/           → Agent 编排器 (orchestrator)           │
│  modules/harness/ → Harness 领域 (controller/usecase/repo) │
├─────────────────────────────────────────────────────────┤
│                   数据持久层 (Storage)                     │
│  PostgreSQL (harness_*)  → Harness 审计域 (8张表)         │
│  JSON 文件 (config/*)    → 传统业务域                     │
│  JSON 文件 (data/)       → AI 会话数据                    │
└─────────────────────────────────────────────────────────┘
```

---

## 二、需求侧分析

### 2.1 当前 AI Agent 已满足的核心业务需求

| 需求领域 | 已实现功能 | 对应代码模块 |
|---------|-----------|------------|
| **文件理解与解析** | Excel/Word/PDF 上传 → 基础信息抽取 → 结构化摘要 | `chat.service.ts` → `parseBasicInfo` |
| **需求解析报告** | v1 报告（初步需求识别）→ 用户补充 → v2 报告（完整需求分析） | `harness.usecase.ts` → `generateHarnessRequirementReportV1/V2` |
| **意图路由** | 基于规则+模型的混合意图分类（10 种意图类型） | `workbench-intent.service.ts` |
| **知识库问答** | 智谱知识库集成，产品知识/行业知识查询 | `knowledge-tool.service.ts` |
| **企业画像** | 客户名称 → 企业信息摘要 + 消歧选择 | `chat.service.ts` → `summarizeCompanyProfile` |
| **AI 会话管理** | 多会话创建/切换/重命名/删除，会话持久化 | `useAiSessions.js` + `ai-sessions` 模块 |
| **人工确认链路** | AI 建议动作 → 用户确认 → 生成传统草稿 | `harness.usecase.ts` → `confirmHarnessAction` |
| **审计留痕** | 模型调用记录、工具事件、证据追溯 | `harness` PostgreSQL 表组 |

### 2.2 主要痛点与需求缺口

从需求池（requirements.html）中识别出 **38 项需求**，其中 **13 项待规划/待确认**，关键缺口包括：

1. **RP-047: AI 工作台会话级多通道运行时** — 当前会话状态管理分散在前端 localStorage + 后端 JSON 文件 + Harness PostgreSQL 三个地方，缺乏统一的运行时状态机
2. **RP-035: AI Native Command Center** — 当前 AI 工作台仍是"聊天+报告"模式，未实现"AI 工作流驱动"的项目管理入口
3. **RP-024: Napkin 视觉生成融合** — 外部工具链未闭环，PPT 页面生成能力缺失
4. **RP-029: 流式输出 UX** — 后端已支持 SSE 流式，但前端逐字渲染和停止按钮仍未实现
5. **RP-001: 低代码 AI 工作流设计器** — 暂缓状态，当前工作流模板硬编码在前端 `aiHomePresets.js`

### 2.3 需求趋势判断

从需求池趋势看，AI Agent 正从 **"辅助工具"** 向 **"工作流引擎"** 演进：

- **Phase 1A-1F**（已完成）：文件上传 → 解析 → 报告 → 确认 → 草稿
- **Phase 1G**（当前）：意图路由 + 知识库 + 多角色预设
- **Phase 1H**（进行中）：多通道运行时 + 工作流设计器 + AI Native 首页
- **下一阶段**：AI 驱动的项目管理闭环（从需求到交付的全链路 AI 辅助）

---

## 三、产品侧分析

### 3.1 产品定位与目标达成

根据 `WES-Agent-产品技术方案.html` 和 `design.html`，产品核心定位是：

> **"AI 辅助决策，不代替用户"** — AI/Harness 生成报告和建议，正式业务必须经人工确认

**目标达成情况：**

| 产品目标 | 达成度 | 说明 |
|---------|-------|------|
| 文件上传 → AI 理解 | ✅ 已实现 | 支持 Excel/Word/PDF，含 evidence 留痕 |
| 需求解析报告 v1/v2 | ✅ 已实现 | 双阶段报告，schema 校验 |
| 人工确认 → 传统草稿 | ✅ 已实现 | `enter_formal_estimation` 动作确认 |
| 草稿可追溯 | ✅ 已实现 | 草稿与 Harness Run 双向关联 |
| 多角色 AI 助手 | ✅ 已实现 | 7 种 BusinessRole 预设 prompt |
| 知识库问答 | ✅ 已实现 | 智谱知识库 + RAG Baseline |
| 流式实时响应 | ⚠️ 后端就绪 | SSE 已有，前端 UX 未完成 |
| AI 工作流驱动 | ❌ 未实现 | 当前仍是"聊天窗口"模式 |
| 多 Agent 协作 | ❌ 未实现 | 仅单一 Kimi Provider |

### 3.2 AI 工作台与传统页面的整合效果

**当前整合模式：**

```
AI 工作台 (AiHomeWorkbench)
  ├── 会话管理 ←→ ai-sessions 模块 (JSON 存储)
  ├── 文件解析 ←→ ai 模块 (chat.service)
  ├── 报告生成 ←→ harness 模块 (PostgreSQL)
  └── 动作确认 ←→ project-evaluations 模块 (JSON 存储)
```

**整合问题：**

1. **数据孤岛**：AI 会话数据（`data/ai-sessions.json`）与 Harness 运行数据（PostgreSQL）之间缺乏统一视图
2. **状态不一致**：前端 `useAiSessions` 管理的会话状态与 Harness Run 的状态机是两套独立体系
3. **跳转断裂**：从 AI 工作台跳转到传统评估页面后，上下文（Harness Run ID、Evidence 引用）无法完整传递

---

## 四、前端架构分析

### 4.1 AiHomeWorkbench.jsx 当前架构

**文件规模**：2602 行，是前端最大的单文件组件

**组件结构：**

```
AiHomeWorkbench (主页面 - 2602行)
├── SessionRail (会话列表 - 361行)
│   ├── 右键菜单 (复制ID/重命名/删除)
│   └── 重命名模态框
├── 对话区 (内联在主文件中)
│   ├── 消息列表 (用户/AI 气泡)
│   ├── CopyMessageButton
│   ├── InteractiveFormCard (结构化表单)
│   └── 工作流模板选择器
├── ArtifactPanel (产物面板 - 168行)
│   ├── 会话进度 Timeline (4步)
│   ├── 产物卡片列表
│   └── PendingActionCard (待确认动作)
└── CompanyLookupDialog (企业查询弹窗)
```

**关键问题：**

1. **单文件巨型聚合**（严重违反 AGENTS.md 第 7 条约定）
   - 2602 行的单文件包含：状态管理、API 调用、Markdown 渲染、文件解析、Harness 交互、UI 布局
   - 大量内联样式（`style={{...}}`）与 CSS 类混用
   - 工具函数（`buildHarnessParseResult`、`mergeAttachmentUnderstanding` 等）与 UI 组件耦合

2. **状态管理分散**
   ```javascript
   // 状态散落在多处：
   - useAiSessions hook → 会话列表/活跃会话
   - useState → 消息列表、发送状态、附件、工作流选择
   - localStorage → 面板折叠状态、活跃会话ID
   - Harness API → 运行状态（需轮询/SSE）
   ```

3. **三栏布局实现**
   - 当前实现了左侧会话栏 + 中间对话区 + 右侧产物面板
   - 但右侧"证据状态区"（ArtifactPanel）只展示产物摘要，未实现 Evidence 级别的溯源查看
   - 缺少"结构化工作区"的独立面板（当前混在对话区中）

### 4.2 前端与后端交互模式

```
前端                          后端
  │                             │
  ├─ POST /ai/parse-basic-info ─→ 文件解析（同步）
  ├─ POST /harness/runs ────────→ 创建 Harness Run
  ├─ POST /harness/runs/:id/files → 绑定文件
  ├─ POST /harness/runs/:id/parse-result → 提交解析结果
  ├─ POST /harness/runs/:id/report-v1 → 生成 v1 报告（调用 LLM）
  ├─ POST /harness/runs/:id/answers → 提交补充信息
  ├─ POST /harness/runs/:id/report-v2 → 生成 v2 报告（调用 LLM）
  ├─ POST /harness/runs/:id/actions/:actionId/confirm → 确认动作
  ├─ GET  /harness/runs/:id/events → SSE 事件流（占位实现）
  │                             │
  ├─ POST /ai/home-workbench-chat → AI 对话（意图路由 + 分发）
  └─ POST /ai/home-workbench-chat-stream → 流式对话（SSE）
```

**交互问题：**

1. **双轨并行**：`chat.service.ts`（AI 对话）和 `harness.usecase.ts`（任务运行）是两套独立的交互链路，前端需要同时维护两套状态
2. **SSE 未闭环**：`eventsHandler` 只返回当前状态快照，不是真正的实时事件推送
3. **轮询缺失**：前端没有实现 Harness Run 状态的自动轮询，用户需要手动刷新

---

## 五、后端架构分析

### 5.1 Agent 编排层 (`apps/api/src/agent/`)

**当前实现：**

```typescript
// orchestrator.ts - 核心编排循环（84行）
export async function runAgent(params: RunAgentParams): Promise<string> {
  // 1. 获取用户可用工具列表（按 RBAC 能力位过滤）
  const tools = registry.listToolsFor(user);
  // 2. 循环调用 LLM（最多 12 轮）
  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await runner.chatCompletion({ messages, tools, toolChoice: "auto" });
    // 3. 处理工具调用（写操作需确认）
    if (reply.toolCalls) { /* 执行工具 */ }
    // 4. 无工具调用 → 返回最终回复
    else { return reply.content; }
  }
}
```

**优势：**
- 清晰的 Tool-Use 编排模式
- RBAC 能力位控制工具可见性
- 写操作确认机制（`mutates: true` 需用户确认）
- 可注入假 Provider 便于测试

**不足：**
- **工具注册表几乎为空**：`createDefaultRegistry()` 只注册了 `buildEstimateTool` 一个工具
- **无上下文管理**：`context/` 目录有 `RuntimeContext`、`RunState` 等类型定义，但编排器未使用
- **无会话记忆**：每次调用都是独立的消息列表，不关联 AI Session 或 Harness Run
- **无流式支持**：编排器是同步阻塞式，不支持 SSE 流式推送工具执行过程

### 5.2 Harness 数据库存储

**PostgreSQL Schema（8 张表）：**

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `harness_runs` | 任务运行 | stage（16 种状态）、status、mode、owner |
| `harness_files` | 绑定文件 | attachmentId、fileName、role |
| `harness_evidences` | 证据 | sourceType、evidenceType、tableSnapshot |
| `harness_artifacts` | 任务产物 | artifactType（6 种）、content（JSONB） |
| `harness_tool_events` | 工具事件 | actionId、eventType、status |
| `harness_model_runs` | 模型调用 | provider、model、elapsedMs、fallbackReason |
| `harness_scores` | 评分 | scoreType、value、passed |
| `harness_cases` + `harness_expected_answers` | 回归样本 | caseKey、expected（JSONB） |

**优势：**
- 完整的审计链路（Run → File → Evidence → Artifact → ToolEvent → ModelRun）
- 状态机驱动（16 种 stage，有严格的阶段转换规则）
- 幂等确认（重复确认返回既有结果）
- 回归测试基础设施（Cases + ExpectedAnswers + Scores）

**不足：**
- **SSE 事件推送未实现**：`eventsHandler` 只返回一次性状态快照
- **缺少 WebSocket 或长轮询**：前端无法实时感知 Run 状态变化
- **ModelRun 与 Artifact 关联弱**：`modelRunId` 可空，缺少强约束

### 5.3 18 个业务模块与 AI Agent 的集成

**当前集成状况：**

```
AI Agent 可触达的业务模块：
├── estimates（评估计算）→ 通过 buildEstimateTool 注册到 ToolRegistry
├── project-evaluations（项目评估）→ 通过 confirmHarnessAction 创建草稿
├── system（系统配置）→ 通过 resolveActiveRequirementKimiApiKey 获取 API Key
├── ai-sessions（AI 会话）→ 通过 appendAiSessionEvent 记录对话
└── trace（追踪）→ 通过 recordWorkbenchTurnTrace 记录追踪

未集成的模块：
├── rules（规则引擎）→ 未暴露给 Agent
├── templates（模板）→ 未暴露给 Agent
├── wbs（工作分解）→ 未暴露给 Agent
├── presales（售前）→ 未暴露给 Agent
├── collab（协作）→ 未暴露给 Agent
└── ... 其他 12 个模块
```

**核心问题：Agent 工具生态极度匮乏** — 只有 1 个注册工具，18 个业务模块中仅 5 个与 AI Agent 有交互。

### 5.4 AI 服务层（`services/ai/`）

**核心服务：**

| 服务 | 行数 | 职责 |
|------|------|------|
| `chat.service.ts` | 910 | AI 对话入口、文件解析、企业画像 |
| `workbench-dispatch.service.ts` | 1001 | 意图分发器（10 种意图 → 对应处理路径） |
| `workbench-intent.service.ts` | 215 | 意图路由器（规则优先 + 模型兜底） |
| `extractor.service.ts` | 529 | 文件内容提取 |
| `knowledge-tool.service.ts` | 605 | 知识库查询工具 |
| `knowledge-base-router.service.ts` | 188 | 多知识库路由 |
| `workbench-context.service.ts` | 92 | 工作台上下文构建 |

**架构问题：**

1. **`chat.service.ts` 910 行**：包含文件解析、企业画像、Kimi 对话、流式处理等多个职责，违反单一职责原则
2. **`workbench-dispatch.service.ts` 1001 行**：意图分发器包含所有意图的处理逻辑，新增意图需要修改此文件
3. **AI 模块是 facade**：`modules/ai/` 只是 re-export，实际实现在 `services/ai/`，违反 AGENTS.md 的模块约定

---

## 六、关键发现总结

### 架构亮点

1. **Harness 审计底座设计优秀**：完整的 Run → File → Evidence → Artifact → ToolEvent → ModelRun 链路，支持回归测试
2. **状态机驱动**：16 种 stage 有严格的转换规则，防止非法操作
3. **人在环确认机制**：所有写操作必须经用户确认，符合"AI 辅助决策"定位
4. **RBAC 能力位控制**：工具按用户能力位过滤，安全性有保障

### 最紧迫的架构瓶颈

| 排名 | 问题 | 影响 | 严重程度 |
|------|------|------|---------|
| 1 | 前端 2602 行单文件巨型聚合 | 开发效率低、bug 难定位、违反 AGENTS.md 约定 | 🔴 高 |
| 2 | Agent 工具生态匮乏（仅 1 个工具） | AI 能力边界受限、无法发挥 Agent 价值 | 🔴 高 |
| 3 | AI 会话与 Harness 双轨并行 | 状态不一致、数据孤岛、用户体验断裂 | 🟡 中 |
| 4 | SSE 实时性未闭环 | 用户需手动刷新、体验差 | 🟡 中 |
| 5 | AI 服务层文件过大（910/1001 行） | 可维护性差、新增意图困难 | 🟡 中 |
| 6 | `modules/ai/` 是 facade | 违反模块约定、技术债务 | 🟢 低 |

---

*本报告基于 2026-08-03 代码快照分析，后续架构变更需同步更新。*
