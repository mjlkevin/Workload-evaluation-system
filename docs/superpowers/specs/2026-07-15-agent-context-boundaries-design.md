# WES Agent 上下文边界设计规格

> 状态：待用户确认后进入实施计划
> 日期：2026-07-15
> 适用范围：`apps/api` Agent、AI 工作台、Harness 与 Trace 运行链路

## 1. 目标

在不引入新 Graph 框架、不启动多租户数据库改造的前提下，把 WES 当前分散的用户、会话、提示词、工具、Harness 和 Trace 信息收敛为四类边界清晰的上下文契约：

1. `RuntimeContext`：一次运行期间不可变、由服务端生成的身份与关联信息。
2. `ModelContext`：经过筛选后允许发送给模型的信息。
3. `ToolContext`：单个工具执行所需的最小权限、运行信息和业务端口。
4. `RunState`：可变化、可持久化、可恢复的会话与 Harness 任务状态。

成功标准不是“新增四个类型名称”，而是能够证明模型、工具和状态存储分别只能看到自己需要的信息，并能通过同一组运行标识完成追踪。

## 2. 已确认事实

- Provider 请求已经包含 `messages`、`tools`、`responseFormat`，但 prompt 组装分散在 Agent、工作台分发和具体 AI 服务中。
- Agent 工具当前只接收 `args + user`，没有运行标识、状态引用或受限业务端口。
- AI Session、Harness Run、Artifact、ModelRun、ToolEvent 和 Trace 已持久化，因此 State 应评为“已有但碎片化”，不能因没有 Graph 而评为未实现。
- `requestId`、`traceId`、`sessionId`、`harnessRunId` 已分别存在，但缺少入口创建和全链路透传规则。
- 当前没有已确认的多租户和多渠道产品需求；`tenantId` 只能作为可选扩展位，不能触发本轮数据库迁移。

## 3. 方案比较

### 方案 A：统一大对象 ContextEnvelope

把 user、messages、tools、store、state、trace 全部放进一个对象并在所有层透传。

- 优点：改造入口少，调用方便。
- 缺点：模型、工具和业务层容易获得超出需要的信息；形成新的 God Context；权限和隐私边界不可验证。
- 结论：不采用。

### 方案 B：四类独立契约 + 显式转换器（采用）

运行入口创建只读 `RuntimeContext`；模型调用前由 `ModelContextComposer` 按白名单生成 `ModelContext`；工具注册器为单次调用生成 `ToolContext`；状态适配器只引用现有 AI Session/Harness/Trace 存储。

- 优点：边界可测试；兼容现有架构；可以增量接入 Agent 和工作台；不需要新增框架或数据库表。
- 缺点：需要修改若干函数签名，并为旧调用保留受控迁移路径。
- 结论：推荐并采用。

### 方案 C：仅补文档和命名

只在审计报告中定义四类上下文，不改变运行代码。

- 优点：成本最低。
- 缺点：无法阻止附件内容进入 system prompt、运行标识断链或工具获得不受控依赖。
- 结论：只能作为准备动作，不能满足本次目标。

## 4. 核心契约

### 4.1 RuntimeContext

`RuntimeContext` 在 HTTP/任务入口创建，进入运行后保持只读：

```ts
type RuntimeChannel = "web" | "api" | "replay" | "regression";

type RuntimeContext = Readonly<{
  requestId: string;
  traceId: string;
  actor: Readonly<{
    userId: string;
    username?: string;
    roles: readonly string[];
    capabilities: readonly Capability[];
  }>;
  channel: RuntimeChannel;
  workflowKey: string;
  aiSessionId?: string;
  harnessRunId?: string;
  tenantId?: string;
}>;
```

约束：

- `actor` 必须来自 JWT/RBAC，不接受模型或请求体覆盖。
- `requestId` 关联一次 API 请求；`traceId` 关联一次 Agent/工作台运行；两者不得混用。
- `tenantId` 本轮不写数据库、不参与隔离判断，仅保留可选扩展位。
- Channel 先支持现有入口，不能由任意客户端字符串直接注入。

### 4.2 ModelContext

`ModelContext` 是模型调用的最终白名单，不包含 RuntimeContext、Repository、API Key、JWT、完整用户对象或数据库句柄：

```ts
type ModelContext = Readonly<{
  messages: readonly ChatMessage[];
  tools: readonly ToolDefinition[];
  responseFormat?: ResponseFormat;
  contextRefs: readonly ContextRef[];
  budget: Readonly<{ maxInputTokens?: number; maxMessages: number }>;
}>;
```

组装顺序固定为：系统安全规则 → 业务角色规则 → 任务规则 → 经过标记的外部证据 → 会话消息。附件、知识库结果、项目摘要属于不可信证据，只能进入 user/evidence 区，不得拼成可覆盖安全规则的 system 指令。

第一批使用消息数预算并保留现有 12 条上限；后续拿到稳定 token 估算后再升级为 token 预算，不在本轮引入 tokenizer 依赖。

### 4.3 ContextRef

把当前纯字符串引用升级为可序列化结构，同时继续输出兼容字符串：

```ts
type ContextRef = Readonly<{
  type: "attachment" | "knowledge" | "project" | "harness" | "artifact" | "standard";
  id: string;
  version?: string;
  hash?: string;
  ownerUserId?: string;
  sensitivity: "public" | "internal" | "confidential";
  includedInModel: boolean;
}>;
```

本轮不迁移历史 Trace JSON；只对新运行提供结构化引用，并由适配器生成旧 `type:id` 字符串，保证接口兼容。

