# WES AI Agent 架构优化方案计划

> **制定日期**: 2026-08-03
> **基于报告**: [analysis-report-2026-08-03.md](./analysis-report-2026-08-03.md)
> **当前阶段**: 阶段 1H-C 规划中
> **架构约束**: 严格遵循 AGENTS.md 架构边界约定

---

## 一、优化目标与原则

### 1.1 核心目标

| 目标 | 衡量指标 | 当前值 | 目标值 |
|------|---------|-------|-------|
| 前端可维护性 | AiHomeWorkbench.jsx 行数 | 2602 行 | ≤300 行（入口文件） |
| Agent 工具覆盖 | 注册工具数量 | 1 个 | ≥8 个 |
| 数据一致性 | AI 会话与 Harness 统一视图 | 双轨并行 | 统一查询接口 |
| 实时性 | Harness Run 状态更新延迟 | 手动刷新 | ≤2s SSE 推送 |
| 服务层可维护性 | 单文件最大行数 | 1001 行 | ≤300 行 |

### 1.2 优化原则

1. **不引入第二前端/后端主实现**（AGENTS.md §12）
2. **不跳过权限校验、数据隔离与版本引用完整性约束**（AGENTS.md §12）
3. **传统 WES 记录仍以 JSON 文件存储为主**（AGENTS.md §2）
4. **Harness 域继续使用 PostgreSQL**（AGENTS.md §2）
5. **页面变更优先在对应 dashboard 路由分模块落地**（AGENTS.md §7）
6. **复用 `src/api/*` 作为 API 访问层**（AGENTS.md §7）

---

## 二、优化措施与实施步骤

### 2.1 前端架构优化（优先级：P0）

#### 问题
AiHomeWorkbench.jsx 2602 行单文件巨型聚合，违反 AGENTS.md §7"避免单文件巨型聚合"约定。

#### 优化方案：组件拆分与状态收敛

**目标目录结构：**

```
ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/
├── index.jsx                      # 页面入口（≤100行，纯布局组装）
├── hooks/
│   ├── useWorkbenchState.js       # 收敛所有 useState 为单一状态机
│   ├── useHarnessRun.js           # Harness Run 生命周期管理
│   └── useChatMessages.js         # 消息列表与发送逻辑
├── components/
│   ├── ChatArea/                  # 对话区
│   │   ├── MessageList.jsx        # 消息列表渲染
│   │   ├── MessageBubble.jsx      # 单条消息气泡
│   │   ├── Composer.jsx           # 输入区（含附件上传）
│   │   └── WorkflowTemplates.jsx  # 工作流模板选择器
│   ├── WorkspacePanel/            # 结构化工作区（新增）
│   │   ├── ReportViewer.jsx       # v1/v2 报告渲染
│   │   ├── EvidenceViewer.jsx     # 证据溯源查看
│   │   └── DraftLinker.jsx        # 草稿关联跳转
│   └── StatusPanel/               # 证据状态区（改造现有 ArtifactPanel）
│       ├── RunStageIndicator.jsx  # Run 阶段指示器
│       ├── ModelRunTrace.jsx      # 模型调用追踪
│       └── ActionConfirmer.jsx    # 动作确认卡片
└── utils/
    ├── harnessPayload.js          # Harness 请求构建
    ├── reportParser.js            # 报告解析
    └── messageFormatter.js        # 消息格式化
```

**实施步骤：**

| 步骤 | 任务 | 产出物 | 预估工时 |
|------|------|--------|---------|
| F1 | 创建目录结构，提取工具函数到 `utils/` | 3 个工具文件 | 2h |
| F2 | 提取 `useWorkbenchState` hook，收敛分散的 useState | 1 个 hook 文件 | 3h |
| F3 | 拆分 ChatArea 组件（MessageList/MessageBubble/Composer） | 4 个组件文件 | 4h |
| F4 | 拆分 StatusPanel 组件（改造 ArtifactPanel） | 3 个组件文件 | 3h |
| F5 | 新建 WorkspacePanel 组件（报告渲染+证据溯源） | 3 个组件文件 | 4h |
| F6 | 改造 index.jsx 为纯布局组装 | 入口文件 ≤100 行 | 2h |
| F7 | 验证 build:web 通过 + 功能回归 | 构建通过 | 1h |

**验收标准：**
- [ ] `npm run build:web` 通过
- [ ] AiHomeWorkbench/index.jsx ≤100 行
- [ ] 所有子组件文件 ≤200 行
- [ ] 功能回归：文件上传、报告生成、动作确认、会话管理正常

---

### 2.2 Agent 编排层增强（优先级：P0）

#### 问题
Agent 工具生态匮乏（仅 1 个 `buildEstimateTool`），18 个业务模块中仅 5 个与 AI Agent 有交互。

#### 优化方案：工具注册表扩展

**新增工具清单：**

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

**实施步骤：**