### 4.4 ToolContext

工具执行只获得当前工具所需的运行信息与业务端口：

```ts
type ToolContext<TPorts extends object = Record<string, never>> = Readonly<{
  runtime: RuntimeContext;
  ports: TPorts;
  confirmation: Readonly<{ confirmed: boolean; idempotencyKey?: string }>;
  recordEvent: (event: ToolExecutionEvent) => void;
}>;
```

约束：

- Tool 不接收通用数据库连接或万能 Store。
- 数据访问继续通过 `modules/<domain>` 暴露的 usecase/repository 端口。
- 工具参数在执行前校验；能力位在注册器执行前再次校验。
- 写工具必须同时满足 capability、人工确认和幂等键要求。

现有 `estimate_implementation` 是只读工具，第一批只接入 runtime 和事件记录，不新增持久化写入。

### 4.5 RunState

不新增通用 Graph State 表，而是定义现有状态的聚合视图：

```ts
type RunState = Readonly<{
  conversation: { aiSessionId?: string; messageCount: number; status?: string };
  execution: { harnessRunId?: string; stage?: string; status?: string };
  artifacts: readonly { artifactId: string; type: string; version?: string; status: string }[];
  pendingActions: readonly { actionId: string; actionType: string; status: string }[];
  contextRefs: readonly ContextRef[];
}>;
```

`RunState` 是只读聚合和恢复契约；状态更新仍由 AI Session/Harness usecase 完成，禁止绕过业务层直接写数据库。

## 5. 数据流

```text
JWT/RBAC + HTTP/任务入口
  -> createRuntimeContext()
  -> 意图路由/Agent 编排
      -> composeModelContext(runtime, state, input)
          -> Provider（只接收 ModelContext）
      -> createToolContext(runtime, scoped ports, confirmation)
          -> Tool（只接收 args + ToolContext）
      -> AI Session/Harness usecase 更新状态
  -> Trace/ToolEvent/ModelRun 使用同一 traceId/runId 关联
```

模型输出不得直接修改 RuntimeContext 或 RunState。任何写动作必须先变成待确认动作，再由受权限保护的 usecase 执行。

## 6. 分批实施范围

### Batch 1：契约与 Agent 基座

- 新增 context 类型、构造器和单元测试。
- `/api/v1/agent/chat` 在入口创建 RuntimeContext。
- `runAgent` 接收 RuntimeContext，并用其能力位筛选工具。
- `AgentTool.execute` 改为 `args + ToolContext`。
- 保持 `/api/v1/agent/chat` 响应结构兼容。

### Batch 2：模型上下文与工作台接入

- 为 Agent/工作台建立共享的模型上下文组装器。
- 把附件解析内容从 system instruction 移入标记清晰的 evidence/user 消息。
- 统一最近消息裁剪、角色过滤和结构化 ContextRef。
- 非流式和 SSE 路径使用相同的 RuntimeContext/ModelContext 规则。

### Batch 3：现有 State 聚合与审计对齐

- 从 AI Session/Harness 生成 RunState 只读快照。
- Trace、ToolEvent、ModelRun 对齐 `traceId`、`aiSessionId`、`harnessRunId`。
- 更新 OpenAPI、实现与文档对齐说明、上下文架构审计报告和总看板设计/运行时/风险/变更页面。

## 7. 错误与兼容策略

- RuntimeContext 缺少可信用户身份时立即拒绝执行，不降级为匿名工具调用。
- ContextRef 无效时不注入模型，并记录可查询的边界拒绝事件。
- ToolContext 缺少所需端口时返回明确的工具不可用错误，不允许工具自行查找全局 Store。
- 新类型先通过构造器接入，不改变现有 Provider 厂商协议。
- 不迁移历史 AI Session、Trace 或 Harness 数据；旧记录通过适配器读取。
- 本轮不新增 PostgreSQL 表、不增加 tenant 数据隔离、不引入 Graph/工作流依赖。

## 8. 测试与验收

必须按 TDD 实施，至少覆盖：

1. RuntimeContext 的 actor 只能来自服务端认证结果，且创建后不可通过业务函数修改。
2. ModelContext 不包含 API Key、JWT、完整 RuntimeContext 或 Repository。
3. 前端传入的 system 消息和附件中的伪指令不能进入安全 system 层。
4. ToolRegistry 在能力不足时拒绝执行，并把同一 traceId 传给已授权工具。
5. 写工具在未确认时不执行；重复幂等键不产生重复事件。
6. RunState 能从现有 AI Session/Harness 数据形成稳定快照，不直接写 Store。
7. `/api/v1/agent/chat` 保持 `{ code, message, data }` 响应兼容。
8. `npm run test:modules`、相关 Agent/AI 测试、`npm run build:api` 通过。

## 9. Graph 触发条件

只有满足以下任一条件才另立方案评估 Graph：

- 需要稳定的条件分支或并行节点编排；
- 需要跨进程暂停/恢复；
- 节点级重试、补偿、回放无法由 Harness 阶段机表达；
- 子任务依赖关系无法通过当前阶段与 ToolEvent 审计清晰追踪。

Graph 不属于本规格的交付范围。

## 10. 变更保护

当前工作区在 Agent、工作台、Trace 和总看板文件中已有大量未提交改动。实施时：

- 不清理、不格式化、不还原既有改动；
- 修改重叠文件前先核对局部 diff；
- 优先新增聚焦文件和窄范围补丁；
- 每批验证后再进入下一批；
- 是否创建隔离 worktree 需考虑未提交依赖，不能在丢失当前事实的干净 HEAD 上盲目实施。