| 步骤 | 任务 | 产出物 | 预估工时 |
|------|------|--------|---------|
| A1 | 定义新增工具的 AgentTool 接口实现 | 4 个查询工具文件 | 4h |
| A2 | 实现写操作工具（含确认机制） | 3 个写操作工具文件 | 4h |
| A3 | 扩展 `createDefaultRegistry()` 注册所有工具 | 更新 agent.routes.ts | 1h |
| A4 | 将 RuntimeContext 注入编排循环 | 更新 orchestrator.ts | 2h |
| A5 | 补充工具单元测试 | 测试文件 | 3h |
| A6 | 验证 test:modules 通过 | 测试通过 | 1h |

**验收标准：**
- [ ] `npm run test:modules` 通过
- [ ] ToolRegistry 注册工具数 ≥8
- [ ] 所有写操作工具触发 `need_confirm` 事件
- [ ] RBAC 能力位正确过滤工具

---

### 2.3 Harness 实时性增强（优先级：P1）

#### 问题
SSE `eventsHandler` 只返回一次性状态快照，前端无法实时感知 Run 状态变化。

#### 优化方案：实现真正的 SSE 事件推送

**技术方案：**

```typescript
// 新增：Harness 事件总线
// apps/api/src/modules/harness/harness.event-bus.ts
export class HarnessEventBus {
  private listeners = new Map<string, Set<(event: HarnessEvent) => void>>();
  
  subscribe(runId: string, callback: (event: HarnessEvent) => void): () => void {
    // 订阅指定 Run 的状态变更
  }
  
  publish(runId: string, event: HarnessEvent): void {
    // 发布状态变更事件
  }
  
  unsubscribe(runId: string, callback: Function): void {
    // 取消订阅
  }
}
```

**改造 eventsHandler：**

```typescript
// harness.controller.ts - eventsHandler 改造
export function eventsHandler(deps: HarnessControllerDeps = {}) {
  return async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
    
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
    
    // 客户端断开时清理
    req.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  };
}
```

**前端配合：**

```javascript
// useHarnessRun.js - SSE 订阅 hook
export function useHarnessRunEvents(runId) {
  const [runState, setRunState] = useState(null);
  
  useEffect(() => {
    if (!runId) return;
    
    const eventSource = new EventSource(`/api/v1/harness/runs/${runId}/events`);
    
    eventSource.addEventListener('run_state', (e) => {
      setRunState(JSON.parse(e.data));
    });
    
    eventSource.addEventListener('stage_change', (e) => {
      // 处理阶段变更
    });
    
    return () => eventSource.close();
  }, [runId]);
  
  return runState;
}
```

**实施步骤：**

| 步骤 | 任务 | 产出物 | 预估工时 |
|------|------|--------|---------|
| H1 | 实现 HarnessEventBus 事件总线 | harness.event-bus.ts | 2h |
| H2 | 在 usecase 状态变更处发布事件 | 更新 harness.usecase.ts | 2h |
| H3 | 改造 eventsHandler 支持持续推送 | 更新 harness.controller.ts | 2h |
| H4 | 前端实现 useHarnessRunEvents hook | useHarnessRun.js | 2h |
| H5 | 集成测试 SSE 推送 | 测试文件 | 2h |

**验收标准：**
- [ ] SSE 连接建立后能收到初始状态快照
- [ ] Run 状态变更时前端 ≤2s 收到推送
- [ ] 客户端断开后服务端正确清理资源
- [ ] 心跳保活机制正常工作

---

### 2.4 AI 服务层重构（优先级：P1）

#### 问题
`chat.service.ts` 910 行、`workbench-dispatch.service.ts` 1001 行，违反单一职责原则。

#### 优化方案：按意图类型拆分处理器

**目标目录结构：**

```
services/ai/
├── handlers/
│   ├── capability-discovery.handler.ts   # 能力发现（≤100行）
│   ├── domain-qa.handler.ts             # 领域问答（≤100行）
│   ├── knowledge-query.handler.ts       # 知识库查询（≤150行）
│   ├── attachment-qa.handler.ts         # 附件问答（≤150行）
│   ├── harness-report.handler.ts        # 报告生成（≤200行）
│   ├── wes-data-query.handler.ts        # WES 数据查询（≤100行）
│   └── write-action.handler.ts          # 写动作（≤100行）
├── chat.service.ts          # 精简为入口路由（≤200行）
├── workbench-dispatch.service.ts  # 精简为分发器（≤200行）
└── workbench-intent.service.ts    # 保持不变（215行）
```

**实施步骤：**

| 步骤 | 任务 | 产出物 | 预估工时 |
|------|------|--------|---------|
| S1 | 创建 handlers 目录，定义 Handler 接口 | handler.types.ts | 1h |
| S2 | 从 dispatch.service 提取各意图处理逻辑 | 7 个 handler 文件 | 6h |
| S3 | 精简 chat.service.ts 为入口路由 | 更新 chat.service.ts | 2h |
| S4 | 精简 dispatch.service 为纯分发器 | 更新 dispatch.service.ts | 2h |
| S5 | 补充 handler 单元测试 | 测试文件 | 3h |
| S6 | 验证 test:ai 通过 | 测试通过 | 1h |

**验收标准：**
- [ ] `npm run test:ai` 通过
- [ ] chat.service.ts ≤200 行
- [ ] workbench-dispatch.service.ts ≤200 行
- [ ] 新增意图只需添加新 handler 文件，不修改现有文件

---

### 2.5 数据一致性改善（优先级：P1）

#### 问题
AI 会话数据（`data/ai-sessions.json`）与 Harness 运行数据（PostgreSQL）双轨并行，缺乏统一视图。

#### 优化方案：统一会话视图服务

**新增 API：**

```
GET /api/v1/ai-sessions/:sessionId/unified-view
```

**响应结构：**

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

**实施步骤：**

| 步骤 | 任务 | 产出物 | 预估工时 |
|------|------|--------|---------|
| D1 | 在 ai-sessions 模块新增 unified-view 查询 | unified-view.usecase.ts | 3h |
| D2 | 实现会话与 Harness Run 关联查询 | 关联查询逻辑 | 2h |
| D3 | 实现产物与动作合并逻辑 | 合并工具函数 | 2h |
| D4 | 新增 API 路由与控制器 | unified-view.controller.ts | 1h |
| D5 | 前端集成统一视图 | 更新 useAiSessions.js | 2h |
| D6 | 验证数据一致性 | 测试通过 | 1h |

**验收标准：**
- [ ] 统一视图 API 返回完整的会话+Harness 数据
- [ ] 前端切换会话时能正确加载关联的 Harness Run
- [ ] 产物列表包含 AI 会话产物和 Harness 产物

---

### 2.6 技术债务清理（优先级：P2）

#### 2.6.1 AI 模块 facade 迁移

**问题**：`modules/ai/` 只是 re-export，实际实现在 `services/ai/`，违反 AGENTS.md §5 模块约定。

**方案**：将 `services/ai/` 迁移到 `modules/ai/`

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| T1 | 在 `modules/ai/` 下创建完整三层结构 | 2h |
| T2 | 迁移 `services/ai/` 实现到 `modules/ai/` | 4h |
| T3 | 更新所有 import 引用 | 2h |
| T4 | 保留 `services/ai/index.ts` 为 barrel re-export | 1h |
| T5 | 验证 test:modules 通过 | 1h |

#### 2.6.2 SSE 前端流式 UX 完善

**问题**：RP-029 后端已支持 SSE 流式，但前端逐字渲染和停止按钮未实现。

**方案**：

| 步骤 | 任务 | 预估工时 |
|------|------|---------|
| T6 | 实现前端 SSE 流式接收 hook | 2h |
| T7 | 实现逐字渲染组件 | 2h |
| T8 | 实现停止按钮与中断逻辑 | 1h |
| T9 | 验证流式体验 | 1h |

---

## 三、优先级排序与时间安排

### 3.1 总体优先级矩阵

| 优先级 | 优化项 | 影响 | 紧急度 | 总工时 |
|--------|--------|------|--------|--------|
| **P0** | 前端组件拆分 | 开发效率 | 高 | 19h |
| **P0** | Agent 工具扩展 | AI 能力边界 | 高 | 15h |
| **P1** | Harness SSE 实时推送 | 用户体验 | 中 | 10h |
| **P1** | AI 服务层重构 | 可维护性 | 中 | 15h |
| **P1** | 数据一致性改善 | 数据完整性 | 中 | 11h |
| **P2** | AI 模块 facade 迁移 | 技术债务 | 低 | 10h |
| **P2** | SSE 前端流式 UX | 用户体验 | 低 | 6h |

### 3.2 时间安排（按 Sprint 划分）

#### Sprint 1（第 1 周）：前端拆分 + Agent 工具扩展

| 日期 | 任务 | 产出 |
|------|------|------|
| Day 1-2 | F1-F3: 前端工具函数提取 + ChatArea 拆分 | 3 个工具文件 + 4 个组件 |
| Day 3-4 | F4-F6: StatusPanel 拆分 + WorkspacePanel 新建 + 入口精简 | 6 个组件 + 入口文件 |
| Day 5 | F7: 前端验证 + A1-A2: Agent 查询工具实现 | build:web 通过 + 4 个工具 |
| Day 6-7 | A3-A6: Agent 写操作工具 + 注册表扩展 + 测试 | 8 个工具注册 + 测试通过 |

**Sprint 1 验收：**
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

**Sprint 2 验收：**
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

**Sprint 3 验收：**
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

## 七、与 AGENTS.md 架构边界的一致性检查

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

*本计划基于 2026-08-03 架构分析制定，实施过程中需根据实际情况调整。*
