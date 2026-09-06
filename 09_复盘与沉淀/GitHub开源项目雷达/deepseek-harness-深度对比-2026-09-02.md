# WES 自研 Harness × DeepSeek Harness（dsh）深度对比

> 日期：2026-09-02 · 撰写视角：架构侧复核
> dsh 源码：`/Users/kevin/Library/Mobile Documents/com~apple~CloudDocs/AI-project/deepseek-harness`（version 0.3.3，MIT，TypeScript，pnpm monorepo，51 个包）
> WES 现状：架构侧已实取核实，本文直接采用，不重新盘点

---

## 0. 结论先行

1. **九项能力里，dsh 明显更完备的有 6 项，大致等价 1 项，WES 已够用 2 项。** 差距最大的是「事件流/持久化」这一对（dsh 用 append-only 因果日志作为唯一真相，UI 只是它的一次折叠）和「待确认动作」（dsh 把确认做进了工具执行流水线的决策槽，WES 是旁路正则）。
2. **WES 真正领先的是第 5 项：工具副作用幂等。** dsh 全库没有 effect 幂等登记表的等价物，只有一条建议性的重复调用提醒（`dsh-repeat-tool-reminder`，README 明写「提醒只是建议，绝非阻止」）。WES 的 `recordToolEffectOnce` + `effectKey` 是确定性的，dsh 是结构性能防重、语义上不防重。
3. **dsh 有而 WES 完全空白、且对「harness + 垂直业务」有实际价值的，第一梯队是 5 项：compaction（上下文压缩）、token-meter（预算计量）、spill（大结果外置）、skills（技能发现与注入）、session-projection（投影与恢复）。** 这 5 项共同构成「长会话不爆上下文」的闭环，WES 目前一项都没有。
4. **四个待定架构决定，dsh 解了 3.5 个。** 循环可恢复化、写操作确认流、多轮幂等，都有明确机制与出处；**第③个（规则驱动 vs 模型驱动的意图识别过渡）dsh 根本没有这条轴** —— 它的切分是「谁发起」（人发起走 commands 绕过模型，模型发起走 tools），不存在规则匹配意图这一层。这恰恰是 WES 最特殊的形态，也是迁移代价最高的地方。
5. **迁移初判：推荐 C（局部替换），不推荐 A（全量迁）。** 决定性理由不是代码量，而是 dsh 自己 README.zh.md L13 的原文警告：「处于 _开发者预览_ 阶段……**未来将出现破坏兼容性的变更**」，且 `SessionHeader.version` 不匹配时是**拒绝加载而非自动迁移**（persistence.zh.md），等于把升级期的数据迁移责任全部转给使用方。A 路线等于把一个正在剧烈变动的上游内核变成 WES 的地基。
6. **无论选哪条路，WES 当前最关键的那个缺口都不会被自动修好：工作台调模型时不传 tools。** 这在 dsh 里是结构性不可能发生的状态（工具集属于 Agent 组合的一部分，随 `EpochHeader.tools` 进入请求头快照）。它是 WES 侧必须自己先做的事，与迁移决策解耦。

### 出处约定

- dsh 结论一律给到「子系统文档名 + 关键类型/接口名」，形如 `session.zh.md · SessionEventMap`。
- 文档路径统一为 `docs/subsystems/*.zh.md`（除注明 `README.zh.md` 或包内 README）。
- **只写文档里明确存在的东西**；读不到的一律写「未在文档中找到」，不做推测补全。
- WES 侧的文件路径与行数为架构侧实取结论，本文按用户指示直接采用。
- 部分 dsh 论断额外附了原文行号（形如 `session.zh.md L558`），这些是本文写作时逐行回读过的。
- **本文各条 dsh 结论的证据强度不一致**，按附录 A 的三档取信：第 1 档为本文作者逐行回读并可给行号；第 2 档为整篇读过但未逐行定位；第 3 档为子代理回报的 background，仅其中四处抽查过原文。

---

## 一、九项能力对照表

| # | 能力 | WES 实现 | dsh 对应机制（包名 + ctx 键） | 差距评价 |
|---|---|---|---|---|
| 1 | 工具编排循环 | `apps/api/src/agent/orchestrator.ts`，114 行，`runAgent(): Promise<string>`，阻塞式 for 循环 + maxTurns + discovery 模式 | `packages/core/agent` · `ctx.agentLoop — Agent`（`core.zh.md`）。dsh 里 Agent 是**可重入的步骤机**：`agent/pre-step` 是 waterfall 事件，返回 `PreStepDecision`；指令入口 `Agent.steer()/inject()/cancel()`，收件箱目标 `InboxTarget = 'next-turn' \| 'next-step'`；每轮 `turn/start … turn/end{reason}` 收口（`session.zh.md · TurnEndReasonMap`） | **dsh 明显更完备**。WES 的循环是一个只能整体跑完或整体失败的 Promise；dsh 的循环在**每一步之前**都有可中断/可改写/可放行的决策点 |
| 2 | 工具注册表 | `default-registry.ts` + `agent/tools/` 5 个文件；工具带 `capability`（RBAC）与 `mutates`（写操作）标记 | `packages/tools/tool` · `ctx.tools — ToolRegistry`（`tools.zh.md`）。`ToolDefinition` = `ToolSchema`（面向模型）+ **必需的**规范输出声明 `output`（含 `render()`）+ `execute` + 仅宿主可用的调度元数据 + 可选 `finalizeContent` + 可选 UI 展示。执行是一条固定流水线（L172）：`tools/pre-execute`（**可重排的 allow/deny/ask waterfall**）→ 已注册的**单调 guard** → `tools/execute`（环绕分派包装层）→ `tools/post-execute`（检查/替换结果，返回 `PostToolDecision`）→ 可选 `finalizeContent` → `tools/result`（**不可变的权威结果**，观察者无法变换）。决策类型是可辨识联合 `PreToolDecision = { kind: 'allow' \| 'deny' \| 'ask', reason? }`（L385-388）；`ToolExecutionMode` 的 `exclusive`「单独运行并形成**排序屏障**」（L248-252）；`schemas()` 通过**显式允许列表**构建模型可见 schema，`output`/`execute`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/`presentResult` **绝不能泄漏到模型请求**（L11） | **dsh 明显更完备**。WES 的两个标记是**静态元数据，靠调用方自己读**；dsh 把「能不能执行」「执行前改写」「执行后加工」「结果如何呈现」拆成流水线上可挂多个插件的阶段。附带一条 WES 直接可用的判据（L404）：**「内容替换是展示策略，而非保密策略」**——要藏程序化值必须 deny 或替换该值，改内容藏不住。WES 的 `capability`/`mutates` 在 dsh 里对应的是 `ToolRestriction` + 决策槽，不是字段 |
| 3 | Run 状态机 | `harness-runtime.types.ts`：活跃态 queued/running/waiting/recovering/cancelling，终态 completed/failed/cancelled；attempt 态 claimed/running/succeeded/failed/orphaned/cancelled | **未在文档中找到 "run" 这一层。** dsh 的分层是：`AgentStatus = 'idle' \| 'running'`（`core.zh.md`）+ `TurnEndReasonMap`（`session.zh.md`，轮次结束原因，可经 declaration merging 扩展）+ `JobStatus = 'running' \| 'stopping' \| 'completed' \| 'killed' \| 'failed'`（`jobs.zh.md`） | **大致等价，但切法不同。** dsh 切「会话/轮次/后台作业」，WES 切「run/attempt」。**WES 的 `claimed`/`orphaned` 是跨实例租约语义，dsh 文档里没有对应物**（`ctx.jobs` 是单进程内的 `LocalJobRegistry`，`maxConcurrentJobsPerOwner` 默认 10）——这一格 WES 反而更明确 |
| 4 | checkpoint + 恢复 | checkpoint kinds: structural/semantic/combined；resume policies: resume_next/restart_step/manual | 恢复点是**日志位置**，不是快照类型。崩溃尾部由后端补齐：`persistence.zh.md` L15「后端**不会**截断日志……改为用一个合成的 `turn/end { reason: { kind: 'interrupted' } }` 关闭这个遗留轮次」；`session.zh.md` L545-548：`interrupted` 是**唯一**不由循环自身发出的 reason；`SessionHeader` 携带 `agentPreset`/`delegationDepth`/`seedLength` 用于重建；恢复服务 `ctx.agents.resume`；投影级 `ctx.sessionProjections — SessionProjection` 的 `checkpoint/restore/hydrate`（`session-projection.zh.md`） | **dsh 明显更完备。** 差别在承诺强度：dsh 的恢复有两条硬承诺——写入侧「遵守 append-only 与连续 seq 契约：首个事件的 `seq` **必须**等于存储的下一个 seq」（`persistence.zh.md` L297-299），恢复侧「完整的被中断末轮被保留并**持久地**关闭，只丢弃撕裂的最后一条记录」（L319-321）；WES 的 `restart_step` 语义上会重跑步骤，重跑的外部副作用要靠第 5 项兜住 |
| 5 | 工具副作用幂等 | `recordToolEffectOnce`，`effectKey = runId:stepKey:effectName:ordinal`；工作台对话当前只用一个固定 key `workbench_chat_answer:1` | **dsh 没有 effect 幂等登记表。** 我在 52 份子系统文档里逐一检索过 idempot*/去重/dedup，最接近的两处是：① `packages/guard/repeat-tool-reminder`（README.zh.md）——「建议性循环卫生 guard」，「只有精确重复——同一工具、同一参数且与属性顺序无关——才会被检测到」，默认 `thresholds: [3, 5, 8]`，且 L173 明写「合理的幂等轮询超过阈值后仍会收到提醒」，**提醒只是建议，绝非阻止**；② `session.zh.md` L558 的可选配套插件 `dsh-session/invariant`，它强制的是**结构关系**——「轮次与步骤编号、执行事件封闭，以及同一步骤内的工具调用／结果配对」 | **WES 已够用（且语义更强）。** dsh 防重复是**结构性**的（参数不可变、未派发的调用不进日志、`exclusive` 执行模式），不防「同一逻辑副作用被执行两次」。WES 的 `effectKey` 是**确定性去重**。风险在实现不在设计：工作台那个固定 key 会让多轮工具调用的副作用互相吞掉 |
| 6 | 事件流 | `HARNESS_RUN_EVENT_TYPES` 16 类，additive-only（只增不减）契约；SSE 逐字推送（text.delta / thought） | `session.zh.md · SessionEventMap` —— **事件流即存储**，同一份 `SessionEvent` 既是运行时流也是磁盘日志；UI 可见性由白名单决定：只有 `user/message \| assistant/message \| tool/result` 属于 `SurfaceEventType`，其余为 log-only；逐字输出是 `assistant/chunk`，且首块按 `(turn, step)` 记账（`session-telemetry.zh.md` L57：接收方按 `(session.id, event.seq)` 去重，seq 空洞属正常）；扩展方式是对 `TurnEndReasonMap` 等做 declaration merging | **dsh 明显更完备。** 两家都懂「事件只能增不能减」，但 dsh 多了一层**表面/内部分离**（哪些事件模型可见 = 哪些事件会进折叠消息），并且「Model-visible ⟺ logged」是同一条不变式。WES 的 16 类事件与 SSE 是两套东西（事件流 + 推送通道），dsh 是一份日志两用 |
| 7 | 会话持久化 | PostgreSQL `ai_sessions`，jsonb 存 messages/attachments/artifacts/pendingActions | `packages/session-persistence` · `ctx.sessions` + `SessionPersistence` 契约（`persistence.zh.md`）。append-only 事件日志，可插拔后端 `dsh-session-persistence-jsonl`（Zstandard 帧 + 校验和，崩溃安全原子写）/ SQLite；所有后端须通过 `runPersistenceContract` 一致性契约；`SessionHeader.version` 不匹配 → **拒绝加载，不自动迁移**（L54「A persistence backend rejects any other version on load」；L94 版本过旧时「说明本构建没有升级路径」，升级器链被明确推迟建设）；`dispose()` 同步且幂等；load 时补齐完整的中断尾部而不重写已提交事件 | **dsh 明显更完备**（就「harness 需要的可回溯性」而言）。WES 的 jsonb 是**整体快照**：改一条历史消息 = 覆写整个数组，无法回放、无法审计「谁在第几步看到了什么」。dsh 是因果日志。但**WES 选 PostgreSQL 的方向是对的**，dsh 的 JSONL 反而不满足 WES 的多实例需求 |
| 8 | 待确认动作 | 正则识别写意图（`services/ai/handlers/write-action.handler.ts` 匹配「创建/新建/设立 X 项目」）→ 返回待确认动作 → 前端 `ActionConfirmer` 渲染，**模型不参与决策** | 三层不重叠：① `tools.zh.md · PreToolDecision`，其中 `'ask'` 是流水线上的决策槽；② `approval.zh.md · ctx.approval — ApprovalPolicy / ApprovalOutcome`，**fail-closed**（拿不到批准即拒绝），`ApprovalRequest` **刻意不含参数**，UI 靠 `callId` 绑定；③ `permission-presets.zh.md · ctx.permissionPresets` —— 预设本身**不实施任何强制**，只产出策略；④ 需要问用户时用 `user-questions.zh.md · ctx.userQuestions` | **dsh 明显更完备。** 关键差别：dsh 的确认是**在工具即将执行的那一刻、在执行流水线内部**发生的，模型知道发生了拦截；WES 是在模型之外用正则抢先判断，模型完全不知道自己的输出被拦了。附带一条硬约束：dsh 的 `approval.request()` 要求**有打开的轮次**——WES 那种「对话结束后还能回头确认」的模式在 dsh 里不成立 |
| 9 | 对话内结构化渲染 | formBlock（`InteractiveFormCard`）与 artifacts 两条既有通道 | `tools.zh.md`：一个工具的返回值只有**一份权威 canonical JSON value**，呈现全部是它的纯函数派生，且分三层强制隔离——① **模型可见内容**：`ToolOutputDefinition.output.render(args, value): ContentBlock[]`（L19）**必填**，注释原文「Pure projection from validated arguments and value to Native/model content」；② **UI 渲染意图**：`presentCall?(args): ToolCallView`（L84）与 `presentResult?(args, result): ToolResultView`（L92）**可选**，返回的是 **`card` 标签的可辨识联合**（L461）：`generic` / `terminal` / `diff` / `search` / `read` / `web` 六种卡片，配共享文件词汇 `FileLocation{path,line?}`、`FileDiff{path,oldText,newText}`、`ReadFileLine{number,text}` 与图标用途的 `ToolCallKind`（L466），**提供方无关**，由 UI 桥接层分发；③ **可重放的呈现元数据**：`presentationMeta?(args, value): JsonValue`（L21，仅对顶层调用计算）。决定性约束在 L11：`output`/`presentCall`/`presentResult`/`finalizeContent` **绝不能泄漏到模型请求**——「给模型看的」与「给人看的」是两条被允许列表强制分开的通道。TUI 侧另有 `slots.zh.md · ctx.slots`（`SlotMap` 编译期注册表 + declaration merging，基数 `single\|list\|keyed\|chain`，且「组件绝不会收到 `ctx`」）与 `conversation.zh.md · ConversationNodeDefinition` | **dsh 明显更完备**（框架层），但**不是同一件事**。dsh 给的是「一份权威结果 + 两份互不泄漏的投影」这个通用机制；WES 的 formBlock/artifacts 是**业务表单与业务产物**，含字段校验、RBAC、版本引用完整性，这层业务语义 dsh 一行都没有也不需要。**对 WES 的直接结论**：formBlock/artifacts 在概念上属于②「仅 UI 的渲染意图」侧，**不该作为文本混进模型可见的对话内容**；反之若某个表单填写结果需要回灌模型，必须显式走①的 render 通道而不是靠前端字符串拼接——WES 目前两条通道都没有这层区分，这是 formBlock 与 artifacts 后续演进的先决问题 |

### 表格之外必须单列的一条

**WES 工作台不传 tools**（`buildWorkbenchChatModelChat` 只传 model/temperature/messages）。这不是「实现得差一点」的问题，而是**在 dsh 里不可能出现的状态**：`system-prompt.zh.md · ToolProviderResult{schemas, knownNames?}` 把工具 schema 纳入 system prompt 组装，`EpochHeader.tools`（`session.zh.md`）把当次请求的工具集写进请求头快照，使每次请求都是日志的纯函数。dsh 用 `knownNames` 专门区分「配置名拼写错误」和「有意隐藏工具」——即「模型看不到某个工具」在 dsh 里是一个**需要被解释的状态**，在 WES 里是默认状态。

---

## 1.5 附：dsh 的 Cordis 范式与 WES modules 三层的对应关系

读者拿到上面的表一定会问：dsh 那套「一切皆插件」怎么落到 WES 的 `modules/<域>/{controller,usecase,repository}` 上。先把能对的和对不上的分清楚，否则 §四 的三条路都没法估。

| dsh 侧概念 | 出处 | WES 侧最近的东西 | 对不对得上 |
|---|---|---|---|
| Service Definition（`ctx.<key> — <ServiceType>`，一个 context 内**每个键只有一个实现**） | `docs/architecture.zh.md`、各子系统页首行 | `modules/<域>/<域>.module` 单例导出 | **对得上**，且 WES 现有约定已经是「一个域一个 module」。差异只在 dsh 由容器强制唯一，WES 靠 import 纪律 |
| Provider（`register()` 返回 effect disposer，即注销函数） | 各子系统 `dsh-*-{...}` 命名段 | `modules/*` 的装配代码 | **部分对得上**。dsh 的 disposer 是一条硬约定：注册必须能撤销。WES 的 module 是进程生命周期单例，**没有撤销语义**，§四 C 引入流水线挂点时必须自己定这条 |
| Consumer（消费方只认 ServiceType，不认实现） | 同上 | usecase 依赖 repository 接口 | **对得上**，AGENTS.md §2「Repository 边界」（业务层不可直接依赖 JSON 文件结构）本质就是同一条纪律，只是 WES 是文档约定、dsh 是容器保证 |
| Waterfall 事件（`namespace/verb`，`@mode waterfall \| emit`，**waterfall 必须调用 `next()`**） | `docs/architecture.zh.md` + 各子系统 | 无 | **对不上**。WES 的 `HARNESS_RUN_EVENT_TYPES` 是 emit-only 的**事实记录**，不是可改写的调用链。§三① 的 `preStep` 决策点、§三② 的 `PreToolDecision` 都要 waterfall 语义 —— 这是 WES 需要新建的一种机制，不是复用现有的 |
| Scope-filtered dispatch（`Scoped<Agent>`，按作用域路由） | `scope.zh.md` | 无 | **对不上**。WES 今天单会话单循环，不需要。多 run 并发时才需要 |
| Branded ID（`Branded<'XId'>`，如 `JobId = <kind>-N`、`WorkspaceId`、`SpillLocator`） | `jobs.zh.md` / `workspace.zh.md` / `spill.zh.md` | 无（WES 用 string id） | **对不上但成本极低** —— 纯类型层，见 §六第 1 条 |
| `…Map → derived-union` 声明合并（`TurnEndReasonMap`、`JobKindMap`） | `session.zh.md` / `jobs.zh.md` | 无（WES 的 16 类事件是固定枚举） | **对不上，且方向相反** —— 见下方专门说明 |

### 两处「看着像、其实相反」，必须先讲清

1. **事件扩展性：dsh 开放合并，WES 封闭枚举 —— 这是刻意的，不要往 dsh 靠。**
   dsh 靠 declaration merging 让任意插件往 `TurnEndReasonMap` 里加 reason（`session.zh.md`）；WES 的 16 类事件是 **additive-only 契约**（只增不减，且增要过架构裁决）。两者解决的是不同问题：dsh 解决「插件生态无法预先穷举」，WES 解决「已有消费方不能被改坏」。WES 是**单一自有消费方**的系统（前端就一个），开放合并只会把「谁加了个 reason，前端不认识」变成日常事故。**这一格是 WES 的契约更适合自己，不是差距。**

2. **`register()` 的 disposer：dsh 是卫生要求，WES 是安全要求。**
   WES 的 `recordToolEffectOnce`（§一第 5 项）+ run/attempt 的 `canceling`/`orphaned`（§一第 3 项）已经要求「一个 run 结束时要能撤干净」。dsh 文档里 disposer 出现在两个地方且都带语义：`persistence.zh.md` L145 明写 dispose **同步且幂等**；`subagent.zh.md` 的 `interrupt()` 定义为 `Agent.cancel(cause, { keepInbox: true })` —— 即**撤销要能精确选择保留什么**。WES 若引入流水线挂点，「注册进去的插件在 run 取消时怎么撤、撤到什么程度」必须先答这条，否则会复现 `orphaned` 那一类状态。

---

## 二、dsh 有而 WES 完全没有的能力

按对「harness + 垂直业务」的实际价值分三档。每条一句话说清它解决什么问题。

### 第一梯队：直接决定长会话能不能用

1. **compaction（上下文压缩）** — 解决「会话一长就爆 context window，且成本线性失控」。
   `ctx.compaction — CompactionEngine`（`compactIfNeeded/compactNow/compactRegion`），`CompactionTrigger = 'pressure' | 'context-overflow'`，`CompactionResult{compactionId, sourceCommandId?, startSeq, summarySeq, endSeq, summary, shadowedRange, shadowedSeqs, shadowedTokenCount}`，`ManualCompactionErrorCode = busy|cancelled|changed|summary|commit|persistence`。**设计上最值得抄的五点（均已实取原文核对）**：
   - **压缩是循环里的一个步骤，不是后台任务**：压力压缩跑在 `agent/pre-step` waterfall 中、**先于请求推导**（`compaction.zh.md` L86）—— 与 §三① 的决策点是同一个挂点，机制天然统一，不需要另起一套调度。
   - **先剪后压**：满足条件后先调 `ctx.toolResultPruner`（确定性剪枝），**再通过 `ctx.tokenMeter` 重测，并可以在不生成摘要的情况下推进 surface**（同页）。「不调模型也能瘦身」是首选路径，摘要调用是兜底。
   - **日志只加括号、表面单层替换**：`compaction/start|summary|end` 三者**全部 log-only，有意不扩展 `SurfaceEventType`**；真正的表面变化是**一条** `user/message` 带 `surfaceOp:{op:'replace',start,end}`，文档明写这是「摘要压缩执行的**唯一** surface 变更」（L11）。压缩从不改写历史。
   - **边界的取舍很克制**：区域边界**保持工具调用/结果配对，但不保持整个轮次**（L86），所以一个过大轮次里较早关闭的步骤也可以被压缩。配套导出 `toolPairingBalancedBefore(session, seq)` / `toolPairingBalancedAfter(session, seq)`，两者都验证当前 surface 成员关系并拒绝缺失的 seq 与遗留结果（L88）。一条易踩的坑也被点明：`shadowedRange` 是**位置跨度而非数值区间**（`start` 可能大于 `end`），权威集合是 `shadowedSeqs`（L45-54）。
   - **默认数值不可直接继承**：`thresholdRatio` 默认 `0.8`（在 `floor(routedContextWindow × ratio)` 处触发）、`retainRatio` 默认 `0.16`（与 `retainTokens` 互斥），支持按模型 `modelPolicies` 调优 —— 但 `packages/compaction/compaction-basic/README.zh.md` L254 自陈「**默认比例，尚未决定**……**没有基于语料的理想值指引记录**」。WES 落地必须自己实测校准，不能照抄这两个数。失败恢复走 `agent/request-error`，仅当 surface replacement generation 前进时才返回重试动作，取消始终优先（L86）。
2. **token-meter（预算计量）** — 解决「现在这个会话到底占了多少 token、还能不能再塞」这个问题今天无人能答。
   `ctx.tokenMeter — TokenMeter.measure(session, requestHeader?: EpochHeader): TokenMeasurement`（`token-meter.zh.md`），`TokenMeasurement{logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes}`，`baseline.kind = 'usage' | 'estimated'`（有真实 usage 用真实的，没有才估），按 `ctx.llm` 路由到的 provider/model 分别计价，单次调用 O(surface)，返回深不可变快照。WES 连「估算」都没有。
3. **spill（大结果外置）** — 解决「一次工具返回 2MB JSON 直接把上下文吃掉」。
   `ctx.spillStore — SpillStore.saveText(SaveTextSpill): Promise<SpillRef>`，`SpillRef{locator: Branded<'SpillLocator'>, bytes, retrievalHint}`；消费方 `dsh-spill-policy` 挂在 `tools/post-execute`，`maxInlineBytes` 默认关闭。**取舍很干净**：只改**模型可见副本**，规范结果不变；保存失败时保留原始内联结果而不把成功变成 `isError`（尽力而为，不新增失败模式）。本地后端用 `sha256(sessionId)` 子目录 + `open(path,'wx',0o600)`。
4. **skills（技能发现与注入）** — 解决「过程性知识只能写死在 system prompt，改一次发一次版」。
   `ctx.skills — SkillProvider{name,list,get}`（`skills.zh.md`），`SkillSummary{name,description,whenToUse?,invocation,source,provider,resourceBase?}`，`SkillCandidate extends SkillSummary{rank,locator,path?,metadata?}`，`SkillInvocationPolicy{modelInvocable,userInvocable}`，`SkillCatalogSnapshot{skills,complete}`，秩表 100 `project-dsh`(`<projectRoot>/.dsh/skills`) → 200 `project-agents` → 300 `custom` → 400 `user-dsh` → 500 `user-agents` → 600 `bundled`。kebab-case 约束 + `<name>/SKILL.md`，且**登记表不缓存完整定义**（只留目录，按需取正文）。对 WES 价值直接：`skills/wes-tdd`、`wes-code-review`、`maintain-wes-command-board` 这些今天靠 AGENTS.md 口头约定「必须先读」，没有任何机制保证模型真读了。
5. **session-projection（投影与恢复）** — 解决「任何派生状态（UI 状态、统计、索引）崩了之后怎么重建」。
   `ctx.sessionProjections`，`checkpoint/restore/hydrate`（`session-projection.zh.md`）。核心思路：派生态一律从日志折叠出来，可丢弃可重建，不进权威存储。WES 目前是 jsonb 里混存消息与派生字段，改一处要手工对齐。

### 第二梯队：决定这套 harness 能不能承接「多角色 + 治理」

6. **scope（作用域隔离）** — 解决「多 Agent/多会话共存时，插件注册会不会互相串台」。
   `packages/core/scope` 是**库原语而非服务**（无 ctx 键）；`ScopeKey = object` 按**身份**比较（活的 `Agent` 本身就是循环的作用域键），`Scoped<T>` 是编译期 brand（`scopeTarget(base,key)`），`ScopedLayers<L>` 全局层急切装配 + 精确作用域层惰性装配，`merge()` 按插入序。价值：WES 未来要支持多个 run 并发、多租户，没有作用域原语就只能靠约定。
7. **invariants（不变式检查）** — 解决「插件之间的隐含约定（轮次编号、事件顺序、配对完整）坏了没人发现」。
   `dsh-invariants`（`packages/runtime-diagnostics/invariants`）· `ctx.invariants.register(packageName, installer)`，`Config{enabled?, package_allowlist?, package_blocklist?}`，`InvariantFailure = (message:string)=>never`。三条设计值得照搬：① 注册时**占用该 npm 包名**，两个插件永远无法静默声明同一个名字；② 每个 workspace 包都配一个 `./invariant` 伴生插件；③ 不变式**只断言事件流与可变数据关系，绝不断言某个服务/方法是否存在**。
8. **sandbox（执行隔离）** — 解决「模型驱动的 shell/文件写操作把宿主搞坏」。
   `SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`，`SandboxEnforcement = 'full' | 'partial'`，`SandboxExecutionPolicy{mode,workspaceRoot,sessionId?}`，`ctx.sandboxPolicy.resolve()` → `ConfinedArgv{argv,enforcement,denialSignatures,runnerFailureRules}`，`RunnerFailureRule{allowedExitCodes?,fatalSignatures,informationalLines?}`；后端 `dsh-sandbox-local`（bwrap/Landlock/Seatbelt/Windows ACL）。**一条铁律值得学**：「对于受限策略，静默的无隔离透传永远不合法」——沙箱不可用必须抛 `SandboxUnavailableError`/`SANDBOX_UNAVAILABLE`。注意边界：文档只覆盖**文件副作用**，网络与进程不在范围内。
9. **subagent（子代理）** — 解决「一个会话里塞不下的大任务怎么分解、分解后的结果怎么回到主线」。
   `ctx.subagents — SubagentService`（`subagent.zh.md`），6 个 provider（`spawn-in-process/fork-in-process/acp/codex/claude-code/dsh-sdk`），`SubagentCapabilities{agentOptions,outputSchema,depthLimit,toolFilter,persona}`，`SubagentStartRequest{label?,prompt:ContentBlock[],parent:Agent,signal,...}`，能力**先校验后 start**，缺则 `SubagentError('UNSUPPORTED_CAPABILITY')`（fail loud，绝不静默降级）；报告回投 `SubagentReportDelivery = 'quiet' | 'next-step'`（`reportFrom()` 用 `Agent.inject()` 或 `Agent.steer()`）；中断权 `SubagentInterruptAuthority` 只认直接父会话（记录在 `SessionHeader.parentSession`）。
10. **plan / goal / todo（工作模式与目标跟踪）** — 解决「agent 跑着跑着忘了要干什么、或者偷偷越权改文件」。
    - `ctx.planMode — PlanModeController.set/get(agent) → {active, pending?}`（`plan.zh.md`）：**plan mode 本身只是软引导**，真正的强制来自 sandbox + approval —— 这个「软引导 vs 硬强制」的分离是本轮读到最干净的一条架构判断。
    - `ctx.goals — GoalService`（`goal.zh.md`）：`GoalRef{id,revision}` 是 compare-and-set，`GoalPhase`、`GoalBlockReason{code,message}`、`GoalView{roundsStarted,createdAt,updatedAt,activation}`，durable 事件 `goal/change` 存的是**整个快照或墓碑**，`GoalMessageSource{kind:'goal',goalId,revision,round}` 且重放会拒绝过期/跳号/超量的轮次。
    - `@deepseek-ai/dsh-tool-todo`（`todo.zh.md`）：`TodoItem{content,status:'pending'|'in_progress'|'completed'}`，**没有 id 也没有优先级**，整表替换、后写覆盖，日志事件 `todo/write` 为 log-only，由伴生不变式在 append 前校验。

### 第三梯队：形状与 WES 差异较大，价值取决于业务形态

11. **schedule（会话内定时）** — 解决「到点自动再跑一轮」。`AfterScheduleRecord{kind:'after',afterSeconds}`、`AtScheduleRecord{kind:'at'}`、`EveryScheduleRecord{kind:'every',everySeconds}`（≥300s），`AtInput = string | LocalAtInput{date,time,time_zone}` 归一化为 RFC 3339 UTC，无 Cron/日历规则，`schedule/change` 是唯一 durable 权威；fork 只从 `SessionHeader.seedLength` 起折叠；投递必须等会话**完全 idle** 再 `followup()`，「绝不会调用 `steer()`」；L186 明写是尽力而为的**「至少一次」交付，而非恰好一次**。
12. **jobs（后台作业）** — 解决「跑一个 5 分钟的命令不该阻塞对话」。`JobId` branded `<kind>-N`，「访问控制依赖拥有者授权，而非 id 的保密性」；`JobKindMap{bash,subagent}` 可合并扩展；`JobStart{kind,label,outputLimitBytes?,owner?:Agent,run():JobHooks}` —— 注释点明「**生产方拥有执行资源；运行时拥有身份、访问权限和生命周期状态**」；`JobHooks{cancel(reason?) 同步幂等, done: Promise<JobOutcome> 在资源释放后才 resolve, readOutput?()}`；`JobSnapshot.reported` 抑制重复完成通知。
13. **workflow（脚本编排）** — 解决「固定 DAG 不该反复消耗模型轮次」。`ctx.workflowEngine — WorkflowEngine`（`workflow.zh.md`），provider `dsh-workflow-worker-thread`（工作线程，不阻塞主循环）；`WorkflowStartRequest{script,meta,args?,subagentProvider?,maxTotalAgents?,parent:Agent,signal?}`，meta/args 是**经 schema 校验的纯 JSON，绝不通过对脚本文本求值**；`WorkflowMeta{name,description,whenToUse?,phases?}`，**phases 只用于展示，不暗示任何执行结构**；`WorkflowResult{value,stopReason:'completed'|'cancelled'|'error',error?,agentsStarted}`；`WorkflowRun{...,result /*绝不 reject*/,cancel,dispose}` 有宽限期强制结算的界。
    → 与 WES 的关系：WES 的 run/attempt 状态机在**跨实例可恢复**这一维度上比 dsh 的 workflow 更强（dsh 没有租约/orphan 概念），但在**隔离执行**这一维度上 dsh 更强（worker thread）。
14. **slots（UI 插槽系统）** — 解决「插件想改界面但拿不到 React，也不想依赖界面代码的隐式约定」。`ctx.slots.register()/inject(key,callback)`，`SlotMap` 编译期注册表 + declaration merging，基数 `single|list|keyed|chain`，作用域 `root|session-maybe|session`，props 面孔 `PropsRuntime<K>/PropsRenderSlots<S>/PropsStore<H>/InjectFace<I>/PropsLocale<N>/ComposedProps`；「组件绝不会收到 `ctx`」。
15. **agent-team（多代理团队，实验特性）** — 解决「一队 agent 分工、任务板、互相寄信」。隐式 Root Team，`TeamId` = Root 的 `SessionId`，`ctx.agentTeams — TeamService` 以活的 Lead Session 日志为底座；`spawnTeammate/sendMessage/createTask…updateTask/waitForChange/membership/tryMembership`，`TeamTaskSnapshot{revision(CAS),blockedBy,writeScopes}`，且明写 writeScopes 是「**提示性路径前缀，不是锁**」；`foldTeam()` 从日志重建名册/任务板/信箱。
    → WES 现在完全没有这一层，但也没有对应需求；列为「知道有」。
16. **extensions / 运行时自改插件树** — 解决「不重启、不发版，给运行中的 harness 加能力」。`ctx.dynamicCordisRunner — DynamicCordisRunnerService`（`define/undefine/run/stop/snapshot/inventory`）+ `ctx.cordisInspect` + `ctx.inspector`，4 个包（`tool-cordis/cordis-host-runner/cordis-client-runner/ui-cordis`）；定义**只存在于进程内存，重启即清空**。`docs/architecture.zh.md` L11「产品的每一部分都是插件……**包括 agent loop 本身**」、L13「不存在需要打补丁的特权内核」、L17 运行中的 dsh 是一棵插件树。
17. **其余零散但有用的**：`hooks`（**仅命令路径**，`exit 2` 阻断并把 stderr 作为原因回呈，合并规则 `deny > ask > allow`，`hook/invoked`/`hook/result` 为 log-only 成对事件，`UserPromptSubmit`/`Stop` 忽略 matcher）；MCP 桥**只桥接 Tool**，稳定名 `mcp__<server>__<tool>`；webhook 分发是 `dispatch` 后立即 `202`，文档自陈「**无队列、重试、去重、崩溃重放**」（这条对 WES 是反面教材，也说明 dsh 的交付保证并不比 WES 高）；settings 分层（default → composition `base` → user doc，CAS revision，**密钥字段只返回 `{path,set}`**）；storage `defineDomain` + `KvTable.update()` 原子 RMW + `'domain/changed'` 事件；credentials 用 `CredentialRef` **值与索引分离**、4 层、跨进程 `modifyRecord` 锁；session-query `SessionQueryEngine`；附件内容寻址 `sha256:<digest>` + 整批先校验后写；web-client `follow()` 先基线后增量、重连时原子替换。

---

## 三、WES 四个待定架构决定，dsh 是怎么解的

### ① 阻塞循环怎么变成可恢复步骤

**dsh 的答案：把循环从「一个跑到底的函数」改成「每次进入步骤前都有一个可改写决策点的状态机」，并把恢复点定义成日志位置而不是快照。**

四处机制合起来构成答案：

1. **步骤前有决策槽**：`agent/pre-step` 是 waterfall 事件，返回 `PreStepDecision`（`core.zh.md`）。WES 要加的「这一步该不该跑、要不要改参数、要不要问用户」在这里是框架内建位，不是往循环体里插 if。
2. **每次请求都是日志的纯函数**：`request/header` 携带 `EpochHeader`（含 `tools`、preset 等），使「第 N 次请求看到了什么」可确定复现（`session.zh.md`）。这是可恢复的地基 —— 恢复不是保存 JS 栈，而是**重放日志到某个 seq 再折叠**。
3. **轮次收口与中断合成**：`turn/end{reason}`，`TurnEndReasonMap` 可合并扩展；崩溃留下的半轮由持久化后端补一个合成的 `turn/end { kind:'interrupted' }`（`persistence.zh.md` L15），且 `interrupted` 是唯一永不由循环发出的 reason（`session.zh.md` L545-548）—— 这样「被中断」和「正常结束」在日志里永不混淆。配对完整性由可选的 `dsh-session/invariant` 强制：轮次与步骤编号、执行事件封闭、同一步骤内的工具调用／结果配对（`session.zh.md` L558）。
4. **外部指令有三个目标层级**：`Agent.steer()/inject()/cancel()` 与 `InboxTarget = 'next-turn' | 'next-step'`（`core.zh.md`）。WES 的 `resume_next` 对应 `next-step`，`restart_step` 在 dsh 里**没有对应物**（日志不可变，dsh 靠「不派发即不入日志」而非「重跑」）。

**对 WES 的可执行结论**：WES 不需要把 `runAgent` 改成事件溯源（那是 §四 B/C 的决策）。最小改造是**在 for 循环体内插一个 `preStep(decision) → 'allow'|'modify'|'skip'|'ask'|'stop'` 的 waterfall 挂点**，并把 attempt 的 `checkpoint` 从「业务快照」升级为「日志 seq + 会话 id」，恢复时按 seq 重放。这一步不需要引入 Cordis。

### ② 写操作确认流怎么设计

**dsh 的答案：确认不是一个功能，而是工具执行流水线上的一个决策槽，配合三层互不越权的强制/引导/预设。**

1. **拦截点在流水线里**：`tools/post-…` 之前的 `PreToolDecision`，取值含 `'ask'`（`tools.zh.md`）。这意味着确认发生在**参数已定、副作用未发**的那一瞬，且模型能观察到被拦。
2. **批准本身是独立策略层**：`ctx.approval — ApprovalPolicy` 产出 `ApprovalOutcome`，**fail-closed**（拿不到批准即拒绝，`approval.zh.md`）。关键设计：`ApprovalRequest` **刻意不包含工具参数**，UI 靠 `callId` 自己去绑定并展示 —— 这样「用户批准的是他在界面上看到的那一次调用的那个参数」成为一条可验证的因果链，而不是靠把参数塞进批准请求来「示意」。
3. **预设不实施强制**：`ctx.permissionPresets`（`permission-presets.zh.md`）只产出策略，本身不拦任何东西。这是防止「以为配了权限预设就安全了」这类误解的架构级切割。
4. **要问用户而不是问系统时用另一条通道**：`ctx.userQuestions`（`user-questions.zh.md`）。
5. **硬约束**：`approval.request()` **要求有一个打开的轮次**。

**对 WES 的可执行结论**：WES 的正则识别（`write-action.handler.ts` 匹配「创建/新建/设立 X 项目」）在 dsh 的坐标系里属于「在模型之外、在执行之前、且不告诉模型」。要走向 dsh 形态，路径是：把「这是不是写操作」从**自然语言判断**改为**工具元数据判断**（复用已有的 `mutates: true` 标记），把决策槽放在工具执行前的流水线上。这条改动的**前提是 §一末条 —— 工作台先要能把 tools 传出去**，否则没有执行流水线可言。另需注意 WES 有「对话结束后前端仍可点 ActionConfirmer 确认」的既有行为，与 dsh 的「必须有打开轮次」冲突，迁移时这是要显式裁决的点，不是照搬。

### ③ 规则驱动 vs 模型驱动的意图识别怎么过渡

**dsh 的答案：这条轴在 dsh 里不存在 —— 未在文档中找到任何基于规则匹配用户意图的层。**

dsh 的真实切分是**「谁发起」**，不是「谁更聪明」：

- **人发起 → commands**：`ctx.commands` 按**小写斜杠名精确匹配**解析，输入是宿主产生的结构化对象（如 `SessionReferenceInput{sessionId}`），**完全绕过模型**。
- **模型发起 → tools**：全部经 `ctx.tools`，没有任何正则前置。
- **正则**在 52 份文档里只出现在四类无关场景：字面文本搜索（存取的原文检索）、包名 allowlist、标识符语法（如 skills 的 kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`）。
- 有 hook 但不是意图路由：`hooks` 的 matcher 针对的是**工具名 / 会话来源**，不是用户话语内容；且 hooks 只挂在命令路径上。

**这对 WES 意味着什么（本条是四种决定里唯一「dsh 没解」的）**：WES 有 18 个正则 handler 在 `services/ai/handlers/`，它们的存在前提是「模型看不到工具」——正则替模型做了意图识别。所以过渡不是「规则 vs 模型谁更强」的选型，而是一个**先补结构、再撤规则**的顺序问题：

1. 先让工作台把 tools 传给模型（否则任何比较都不成立）；
2. 把 18 个 handler 中**输入是结构化可控**的那部分降格为 dsh 意义上的 commands（显式指令，不走模型）；
3. 把 18 个 handler 中**需要理解自然语言**的那部分升格为 tools，让模型来选；
4. 判断标准照 dsh 的样子用：**发起人是谁**（用户点按钮/输命令 vs 用户说一句话）。

参考坐标：`plan.zh.md` 展示的同一条原则 —— **软引导（模型被建议做什么）与硬强制（sandbox/approval）必须是两个不同的旋钮，不能混为一谈**。WES 的正则 handler 今天同时扮演这两个角色，这是它最难维护的地方。

### ④ 多轮工具调用的幂等怎么保证

**dsh 的答案：没有 effect 幂等登记表（未在文档中找到）。dsh 从三个结构层面让重复变难，然后在语义上诚实承认「至少一次」。**

1. **参数不可变 + 未派发不进日志**：`session.zh.md` L64 的 `assistant/message` 上「**undispatched tool calls are absent**」—— 没真正派发的调用不会污染日志，因此重放不会二次派发。
2. **callId 是关联键，不是去重键**：`approval.zh.md` 里 UI 靠 `callId` 绑定请求与批准，用于建立因果链；没有任何地方按 callId 抑制执行。
3. **执行模式防交叉**：`ToolExecutionMode` 支持 `exclusive`，把「同时跑两个会互相踩」的工具串行化。
4. **配对完整性**：可选的 `dsh-session/invariant` 强制同一步骤内 call/result 配对（`session.zh.md` L558）—— 保证不会出现「有调用没结果」这种重放时最危险的状态。
5. **诚实承认至少一次**：`schedule.zh.md` L186 —— 尽力而为的「至少一次」交付，而非恰好一次。`webhook` 文档同样自陈无队列/重试/去重/崩溃重放。
6. **唯一接近的东西是建议性的**：`packages/guard/repeat-tool-reminder` —— 精确重复（同工具同参数，属性顺序无关）超阈值（默认 `[3,5,8]`）才**提醒**，「提醒只是建议，绝非阻止」，新用户消息清零计数，且 L173 明确「合理的幂等轮询超过阈值后仍会收到提醒」。

**判定：这一格 WES 已够用，而且设计意图更强。** WES 的 `recordToolEffectOnce` + `effectKey = runId:stepKey:effectName:ordinal` 是**确定性去重**，跨重放成立，dsh 做不到。

**但有两个 WES 侧的具体缺陷要记进风险（与设计无关，是实现）：**
- `effectKey` 里**没有 callId/请求身份**。一次步骤内如果模型合理地把同一工具调两次，`ordinal` 会区分开；但跨 attempt 重放时若 ordinal 序列被打乱，去重会失效或误杀。建议把 key 扩为 `runId:stepKey:effectName:callId:ordinal`，让 key 与被重放的那次调用的**身份**绑定，而不是与它的**顺序**绑定。
- 工作台对话目前**只有一个固定 key `workbench_chat_answer:1`**。这意味着多轮工具调用的副作用会互相吞掉（第二轮被判定为「已执行」）。这是当前最紧的幂等 bug，比任何迁移决策都优先。

---

## 四、迁移可行性初判

前提事实（如实反映，不淡化）：
- dsh 是 **TypeScript + MIT**（`README.zh.md` L82），与 WES 技术栈同源，授权上无障碍。
- **但它是开发者预览**：`README.zh.md` L13 原文「DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**」当前版本 0.3.3。
- 破坏性变更会落到数据上：`persistence.zh.md` 中 `SessionHeader.version` 不匹配时**拒绝加载，不做自动迁移** —— 等于每一次上游升级，WES 都要自己写一次会话数据迁移，且迁移窗口内旧数据不可读。
- 架构范式是全插件化 Cordis（`docs/architecture.zh.md` L11/L13/L17）：agent loop 本身也是插件，没有特权内核。收益是所有东西都可换；代价是**没有「最小侵入」这条路**，接入即全盘接受 Cordis 的心智模型。

### A. 全量迁到 dsh（WES 变成 dsh 的一组插件）

**要动什么**
- 把 `apps/api/src/agent/*`（1476 行，含 orchestrator、default-registry、5 个工具文件）整体重写为 Cordis 插件；工具改成 `ToolDefinition`（含强制 `output.render()`），挂到 `ctx.tools`。
- 会话存储从 jsonb 快照改为 append-only 事件日志：要么实现一个 PostgreSQL 的 `SessionPersistence` 后端并**通过 `runPersistenceContract`**（这是最省事的一步，因为 WES 已经决定用 PG，且 PG 后端本来就是 dsh 缺的那块），要么把 `ai_sessions` 数据整体转换成 `SessionEvent` 序列。
- 待确认动作改为流水线决策槽（`PreToolDecision:'ask'` + `ctx.approval`），并**改掉「无打开轮次也可确认」的既有行为**。
- 18 个正则 handler 按 §三③ 拆成 commands + tools。
- 前端 SSE 改为对日志折叠的订阅（可参考 `web-client.zh.md` 的 `follow()`：先基线后增量、重连时原子替换）。

**风险**
- 上游节奏不受 WES 控制：preview 期破坏性变更 + version 拒绝加载 = **每次升级都是一次数据迁移项目**。
- Cordis 的心智成本（Service Definition / Provider / Consumer、waterfall 必调 `next()`、`Scoped<T>` 编译期 brand、`…Map → derived-union` 声明合并）需要整个团队消化，WES 现有的「模块 + 三层（controller/usecase/repository）」范式不能沿用。
- 授权模型冲突：dsh 的批准必须有打开的轮次，WES 的 ActionConfirmer 是异步、可离线、可跨会话的。
- dsh 的 `run` 概念不存在，WES 的 run/attempt + `claimed/orphaned` 跨实例租约语义无处安放，得自己以插件形式重做。

**会浪费的 WES 资产**
- `modules/harness` 整套 run/attempt 状态机与 checkpoint/resume policies（dsh 无对应层，需原样重写为插件）。
- 16 类事件的 **additive-only 契约**（这是 WES 自己踩坑换来的治理成果，换成 `SessionEventMap` 后由 declaration merging 接管，契约本身作废）。
- `recordToolEffectOnce` 幂等登记表 —— dsh **没有等价物**，迁过去要自己实现，等于把 §一第 5 项的领先资产重新发明一遍。
- formBlock/artifacts 两条业务渲染通道（需重写为 `output.render()` + slots）。
- `ai_sessions` 历史数据（快照 → 事件日志的转换是有损的，因为快照里没有因果信息）。
- orchestrator 那 114 行虽然薄，但它和 maxTurns、discovery 模式的组合是已验证可用的；全量迁是把已验证代码换成未验证代码。

**结论**：不建议。在 preview 期把地基换成别人正在改的内核，且 WES 最强的三块资产（跨实例 run/attempt、幂等登记表、事件契约治理）在 A 路线上全都要重建，是**用最高成本去换别人还没做完的事**。

### B. 只借鉴设计，继续自研

**要动什么**
- 代码零依赖 dsh。按 §二梯队逐项自建，按 §三的四条做定点改造。
- 优先落地的四件（价值/成本比最高的顺序）：
  1. 工作台传 tools（结构缺口，一行参数级别，且不做它后面三条都无从谈起）；
  2. `preStep` 决策点（§三①）；
  3. 把写意图从正则迁移到工具执行前的决策槽（§三②，复用已有 `mutates` 标记）；
  4. compaction + token-meter 的最小版本（§二 T1 的 1、2 项，WES 只有 PG 里的 jsonb，没有预算观）。

**风险**
- **只借词不借骨**：把 dsh 的名词（surface、projection、epoch、invariant）抄进 WES 文档，但底层机制不对齐，最后得到一套看起来先进、跑起来还是老样子的词汇表。这是 B 路线唯一但很常见的失效方式。
- 无上游回归套件：dsh 的 `runPersistenceContract`、`./invariant` 伴生插件这类「用契约测试兜住行为」的东西，B 路线要自己建，否则第 4 项 compaction 会退化成「手工摘要 + 拼字符串」。
- 上游仍在快速演进，B 路线每次回头看都要重读一遍文档（本次 52 份的阅读成本会重复发生）。

**会浪费的 WES 资产**
- 几乎不浪费 —— 这是 B 路线的主要卖点。

**结论**：可行的保守选项。适合 WES 还没有专职 harness 团队的情况。

### C. 局部替换（推荐）

**换哪几块**
1. **历史表示**（最该换）：把 `ai_sessions.messages` 的 jsonb 快照换成 append-only 事件序列，PG 表 + `seq` 单调 + 表面事件白名单（对齐 dsh 的 `SurfaceEventType`：只有 `user/message | assistant/message | tool/result` 进模型可见折叠）。理由：这一条同时解锁 §三①（恢复 = 从 seq 重放）、§二 5（projection 可重建）、§二 1（compaction 用 `surfaceOp` 替换段而不改写历史）三件事 —— **是所有下游改动的公因子**。
2. **工具执行流水线**：照 dsh 的阶段序列实现固定管线 `pre-execute → guard → execute → post-execute → finalizeContent → result`，决策槽返回 `PreToolDecision`。理由：这是 §三②③④三条决定的共同落点，没有流水线，确认流、幂等、意图路由都只能继续用旁路。
3. **上下文预算管理**：引入 `token-meter`（含 `baseline.kind` 的 usage/estimated 二分）+ **先剪后压**（dsh 的 `ctx.toolResultPruner` 是确定性剪枝，剪够了可以完全跳过摘要）+ compaction 的「日志只加括号、表面单层替换」模型。理由：纯增益，不碰业务，且能立刻缓解长会话成本。

**留哪几块**
- **run/attempt 状态机 + `claimed/orphaned` 跨实例租约** —— dsh 完全没有这一层，这是 WES 的多实例价值所在。
- **`recordToolEffectOnce` 幂等登记表** —— §三④ 已判定 WES 强于 dsh，只需补 callId。
- **16 类事件的 additive-only 契约** —— WES 自己的治理资产，保留；可与新的事件日志并存（run 事件域 ≠ 会话事件域）。
- **formBlock / artifacts** —— 业务表单与产物，含校验/RBAC/版本引用完整性，dsh 不提供也不打算提供这一层。
- **SSE 逐字推送通道** —— 保留，只需把它改成订阅日志折叠的视图。

**风险**
- 会出现「WES 版的 dsh 概念」：事件日志、表面、投影、决策槽都得自己定义自己实现，**边界靠文档守**，而不是靠上游守。需要一条明确纪律 —— 每引入一个借来的概念，同时引入它的一条不变式测试（照 dsh 的 `./invariant` 伴生插件做法），否则就是 B 路线那个「只借词」的失效形态。
- 三块替换有先后依赖：1（历史表示）不做，2、3 都会别扭。
- 版本兼容：因为不 import dsh 任何代码，preview 期破坏性变更**不影响 WES 构建**，只影响 WES 的追赶成本。这是 C 相对 A 最实质的风险削减。

**会浪费的 WES 资产**
- 需要一次性数据迁移：`ai_sessions` 的 jsonb 快照 → 事件序列。这是**有损的**（快照没有因果信息，只能合成等价的 `turn/start/…/turn/end`，且合成出来的历史无法区分「当时真被中断过」与「没有」）。建议：新会话走事件日志，旧会话按只读归档保留在快照表里，不做双向统一。
- 现有 18 个正则 handler 中，被降格为 commands 的那部分需要一次交互改造（用户习惯变化）。

### 三条路的取舍（一句话）

A 用最高成本买一个别人还没做完的地基；B 零成本但每次都得回头重读；**C 用一次数据迁移，换来 dsh 唯一真正领先的那件东西（可回放的因果日志 + 建在它上面的决策槽），同时把 WES 已经领先的三件（跨实例租约、幂等登记表、事件契约治理）留在手里。**

---

## 五、未在文档中找到（不推测的清单）

- **dsh 的 "run" 概念**（对应 WES 的 run/attempt 状态机）：`jobs.zh.md` 只有后台作业（`JobStatus`），`workflow.zh.md` 只有引擎运行（`WorkflowRun`，进程内），均**无跨实例租约、无 claimed/orphaned 语义**。
- **effect 幂等登记表**：dsh 无等价物，只有建议性的 `dsh-repeat-tool-reminder`。
- **规则驱动的用户意图识别层**：dsh 无此层，切分轴是「谁发起」（commands vs tools）。
- **`ctx.schedule` 这个 ctx 键**：`schedule.zh.md` 里未出现该键名（其余子系统文档均给出了 ctx 键）。
- **多租户 / 权限隔离下的 workspace**：`workspace.zh.md` 明确是**多项目目录作用域**，非多租户，且对模型不可见（无工具、无 prompt 文本、无会话事件）。
- **dsh 对 RBAC（角色→能力）的实现**：dsh 的权限面是 `ToolRestriction` / `permissionPresets` / `approval`，未见「用户角色」维度与工具能力的映射层。WES 的 `capability` 标记（admin/user）在 dsh 里没有现成对应物。
- **`conversation.zh.md` 是 agent loop**：不是。它是客户端会话节点层（`ConversationNodeDefinition`、`ctx.uiConversation.events.register`）。§三① 的结论建立在 `core.zh.md` + `session.zh.md` + `persistence.zh.md` + `session-projection.zh.md` 四份文档上。

---

## 六、可低成本吸收的 dsh 契约约定（只借纪律，不借机制）

这十条不需要引入任何新组件、不改变 WES 架构，纯靠类型/命名/文档就能落地。§四 无论选 B 还是 C，这一节都该先做 —— 它把「只借词」的风险压到最低，因为每条都自带可验证判据。

| # | 约定 | dsh 出处 | WES 落地成本 |
|---|---|---|---|
| 1 | **Branded ID**：`Branded<'XId'>` 让 `RunId` 与 `SessionId` 在类型层不可互换 | `jobs.zh.md`（`JobId`）、`workspace.zh.md`（`WorkspaceId`，且**明写「绝不是路径」**，内部是生成的 uuid）、`spill.zh.md`（`SpillLocator`） | 半天。WES 的 `runId/stepKey/sessionId/messageId` 今天全是 string |
| 2 | **id 不是访问控制手段**：「访问控制依赖拥有者授权，而非 id 的保密性」 | `jobs.zh.md` · `JobId` 段 | 零代码。写进 AGENTS.md §3，并要求所有按 id 取资源的接口显式做拥有者校验 |
| 3 | **Model-visible ⟺ logged**（模型看到的东西必然在日志里，日志里的东西默认可见性需被显式分类） | `session.zh.md` · `SurfaceEventType` 白名单 | 低。WES 侧对应要求：任何进 messages 的内容必须能被回放出来；§二 T1-1 的 `surfaceOp` 是其强化版 |
| 4 | **fail loud，不静默降级**：能力缺失立即报错而非偷偷换一条路 | `subagent.zh.md` · `SubagentError('UNSUPPORTED_CAPABILITY')`；`sandbox.zh.md` ·「对于受限策略，静默的无隔离透传永远不合法」→ `SandboxUnavailableError`；`repeat-tool-reminder` ·「无效配置在启动时失败，绝不回退到默认值」 | 低但需要决心。WES 当前 discovery 模式（发现后补入注入集）与「找不到工具就静默少一个工具」之间只隔一层，要显式区分 |
| 5 | **「方法存在即为能力」**：可选能力用方法存在性判定，不用布尔位堆叠 | `subagent.zh.md` · `SubagentProvider.prepareContinuable`（文档明写这一句） | 零。WES 工具元数据（`mutates`/`capability`）今天的布尔位扩张可以按这个方向收敛 |
| 6 | **区分「配置名拼写错误」与「有意隐藏」** | `system-prompt.zh.md` · `ToolProviderResult.knownNames?` | 低。WES 注册表加一个 `knownNames` 集合 + 一条启动期检查即可，专治「工具名打错了但表现为模型没有该工具」 |
| 7 | **软引导与硬强制是两个旋钮，不可混用** | `plan.zh.md`（plan mode 只是引导，**sandbox + approval 才是强制**） | 零代码，但直接改写 §三③ 的 18 个 handler 归类标准 |
| 8 | **展示性元数据不得暗示执行结构** | `workflow.zh.md` · `WorkflowMeta.phases` ——「仅用于展示，**不暗示任何执行结构**」 | 零。WES 前端把阶段/步骤画成进度条时，进度条与后端真实状态机之间必须留此声明 |
| 9 | **凭据值与索引分离；密钥字段只返回 `{path, set}`** | `credentials.zh.md` · `CredentialRef`（4 层 + 跨进程 `modifyRecord` 锁）；`settings.zh.md` · 密钥字段只返回是否已设置 | 中。与 AGENTS.md §2 里已声明的凭据域 DB 迁移（加密落库 + 变更审计）是同一件事，dsh 给了可对照的形状 |
| 10 | **登记表不缓存完整定义**（只留目录，正文按需取） | `skills.zh.md` · SkillRegistry | 低。WES 未来把 `skills/*/SKILL.md` 机制化时必须遵守，否则 20+ 个 SKILL.md 全文进 prompt 会直接吃掉预算（与 §二 T1-3 spill 是同一问题的两面） |

**另外两条 dsh 用来自证机制有效的做法，属于「机制」而非「约定」，但值得单独立项评估**：

- **契约测试**：`runPersistenceContract` —— 所有持久化后端（JSONL / SQLite）跑同一套契约测试。WES 若要同时支持 jsonb 快照与事件日志两代存储，这是唯一能守住「两者语义等价」的东西。
- **伴生不变式插件**：每个 workspace 包配一个 `./invariant`，且 `invariants.zh.md` 划了硬边界 —— **不变式只断言事件流与可变数据关系，绝不断言某个服务/方法是否存在**。WES 现在没有任何形式的不变式测试。

---

## 七、落地顺序与验证门禁

下面是 §三、§四 的结论排成的有依赖顺序的批次。**每一批的「过线判据」必须是命令实取拿到的输出，不是报告里的自述**（架构侧工作方法）。

### 批次 0：结构缺口（阻塞其余全部批次）

| 项 | 内容 |
|---|---|
| 做什么 | 工作台把 tools 传给模型：`buildWorkbenchChatModelChat` 补齐 tools 参数；注册表的 5 个工具在工作台可见 |
| 为什么最先 | §三②③④ 全部依赖「存在一条工具执行流水线」这个前提；不传 tools 时，任何与 dsh 的对比都是拿不存在的东西比 |
| 过线判据 | ① 实取 `buildWorkbenchChatModelChat` 的请求构造处确实带 tools；② 用一条会命中工具的自然语言走工作台，落库的 session 消息里出现 tool 调用与结果；③ `npm run build:web` + `npm run build:api` 通过；④ `npm run test:modules` 通过 |
| 附带修复 | 工作台固定 `effectKey = workbench_chat_answer:1` 会让多轮副作用互相吞 —— 本批一起改（§三④ 已判定为当前最紧的幂等缺陷） |

### 批次 1：决策点（对应 §三①、§三②）

| 项 | 内容 |
|---|---|
| 做什么 | orchestrator for 循环内插 `preStep → 'allow'\|'modify'\|'skip'\|'ask'\|'stop'`；把写意图判定从正则迁到执行前决策槽，复用工具元数据 `mutates` |
| 依赖 | 批次 0 |
| 必须先答的问题 | run 取消时已注册挂点如何撤销（§1.5 第 2 点，disposer 语义）；WES「无打开轮次也能确认」的既有行为保留还是改掉（§三② 末尾，这条与 dsh 冲突，需用户裁决） |
| 过线判据 | ① 一条写工具的 `ask` 分支被拦下且模型**观察到**被拦（日志里能看到拦截，不是前端静默替换）；② 并发/重放下 attempt 状态机无新增非法态；③ 上述构建与测试脚本全绿；④ `skills/wes-security-review` 六步过一遍（本批触及鉴权边界与写操作） |

### 批次 2：历史表示（对应 §四 C 第 1 项）

| 项 | 内容 |
|---|---|
| 做什么 | 会话消息从 jsonb 快照改为 append-only 事件序列（PG 表 + 单调 `seq` + 表面事件白名单）；旧快照只读归档，不做双向统一 |
| 依赖 | 批次 1（否则新日志结构里放不进决策槽产生的事件） |
| 风险 | 一次性有损迁移（快照无因果信息，见 §四 C 风险栏） |
| 过线判据 | ① 迁移后任一会话可被重放到与旧快照**消息级**一致，且差异清单为空或有解释；② 中断注入测试：跑到一半 kill 进程，重启后补齐的中断轮次可区分于正常结束（对齐 dsh 的 `interrupted` reason 思路）；③ 步骤内 call/result 配对在重放后仍完整 |

### 批次 3：上下文预算（对应 §二 T1-1/2/3、§四 C 第 3 项）

| 项 | 内容 |
|---|---|
| 做什么 | token-meter（含 usage/estimated 二分）→ 确定性剪枝 → compaction（**先剪后压**，压缩只追加替换段不改写历史） |
| 依赖 | 批次 2（没有事件序列就没有 `surfaceOp` 式的「盖一层替换」，压缩会退化成手工摘要拼字符串） |
| 过线判据 | ① 一个长会话实测：压缩前后消息数/成本对比有数据；② 压缩不拆坏工具调用配对（dsh 的 `toolPairingBalancedBefore/After` 就是这条不变式）；③ 预算读数与真实 usage 的偏差被记录并可解释 |

### 批次 4：规则层退役（对应 §三③）

| 项 | 内容 |
|---|---|
| 做什么 | 18 个正则 handler 按「谁发起」二分：人发起 → commands（绕过模型）；需理解自然语言 → tools（模型选） |
| 依赖 | 批次 0、1（没有流水线就没有升格目标） |
| 过线判据 | ① 每条 handler 的归类结论都有出处与理由，逐条可查；② 降格为 command 的那部分有用户可感知的入口变化说明（这是交互改动，不是纯重构）；③ 退役的正则不留死代码（AGENTS.md §12 禁止无标注的历史路径残留） |

### 批次 5（可选，需独立决策）：skills 机制化 / subagent / sandbox

不在本次对比的建议范围内。三条的共同前提：批次 2 完成（否则没有可重放的会话底座），且 §六 第 10 条先落地（否则 skills 全文注入会立刻吃掉批次 3 换来的预算）。sandbox 对 WES 的实际价值最弱 —— WES 目前不让模型执行任意 shell，文件写操作走的是受控业务接口 + RBAC。

### 跨批次的一条纪律

每引入一个借自 dsh 的概念（事件序列、表面、投影、决策槽、压缩括号），**同批次必须引入它的一条不变式测试**。缺这条就是 §四 B 里点名的「只借词不借骨」失效形态，也是本对比唯一认为足以否掉一次交付的理由。

---

## 附录 A：取证方式与可追溯档位（读者按档取信）

**为什么要有这个附录。** 本文引用了 30 余份 dsh 文档，取证手段并不统一：一部分是架构侧本人用命令直接读原文并把行号回对过，一部分是委托子代理阅读后回报、本人只抽查了承重条目。把两者混在一份"读过清单"里，等于让读者无法判断哪条论断可以照用、哪条需要先复核。下面按档声明。

### 第 1 档：本人逐行读取，且每个行号都已回对到原文

行号即 iCloud 仓库内该文件的实际行号（`README.zh.md` 在仓库根，其余在 `docs/subsystems/`，包 README 在 `packages/`）。

| 文档 | 已回对的行级引用 |
|---|---|
| `README.zh.md` | L13 开发者预览与「未来将出现破坏兼容性的变更」；L82 MIT |
| `docs/architecture.zh.md` | L11 Cordis 与「产品的每一部分都是插件」；L13 不存在需要打补丁的特权内核；L17 运行中的 `dsh` 是一棵插件树 |
| `docs/subsystems/README.zh.md` | 52 份索引及各页归属 |
| `core.zh.md` | L59 Agent 是插件的编程面、循环外无组件依赖它 · L86 `cancel(cause, options)` · L118 `send(message, target, wakeup)` · L134 `steer` · L144 `inject`（排队不唤醒） · L156 `AgentStatus` · L181 `InboxTarget` · L184 收件箱算子与 `claim(target)` · L229 reject 不打开步骤 · L233 `PreStepDecision` · L250 `agent/pre-step` 是请求推导前唯一的 waterfall 链 |
| `tools.zh.md` | L11 显式允许列表 + `output`/`presentCall`/`presentResult`/`finalizeContent` 等绝不能泄漏到模型请求 · L19 `render` · L21 `presentationMeta` · L29 `output` 必需 · L52 `finalizeContent?` · L84 `presentCall?` · L92 `presentResult?` · L149 `defineTool` · L172 执行流水线 · L250 `exclusive` 排序屏障 · L385-388 `PreToolDecision` · L404 内容替换是展示策略而非保密策略 · L461-466 六种 `card` 与 `ToolCallKind`/`FileLocation`/`FileDiff`/`ReadFileLine` |
| `session.zh.md` | L64 `undispatched tool calls are absent` · L545-548 `interrupted` 是唯一不由循环发出的 reason · L558 可选 `dsh-session/invariant` 强制的三条关系 · L566 崩溃修复只关闭轮次／步骤／工具边界、从不处理 `compaction/*` · L637 创建或幂等领养 Session |
| `persistence.zh.md` | L15 后端不截断、改用合成 `turn/end{interrupted}` · L43 header 与事件日志分开存储 · L54-57 任何其他版本在 load 时被拒绝 · L94 `SessionFormatUnsupportedError` 与「本构建没有升级路径」 · L145 dispose 同步且幂等 · L233 共享 `runPersistenceContract` · L297-299 append-only 与连续 seq · L319-321 完整中断末轮保留并持久关闭，只丢弃撕裂的最后一条记录 |
| `compaction.zh.md` | L11 三个压缩事件 log-only + `surfaceOp:{op:'replace'}` 是唯一 surface 变更 · L45-54 `shadowedRange`／`shadowedSeqs` · L86 压力压缩在 `agent/pre-step` 内先于请求推导 + prune→re-measure 可不产摘要即可推进表面 · L88 `toolPairingBalancedBefore/After` |
| `packages/compaction/compaction-basic/README.zh.md` | L66 `thresholdRatio` 默认 0.8 · L67 `retainRatio` 默认 0.16 · L254「默认比例，尚未决定」与「没有基于语料的理想值指引记录」 |
| `session-telemetry.zh.md` | L57 每个 `(turn, step)` 只发首块、seq 缺口是常态、接收方按 `(session.id, event.seq)` 去重 |
| `approval.zh.md` | L11 品牌 id 配对 `approval/asked` 与 `approval/decided` · L41 链末端落到 fail-closed `'unavailable'` · L53 `ApprovalRequest` 有意省略工具参数、应答者靠 `callId` 绑定 · L130-132 没有打开的轮次即 throw |
| `permission-presets.zh.md` | L5 「不拥有任何强制执行」，切换只记录意图 · L11 默认预设表两项 · L44 配置错误在插件加载时抛出 · L48 `custom` 只是派生值、绝不是切换目标 |
| `schedule.zh.md` | L186 队列准入后、持久 dispatch 前的狭窄崩溃窗口可能重复 → 尽力而为的至少一次而非恰好一次 |
| `packages/guard/repeat-tool-reminder/README.zh.md` | 建议性 guard、只检测精确重复、`thresholds:[3,5,8]`、L173 合理的幂等轮询超阈值仍会收到提醒 |

### 第 2 档：读过整页，但文中引用未逐个回落到行号

`subagent` · `skills` · `jobs` · `workflow` · `system-prompt` · `invariants` · `scope` · `slots` · `sandbox` · `spill` · `token-meter` · `plan` · `goal` · `todo` · `agent-team` · `workspace` · `web-client` · `conversation` · `session-projection` · `user-questions`

这一档里的类型名与 `ctx` 键是真实读到的，但本文在引用它们时给的行号（若有）不一定精确到行。落地前若要据此改接口，按第 1 档方式复核一次。

### 第 3 档：委托子代理读取后回报、本人抽查

本文一部分背景来自三份带出处的子代理阅读报告（上下文预算方向、编线与编排方向、长尾子系统方向）。其中**承重结论我逐条抽查回原文**的有四条：guard 只建议不阻止、`session-telemetry` 的 `(session.id, event.seq)` 去重、`schedule` 的至少一次窗口、webhook 无队列/重试/去重/崩溃重放。**未抽查的部分**：§二 T2 / T3 里对 `sandbox`、`spill`、`plan`、`goal`、`todo`、`workspace`、`agent-team`、`web-client` 的「一句话说明它解决什么问题」——这些描述与出处文件名一致，但具体措辞可能沿用子代理的概括。

另需记一条失败取证：一份针对 `core` / `packages/core/*` 的子代理委托返回零可用内容（全程权限阻断，该报告明确拒绝编造类型名）。本文所有 `core.zh.md` 的类型名与行号均来自本人第 1 档实读，**没有采用该报告**。

### 否证类证据（检索而非阅读，结论强度不同）

- 对全部 52 份子系统文档 grep 幂等／去重／`dedup`／`idempot` 相关词 —— 未见 effect 幂等登记表。§一⑤ 与 §三④ 的「dsh 没有这个能力」由此支撑。
- 对全部 52 份 grep 规则／正则意图识别相关段落 —— 未见规则驱动的意图层，正则只出现在字面文本检索、包允许列表与标识符语法三处。§三③ 的「这不是一个问题」由此支撑。
- 对全部 52 份 grep 崩溃恢复与 call/result 配对 —— 命中集中在 `persistence.zh.md`（L15/L145/L233/L297-299/L319-321）与 `session.zh.md`（L545-548/L558/L566）。
- 检索只能支撑「文档层面没有声明过」，不能支撑「代码里不存在」。本文所有"未找到"均按 §五 的口径限定为**文档层面**。

### 采用受限

`packages/core/*` 下若干包内文档因权限阻断未取得可引用内容。包级 README 本文只精读了两份：`packages/compaction/compaction-basic`（压缩阈值与「默认比例尚未决定」）和 `packages/guard/repeat-tool-reminder`（建议性 guard）；`permission-presets` 的包 README 仅在子系统页内被链接，未单独打开，本文对它的引用全部来自 `docs/subsystems/permission-presets.zh.md`。

---

## 附录 B：本文对 WES 侧的既有事实引用（架构侧实取，未重新盘点）

- `apps/api/src/agent/orchestrator.ts` — 114 行，`runAgent(): Promise<string>`，maxTurns，discovery 模式
- `apps/api/src/agent/default-registry.ts` + `agent/tools/`（5 文件）— `capability` / `mutates` 标记
- `apps/api/src/modules/harness/harness-runtime.types.ts` — run/attempt 状态、checkpoint kinds、resume policies
- `recordToolEffectOnce` — `effectKey = runId:stepKey:effectName:ordinal`；工作台固定 key `workbench_chat_answer:1`
- `HARNESS_RUN_EVENT_TYPES` — 16 类，additive-only；SSE text.delta / thought
- `ai_sessions`（PostgreSQL, jsonb: messages/attachments/artifacts/pendingActions）
- `apps/api/src/services/ai/handlers/write-action.handler.ts` — 正则写意图；`ActionConfirmer` 前端渲染
- `apps/api/src/services/ai/handlers/workbench-shared.ts · buildWorkbenchChatModelChat` — **只传 model/temperature/messages，不传 tools**
- `services/ai/handlers/` — 18 个正则 handler

---

## 八、`packages/core` 源码级补充（2026-09-02 补读）

> **取证方式与前面七章不同**：本章全部来自源码逐行实取（`packages/core/*/src/*`、`packages/runtime-diagnostics/invariants/src/index.ts`），记法为 `文件:行 + 关键标识符`，行号即源文件行号。README 结论单独标为「README 声明」，不与源码混写。本章闭合附录 A「采用受限」里 `packages/core/*` 那一格。

### 8.0 四问速答

| 问题 | 一句话结论 | 决定性证据 |
|---|---|---|
| 8.1 loop 形状 | 异步**阶段状态机 + wake/latch 驱动**，不是阻塞计数器；且 core 里**完全没有轮次预算** | `agent.ts:38-46` `Phase`；五处 `src` grep `maxTurns` 零命中 |
| 8.2 工具执行与幂等 | 排他栅栏 + 有界滚动池，派发可重叠但提交按模型序；`callId` 即模型给的 block id；**无任何按调用的执行去重表** | `tool-calls.ts:145-160` `commitReady`；`repair.ts:104` "Do not retry blindly" |
| 8.3 invariant.ts | 每包一份的**运行时断言**（抛 `InvariantError`），按包名注册、正则允许/阻止列表开关 | `runtime-diagnostics/invariants/src/index.ts:15-22`、50-66 |
| 8.4 runtime-context / scope | `runtime-context` 是 **prompt 快照投影**，与 WES 的可信 `RuntimeContext` **不是同类物**；`scope` 是监听器路由 + 注册归属/拆除 | `agent.ts:240` `project(...)`；`dispatch.ts:1-7` fused dispatcher |

### 8.1 agent loop 的实际形状：阶段状态机 + wake/latch 驱动，且**根本没有轮次预算**

**不是阻塞 for 循环。** `agent-loop/src/agent.ts:38-46` 的 `Phase` 联合类型是三态机：`idle{lastTurn}` / `maintenance{abort,lastTurn,wakeRequested}` / `running{abort,turn,step,wakeRequested}`。唯一的 `while` 是 `agent.ts:219` `kick()` 内的 `while (await this.turn()) {}` —— 一个靠布尔收敛的循环，不带计数上界。

- **turn/step 是日志边界，不是变量。** `turn()` `agent.ts:253-337`：`const turn = phase.turn + 1`（260）→ `session.append('turn/start')`（262）→ 内层 `while(true)`（270）逐步执行 → `step/start`（286）→ `finally { session.append('step/end',{turn,step}) }`（298-300）→ `finally` 落 `turn/end {turn, reason: turnEnds!}`（323-330）。
- **"继续下一步"由五个判定点共同决定**，没有任何一个是计数器：① `step()` 在 `toolCalls.length === 0` 时 `return { kind:'completed' }`（429）；② max-tokens **粘性**合并 `if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd`（292-297）；③ `agent/pre-step` waterfall 否决权 `reject ⇒ turnEnds={kind:'blocked'}; return false`（241-247、274-277）；④ 一轮有结束原因且收件箱无 next-step 待办时先跑 `agent/turn-stopping` serial 挂点再 break（302-306）；⑤ 轮末 `if (!this.inbox.hasPending) return false`，否则换一个新的 `AbortController` 并把 `step` 归零后 `return true`（331-336）。另外工具可主动结束本轮：`agent.ts:434` `return concluded ? {kind:'completed'} : null`，来源是 `tools/src/index.ts:1814` `concludesTurn = this.concludingExecutions.has(exec)`（`concludingExecutions` 声明在 807）。
- **可挂起是真的可挂起。** `wakeDriver()` `agent.ts:179-200`：非 idle 时把唤醒**闩锁**为 `wakeRequested`（注释 181-183：maintenance 与被中止的驱动不能投递唤醒，只能在收敛时重放；`reason.kind === 'disposed'` 时**从不闩锁**，因此拆除不会等待任何模型轮）；idle 时用 `Promise.withResolvers` 立 `activityDone` 并起新阶段。`whenIdle()` 202-207 靠 `do/while` 链式等待收敛。`runMaintenance()` 149-169 提供非轮次工作（如压缩）占用同一阶段但对外 `status` 仍报 `idle`（107）。
- **取消是协作式的，状态落在日志里。** `cancel()` 141-147 先按 `keepInbox` 决定是否 `inbox.clear()`，再 `phase.abort.abort(cause)`；`signal.throwIfAborted()` 打在轮首（259）、每个 chunk（364 附近）与 `preStep`（234）。中止后现场留三份可重放残迹：`turn/end {kind:'aborted', reason: signal.reason as AgentCancelCause}`（310-312）、带 `interrupted: true` 且 `sourceEventSeqs: chunkSeqs` 的部分 assistant 消息（371-385）、以及未派发工具调用的合成结果对（`tool-calls.ts:95-98` → 249-259，`info.code = TOOL_ABORTED_BEFORE_DISPATCH`）。**下一个 loop 实例从日志重建位置**：`agent.ts:99` `const lastTurn = session.events.findLast(e => e.type === 'turn/start')?.data.turn ?? 0`。
- **轮次结束原因是封闭枚举，`blocked` 与 `max-tokens` 都在里面。** `session/src/types.ts:155-174` `TurnEndReasonMap`：`completed`(156) / `aborted{kind,reason}`(158) / `blocked`(160) / `error{kind,error: LlmFailure}`(166，注明"`error` is always a structured failure") / `'max-tokens'`(168，注明"至少有一个步骤撞到输出上限，即使插件把本轮续下去了") / `interrupted`(173，注明"由持久化后端在重载时关闭崩溃遗留轮次，**循环自身从不发出此标记**")；`TurnEndReason`(177) 是"merge-extensible sum type"。**WES 侧对照**：这六类里 WES 只有 abort/error 两类隐式语义，`blocked`（被 pre-step 政策否决）与 `max-tokens`（撞输出上限但被续）在 WES 的 run/attempt 状态里没有落点。
- **收件箱的 claim 是纯删除，且删除本身入日志。** `agent/src/inbox.ts:63-78` `claim(target, turn)`：`const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)`，`target === 'next-turn'` 时再取一条，逐条 `notifications.claimed(message, turn)`；文档明写 **"The durable splices are pure deletions."** 并标 `@internal - The agent loop's step-boundary operation, not a plugin extension point`。`splice`(129-193) 先 `this.session.append('agent/inbox/spliced', splice)`（186）再改内存（187），注释说明 `session/event` 观察者看到的是**拼接前**的列表，因而可重建；`clear()`(57-61) 先清 next-step 再清 next-turn。steering 由此成为**可审计的事件**，而不是内存队列的副作用。`cancel()` 的 `keepInbox` 分支另有一条不对称：`agent/src/runtime-types.ts:36-44` 注明保留收件箱时**不会记录 canceled 的 inbox splice**。
- **每个步骤都重建一次请求，靠逐字节一致而非可变缓存。** `buildRequest` `agent.ts:442-542`：`session.requestHeader()` 取头（668 起），只恢复**模型自持**的 `reasoningEffort`（459-464），`requestProposal(header)`（60-66）先把适配器派生的 `reasoningEffort`/`maxTokens` 剥掉再交给插件提案，`deepFreeze(structuredClone(...))`，`dispatch.waterfall('agent/request',{turn,step,signal},()=>seedConfig)`，无 provider/model 直接抛（481-483），`llm.prepareCall` 容忍 `NO_ADAPTER`（487-493），`canonicalHeader(...)` 后落 `request/header`（496-516，带 `reason: 'initial'|'resume'|'change'|'series'` 与 `startsSeries`），配置真变了才落 `request/context`（519-530）。流式失败走 `agent/request-error` waterfall：不重试抛 `LlmError`，重试则 `continue`（389-406）。
- **投递入口只有一个 `send`，三种语义只差一个布尔位。** `agent.ts:120-127` `send(message, target, wakeup)`：先算 `wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted`（123），命中则把目标强制改写为 `'next-turn'`（124），再 `inbox.splice(resolvedTarget, Infinity, 0, [message])`（125）后才 `wakeDriver(wakingAfterAbort)`（126）。注释 121-122 给出两条理由："Waking input cannot join an aborted activity, so it starts the next turn" 与 "Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it" —— **分类判定的时序早于插入，防的是观察者重入取消**。三个封装：`followup`=`('next-turn', true)`（129-131）、`steer`=`('next-step', true)`（133-135）、`inject`=`('next-step', false)`（137-139）；steering 与静默注入的全部差别就是 `wakeup`。
- **阶段互斥是同步抛错，且维护任务对外不可见。** `setPhase`（`agent.ts:110-118`）是唯一的状态提交出口，仅当 `status` 真的变化才 `dispatch.emit('agent/status', {status})`（115-117）；`status` getter（106-108）把 `maintenance` 与 `idle` 合并上报为 `idle`。README 声明与源码逐字一致：`agent/src/runtime-types.ts:94-112` 的 `runMaintenance` 文档写明 "public status stays `idle`" 且 "@throws synchronously when turn-driving or another maintenance task already owns the agent"，源码即 `agent.ts:150` `throw new Error(\`agent "${this.id}" already has active work\`)`。两处收敛重放完全对称：`kick()` 的 `finally`（222-229）与 `runMaintenance` 的 `finally`（163-167）都是"回落到 idle → 若 `wakeRequested && this.inbox.hasPending` 则 `wakeDriver()`"。失败处理同理：`throwError`（209-215）在真实边界上 `emit('agent/error', {turn, step, error})` 后再抛，注释 "Report one failure at its live boundary, then preserve it for driver containment"，而 `kick` 的 `catch` 把它吞掉（220-221）——**调用方观测不到 rejection，只能订阅事件**。对照 WES：`runAgent(): Promise<string>` 的失败唯一出口就是 promise rejection。
- **决定性对照 WES：`maxTurns` 这个概念在 dsh 的 core 里不存在。** 在 `agent-loop/src`、`agent/src`、`session/src`、`tools/src`、`scope/src` 全量 grep `maxTurns|maxSteps|turnBudget|maxIterations|maxLoop` —— **零命中**（返回码 1）；`AgentLoopSettings` 只有 `maxParallelToolCalls`（`agent-loop/src/index.ts:237-251`、`Config` 255-275，正整数校验 134-138）。README 声明与此一致且自陈为限制：`agent-loop/README.zh.md:189`「没有内置轮次预算：工具调用或 steering 会让当前轮次继续；限制失控轮次的策略必须从既有生命周期扩展点（如 `agent/turn-stopping`）执行取消」。

### 8.2 工具调用的执行与幂等：排他栅栏 + 有界滚动池 + 模型序提交；**effect 幂等登记表确认不存在**

- **串并混合的真实机制。** `tool-calls.ts:84-101` `executeToolCalls`：每轮重新读 `ctx.tools.executionMode(first.exec).kind`（88），`mode === 'parallel' ? planned.slice(next) : [first]`（89）—— 一个排他调用就是栅栏；注释 85「Commit before classifying again so registry changes affect unstarted calls」。分类器是**失效关闭**的：`tools/src/index.ts:1268-1284` `executionMode`，`if (!tool?.isConcurrencySafe) return {kind:'exclusive'}`，仅**严格 `=== true`** 才算并行，未知/隐藏/未声明/非法/抛错一律排他（`catch { return {kind:'exclusive'} }`）。
- **派发可重叠，提交必须保持模型序。** `runGroup` `tool-calls.ts:121-246`：`maxParallelToolCalls`（131，`constants.ts` `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`）限定的 `fillPool`（198-213）、`Promise.race(inFlight.values())` 排水（220-230），而 `commitReady`（145-160）的注释写明「`committed` advances only across contiguous model-order slots」，`appendToolResult(session, turn, step, call.block, result, callSeqs[committed])`（155）因此按模型顺序落账。模块文档 1-12 同时给出设计意图："Dispatch may overlap, while policy, results, and result context remain model-ordered… Abort records synthetic error results for skipped calls so replay stays valid."
- **`callId` 的稳定身份：就是模型给的 block id。** `tool-calls.ts:71-80` `exec = { callId: block.id, name: block.name, arguments: parseArguments(block.arguments), agent, signal }`；落账 `appendToolCall` 262-265 `session.append('tool/call', {turn, step, callId: block.id, name, arguments: block.arguments})` 并返回 `event.seq`；`arguments` 以**模型原样未解析的 JSON 字符串**入日志（`session/src/types.ts:265-268`），`parseArguments`（104-110）解析失败时把原文保留为文本；`appendToolResult`（268-288）用 `{surfaceOp:'append', sourceEventSeqs:[callSeq]}` 把结果反向指回那次 call 事件。PTC 子调用另有 `rootCallId/parentCallId/subCallId` 三元身份（`tools/src/index.ts:1367` `rootCallId = exec.rootCallId ?? callId`）。
- **没有任何"每次调用只执行一次"的机制——前一轮的结论成立，且证据级别从「文档层面未找到」升为「源码层面确认不存在」。** 三条独立证据：① 全包 grep `idempot|dedup|effectKey|alreadyExecuted|executionRegistry` 在 `tools/src` 只命中 Python 名字折叠的 `usedClassNames`（`py-types.ts:380`）与析构幂等注释，无一处与执行去重有关；② `tools/src/index.ts` 内**唯一**的私有集合字段是 1783 `canonicalResults = new WeakMap<object, ToolExecutionToken>()`，配 `markCanonical`（1785-1789）与 `normalizeDispatchResult`（1825-1826 `if (this.canonicalResults.get(result) === exec.token) return result`）——这是**来源戳**（防止别人伪造已归一化的结果），不是缓存，也不是按 callId 的表；另一个 `concludingExecutions`（807）是 `WeakSet<ToolExecution>`，按对象身份而非调用身份索引，结构上就不可能充当去重表；③ 真正的重放语义在 `session/src/repair.ts`，它**故意不去重**：崩溃遗留的已记录未落账调用被合成成错误结果，L104 的文案是 `TOOL_OUTCOME_UNKNOWN` —— "…Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. **Do not retry blindly.**"（未派发的走 L105 `TOOL_NOT_STARTED` "Retry it if it is still needed."），随后补 `step/end`（128-130，注释：step 未开就落 `turn/end` 是违反不变式的）与 `turn/end {kind:'interrupted'}`（131，`session/src/types.ts:173` 注明"the loop never emits this marker"）。**dsh 提供的保证是 transcript 合法性（每个 call 必有 result），不是 at-most-once 效果。**
- **模式折叠的调用在政策管线之前就被拒绝，与"工具不存在"是两条路径。** `tools/src/index.ts:1363-1378` `createExecution`：1365 `const token = createExecutionToken()`、1367 `const rootCallId = exec.rootCallId ?? callId`，随后注释 1372-1378 划出这条分界："A collapsed call is deterministically denied, so it terminates BEFORE the extensible policy pipeline: pre-execute listeners, approval `ask`, and guards must never observe — or worse, approve — a call that can only fail. An unknown tool keeps the historical dispatch-stage `UNKNOWN_TOOL` path so policy listeners still see every name that reaches the registry."（判定在 1379-1380 `const visible = this.get(name, agent)` / `const collapsed = visible !== undefined && this.collapses(...)`）。**这是 WES 完全没区分过的两种失败**：被策略确定性否决 vs 名字根本不存在。另一条相邻的时序约束：注释 1397-1402 要求 finalizer 在**参数物化之前**捕获，因为 arguments getter 可能在 `snapshotJsonValue` 期间替换或清空已注册的回调。
- **成功结果是一条四段流水线，UI 呈现元数据只对根调用算。** `createSuccessResult` `tools/src/index.ts:1792-1822`：`snapshotToolValue(tool.name, candidate)` 先与模型返回值断离开（1793）→ `validateJsonSchemaValue(tool.output.schema, detached, 'value')`，不合规即 `throw new ToolOutputError`（1794-1795）→ `deepFreeze(detached)`（1796）→ `tool.output.render(exec.arguments, value)`（1799，异常统一成 `projectionError(tool.name,'render',error)` 1801）→ `snapshotProjection(tool.name,'render',rendered)`（1803）；`presentationMeta` 被 `if (exec.parent === undefined && …)` 门挡住（1805），**PTC 子调用不产出呈现元数据**；末尾 1814-1815 `const concludesTurn = this.concludingExecutions.has(exec)` + `markCanonical(exec, …)` 盖来源戳。三个视图（`value` / `content`(render) / `meta`）各自独立失败、各自留错误来源标签。
- **README 声明与源码一致的一处正例（记入核对清单，非缺陷）。** `agent-loop/README.zh.md:186`「**分类是一元的**：安全性取决于比较同级调用或资源的调用必须保持独占」正是源码契约本身：`tools/src/index.ts:269` `isConcurrencySafe?(args: unknown): boolean`，文档 266-268 说明入参是 "parsed arguments; `defineTool` validates before calling"，调用点 1279 `tool.isConcurrencySafe(exec.arguments)` 也只传自身参数——**签名里没有同级调用集，因此它结构上不可能做出"这一批放一起安全吗"的判断**，第一条 bullet 的排他栅栏是一元性的必然后果，而不是额外保守。
- **决策槽在代码里的形状与提供方。** `PreToolDecision` `tools/src/index.ts:583-592`：`{kind:'allow'} | {kind:'deny'; reason: string} | {kind:'ask'; reason?: string}`，文档 583-588 明写 `ask` 只有在审批服务返回 `allowed-once` 后才执行、否则拒绝，且**"Input rewriting is excluded because arguments are already logged and presented."** —— 结构上不给改参留口子。`PostToolDecision` 594-601：`accept`（`content?` 与 `value?` 互斥）/ `accept{value}` / `block{feedback}`，两者都可带 `additionalContexts?: UserMessage[]`。提供方是监听 `tools/pre-execute`（137-152，waterfall，**按 scope 过滤**，agent 级监听器只看到自己 agent 的调用）与 `tools/post-execute`（164-175）的插件；`tools/execute` 是 around 派发（153-163），文档保证"call identity remains immutable… The registry re-fuses the original caller signal before the body, so replacement cannot detach caller cancellation"；`tools/ptc-dispatch-log`（176-189）只影响**落日志的那份拷贝**；`tools/result`（190-197）在 deep-frozen 快照上 emit。无审批服务时 `resolveAsk`（1678-1702）把 `ask` 降级为 `deny`，同样失效关闭。调度器本身 `ToolRuntimeScheduler {prepare,dispatch,finalize,finish}`（446-461）与 `ScheduledToolPreparation`（427-435 `dispatch|post-result|final-result`）均标 `@internal` 且注明"this is not a plugin extension point"（437-444）——**`final-result` 是同一次派发内的短路，不是跨重放的缓存**。

### 8.3 `invariant.ts` 是什么：每包一份**运行时断言**配套，走注册 + 正则允许/阻止列表

- **一个包一个 companion 文件，全仓 247 份**（`find packages -name invariant.ts`）。它是**运行时断言，不是类型级约束**：`packages/runtime-diagnostics/invariants/src/index.ts:29` `InvariantFailure = (message: string) => never`，50-66 `class InvariantError extends Error { code = 'INVARIANT'; packageName }`，消息形如 `invariant violated by "${packageName}": ${message}`。断言在 `ctx.on(...)` 钩子里抛。
- **`agent-loop/src/invariant.ts` 只声明一条不变式：请求可重建。** 63 行整份内容：`name='agent-loop-invariant'`（14）、`inject=['invariants']`（16）、`ctx.on('llm/stream', …, { global: true, prepend: true })`（21-54）逐条检查 `isAgentLoopRequest(options)` 命中后：请求必须已冻结、必须带 `sessionId`、`sessions.get` 必须命中、`options.messages` 必须已冻结、日志里必须存在 `step/start`、`foldRequestHeader(events)` 必须可折出，最后 `JSON.stringify(options.messages) !== JSON.stringify(session.deriveMessages())` 即 `fail('… diverges from the dispatch-time durable derivation (log-reconstruction desync)')`，再比对 model/system/temperature/maxTokens/stop/tools。注释 L20 说明为什么 `prepend`：**"Prepend prevents a short-circuiting replay listener from silencing the check."** 尾句 `apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))`（62-63）。
- **开关机制。** `Config { enabled? = true; package_allowlist?: string[]; package_blocklist?: string[] }`（15-22，注释：区分大小写的 JavaScript **正则源串**，空列表放行全部；blocklist 在 allowlist 之后应用）；`compilePatterns`（75-91）拒绝空/空白/重复/非法；`selected()`（121-126）；`register(packageName, installer)`（136 起），文档 128-135：**"The package name is reserved even when filtering disables its checks. Enabled installers run in a child fiber; failure disposes that fiber and releases the reservation."** —— 即按包名预留 + 子 fiber 安装 + 失败回滚。
- **必须显式挂载，且挂载顺序有要求。** `packages/core` 各包与 host/bundle/api/boot 都**不自动**注册：仓库内唯一的非测试挂载点是 `packages/examples/agent-spine-demo/src/index.ts:246-250`（`ctx.plugin(InvariantRegistry, config.invariants ?? {})` 之后依次 `sessionInvariant / scopeInvariant / agentInvariant / agentLoopInvariant`）；`packages/host/plugin-inventory/tests/invariant.spec.ts:9` 的 `await ctx.plugin(InvariantRegistry, { enabled: true })` 是测试专用。单 Context 也是 opt-in（`agent-loop/tests/invariant.spec.ts:8-14`）。打包上 companion 走独立 subpath：`agent-loop/package.json` 的 `"./invariant"` 导出 + `files` 含 `lib/invariant.js`，且 `dsh-invariants` 是 **peerDependency**，普通入口不沾诊断依赖。** ⇒ 不变式在默认生产路径上是关着的；它的价值在于"可随时为某个部署整体打开"，而不是"线上一直生效"。
- **另外三份，说明这不是一次性写法。** `tools/src/invariant.ts`（128 行）：`stages: WeakMap<object, ToolStage>` 强制 `pre → execute → post` 单调且 pre-execute 不得重复（34、94-114）；`validateResult` 要求 exec/outcome/content 已冻结且 `name`/`callId` 非空（18-30）；`dispatchRoots: WeakMap<Session, Map<string,string>>` 强制 `subCallId → rootCallId` 稳定并校验父包含关系（36-52）；`seed()` 在加载时重放整份日志、揪出在没有开启轮次时落账的 code-dispatch 事件（58-73）。`scope/src/invariant.ts`（41 行）：`ctx.on('internal/dispatch', …, { global: true })` 断言带 scope 的事件派发必须携带 scope carrier，且 carrier 的键必须与 payload 主体一致。`session/src/invariant.ts`（249 行）：`SessionTrace { lastSeq, openTurn, openStep, nextTurn, nextStep, pendingCalls }`（23-30）、`requireOpenStep`（42-52）、`validateEvent`（55 起）—— 关键点在**校验候选事件时不改动已提交的 trace**、seq 严格递增（60-62）、`turn/start` 必须等于 `nextTurn` 且不得嵌套开启轮次（72-78）。
- **不变式测试是双向的，且反例成对。** `agent-loop/tests/invariant.spec.ts`：40-43 合法请求 `.not.toThrow()`；45-56 在**已开启的 step 之内**追加一条 `user/message`（`{surfaceOp:'append'}`，见 47-49）后再用 `Object.freeze(session.deriveMessages())` 构造请求，同样 `.not.toThrow()` —— 即"步骤内新增上下文"是被允许的正常路径，不是违例；58-67 把同一条 `<system-reminder>catalog</system-reminder>` 消息分别塞到 boundary **前面**（63）和**后面**（65），两次都 `.toThrow(/diverges from the dispatch-time durable derivation/)` —— **前缀偏离与后缀偏离同等被拒**，测试不假设"只有追加才危险"。这就是 §七"每个借鉴概念配一条不变式测试"的最小可抄模板：一个正例 + 一个语义上最近的合法近邻 + 两侧各一个反例。
- **对 WES 的直接可用形状**（承接 §七 的"每个借鉴概念配一条不变式测试"）：四件套 = ① 概念自带一份独立 subpath 的 companion；② 按包名注册，从而可被允许/阻止列表筛选并按包回滚；③ `global + prepend`，插件无法把它短路掉；④ 断言的比较对象是**持久派生结果**（`deriveMessages()` / `foldRequestHeader()`），不是内存缓存。

### 8.4 `runtime-context.ts` 与 `scope`：前者是 prompt token 投影，**不是** WES 的 `RuntimeContext` 同类物

- **`RuntimeContextProjection` 里没有可信上下文。** `agent.ts:103` `this.runtimeContext = new RuntimeContextProjection(this.ctx, session)`，唯一使用点在 `preStep`：`assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))`（237）→ `const context = this.runtimeContext.project(joinContextSections(sections), sections)`（240）→ 仅当投影出的内容与持久日志里的上一次快照不同才把这条合成 user 消息追加进 `claimed`（241-247）。它**跟踪"最后一次被保留的 runtime-context 快照"，但不拥有其提交**；能改的东西只有已 deep-frozen 的请求：`buildRequest` 尾部 `markAgentLoopRequest(deepFreeze({ …header.config, messages: boundaryMessages, …system, …tools, sessionId: this.session.id, signal }))`（`agent.ts:533-540`），插件想改只能经 `agent/request` waterfall 产出新对象（481 一带）。README 声明（`agent-loop/README.zh.md:141-149`）也把这一段的收益表述为 KV cache 仅在逐字节一致时保留 —— 是缓存/token 语义，不是安全语义。
- **判定：与 WES `apps/api/src/agent` 的 `RuntimeContext` 不是同一类东西。** WES 那个是**信任边界**（"只信任可信上下文、防模型伪造会话 ID"）。dsh 的防伪职责由另一组机制承担：`markAgentLoopRequest` + `isAgentLoopRequest` 门（8.3）+ `sessionId` 被冻结进请求 + 请求重建不变式（伪造请求既过不了标记判定，也无法与 `session.deriveMessages()` 对齐）。照抄 `runtime-context` 这个名字到 WES 会制造错误的对应感。
- **`scope` 解决的是两件真实问题：监听器路由 + 注册归属/拆除。** `scope/src/index.ts`：`ScopeKey = object`（15）、`kScope = Symbol('dsh.scope')`（18）、`Scoped<T>` 只是路由用的品牌载体（27）、`carrierKeys` / `scopeParents` 两张 WeakMap（30、32-39，注释：一条关系同时服务两个方向 —— 注册视图向下继承、事件准入向上扩展）、`linkScopeParent` 带环检测（54-59）、`bindScopeParent` 重复绑定直接抛并返回唯一的 `ScopeParentBinding.rebind` 把手（72-82）、`createScope` 返回 `dispose: () => (disposing ??= quiesceFiber(fiber))`（137-147）、`scopeTarget(base, key)`（170-185）保留 base 过滤器且 `tag === undefined` 时全局准入、否则只允许祖先。
- **派生历史的可共享性由注释直接担保，而不是靠调用方自觉。** `session/src/index.ts:706-723` 文档 + 724-745 实现：缓存三元组 `derived` / `derivedNodes` / `derivedGeneration`（700-704）；契约原文 "CACHED: each surface node is projected exactly once, when first seen — a call costs O(new nodes), and a surface rewrite (a `replace`; `SessionSurface.replaceGeneration`) rebuilds. The returned array is a fresh snapshot per call (later appends never grow an array a caller already holds); the `Message` objects in it are **SHARED and deep-frozen**. Their content reuses the already frozen durable event data, so the cache needs no second deep clone and consumers still cannot mutate the log."（715-721）实现侧：`generation !== this.derivedGeneration` 即整体归零重投（728-732），逐节点 `this.deriveEventMessage(this.log[seq]!)`（737，注释 734-736："Surface sequences are built from this.log — seq is always a valid index by construction. The non-null assertion expresses that invariant."），且**空 content 的 assistant 消息（只挂 usage 的 max-tokens 步骤）派生为 null、不得进入 transcript**（738-741）。**WES 对照**：`ai_sessions.messages` 是 jsonb 列里的就地增删，没有"日志 → 派生视图"这一层，因此也不存在"数组新快照 + 元素共享冻结"这一档可保证性——8.3 的请求重建不变式在 WES 侧目前无从写起。
- **主体与载体不可能背离。** `agent/src/dispatch.ts` 模块文档 1-7："The fused dispatcher `agentEvents` couples the agent subject to its scope carrier, so the scope key and the payload's `agent` cannot diverge"；`agentEvents(ctx, agent, carrier = agentCarrier(agent))`（107），`fused`（113-118）注释："The spread comes first, so a structurally acceptable payload that happens to carry an `agent` field can never override the injected subject"；`AgentSubjectEvent`（28-34）在类型层同时要求 payload 带 `{agent: Agent}` 且 handler 声明 `this: Scoped<Agent>`。`agent.ts:93` 在构造期一次性建好并复用。工具侧的直接收益：`tool-calls.ts:130` `const { session } = ctx.agents.requireInitiator()` —— 落账写到哪个 session 由**发起者**决定，不来自参数。

### 8.5 与前文结论的关系：零推翻，两处修正

- **未推翻任何前文结论。** §三④「dsh 没有 effect 幂等登记表」由 8.2 升级为源码级确认；其判定「这一格 WES 已够用，而且设计意图更强」不变 —— dsh 连"确定性去重"这个概念都没有，它把是否重试的判断交给模型（`repair.ts:104` "Do not retry blindly"）。
- **修正 §三① L137 的可执行结论。** 原文把差距写成"在 for 循环体内插 `preStep` waterfall 挂点 + 把 checkpoint 升级为日志 seq"。源码显示这里其实是**两个独立问题**被合并了：(a) 循环主体能否挂起（dsh 是三态机，`agent.ts:38-46`），(b) 有没有轮次预算（dsh **没有**，见 8.1）。因此"WES 的阻塞 for 改成可挂起"与"WES 保留 maxTurns"并不矛盾：**maxTurns 在 dsh 是被刻意省略的概念**，WES 有它是净优势，不该出现在待改造清单里。
- **补强 §一/§二 的"append-only 日志是唯一事实源"。** 实现细节本轮到手：`session/src/index.ts:602-653` `append()` 的签名把 `surfaceOp` 做成编译期强制（`types.ts:393` "the compiler enforces this at Session.append()"），内含 `snapshotJsonValue` 守卫（612-620）、重入守卫（621-624）、`deepFreeze({type, seq: this.log.length, time, data, …surfaceMetadata})`（625-631）、`surfaceManager.validateNext(event)`（632）；文档 596-598："The event log is the durable source of truth, so a bad event fails at the append site rather than later during a backend flush." 派生侧 `deriveMessages()`（700-745）注释明确每个 surface 节点只投影一次、`replace` 时按 `replaceGeneration` 重建、其中 Message 对象**共享且 deep-frozen**。
- **新增一条取证限制，补进附录 A 口径。** 本章能证明"仓库里只有一个非测试不变式挂载点"，但**无法从包内源码判定某个下游部署是否启用了不变式** —— 启用状态属于组合根，不属于 `packages/core`。

### 8.6 源码中未找到（按 §五 口径，此处限定为源码层面）

- 未找到任何轮次/步骤预算：`maxTurns|maxSteps|turnBudget|maxIterations|maxLoop` 在 `agent-loop`、`agent`、`session`、`tools`、`scope` 五处 `src` 零命中。
- 未找到按 callId 索引的执行登记表：`tools/src/index.ts` 全部私有集合字段只有 807 `concludingExecutions`（`WeakSet<ToolExecution>`）与 1783 `canonicalResults`（`WeakMap`，来源戳），两者都按对象身份索引。
- 未找到 `runtime-context` 的任何鉴权、可信性或来源校验语义。
- 未找到持久化 sink 侧的幂等实现：`packages/core/session` 是内存日志 + 可插拔落点，落点幂等在 core 之外，本章不覆盖也不推断。
- 未找到 `Phase.maintenance` 的业务调用方：入口是公开 API `runMaintenance`（`agent.ts:149-169`，非 idle 即抛），但谁在用它（压缩？队列泵？）未追；`agent/src/index.ts:339` 只在注释里提到 "queue pumps, pool maintenance" 这类用途。

### 8.7 本章里可以平移到 WES 的具体契约（全部为源码实取，逐条回指 8.1–8.4）

- **投递三态收敛为一个私有原语 + 三个薄封装。** `agent.ts:120-127` 唯一入口 `send(message, target, wakeup)`，`followup`/`steer`/`inject`（129-131 / 133-135 / 137-139）只在 `target` 与 `wakeup` 两个参数上不同。WES 侧可平移的是这个形状本身：三种语义共用一条写入路径（`inbox.splice`，125），差别做成参数而不是三份各自实现插入逻辑的分支。
- **中止期间的唤醒要重新分类，且必须在插入前捕获。** `agent.ts:123` `const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted` → 124 把它强制降级为 `'next-turn'` → 126 `wakeDriver(wakingAfterAbort)`。可平移点：任何"中途插话"语义都必须回答"目标 step 正在被拆掉时这条算投给谁"，且答案要在写日志之前定下来，否则可重放的记录和实时行为会分叉。
- **状态与错误都是一等事件，不是返回值。** `setPhase`（`agent.ts:110-118`）是阶段的唯一提交出口，且只在 `status !== previousStatus` 时 `dispatch.emit('agent/status', { status })`；`throwError`（209-215）先 `emit('agent/error', {turn, step, error})` 再 `throw`。对照 WES：`runAgent(): Promise<string>` 把成败压进返回值（见 §三①），不变式违规与政策否决在 WES 没有事件落点。
- **对外状态语义可以与内部互斥严格解耦。** `agent.ts:106-108` 把 `maintenance` 向 `status` 报成 `idle`，同时 `agent/src/runtime-types.ts:94-112` 声明该入口 "@throws synchronously when turn-driving or another maintenance task already has the agent"（对应 `agent.ts:150`）。这是一份现成的"读接口保持稳定、写接口互斥到底"的注释+实现模板。
- **确定性失败要在扩展点之前了断，可恢复失败要留给政策看见。** `tools/src/index.ts:1363-1378`：折叠调用（1365 来源戳 token、1367 `rootCallId`）在进 `pre-execute` 之前就被拒，注释 1372-1378 的理由是"只能失败的调用不该被政策层看见、更不该被批准"；未知工具则保留 dispatch 阶段的 `UNKNOWN_TOOL` 让监听器仍能看到每个进入注册表的名字。可平移的是这条分层判据：**先看决定是不是已定的，再决定要不要跑政策**。
- **一个工具结果要同时喂三双眼睛，且差异要显式建模。** `createSuccessResult`（`tools/src/index.ts:1792-1822`）依次 `snapshotToolValue`（原始值）→ `validateJsonSchemaValue`/`ToolOutputError`（模型可见）→ `deepFreeze` → `render` → `snapshotProjection`（投影层），并在 1805 把 `presentationMeta` 限定在根调用上、1814 `concludesTurn`、1815 `markCanonical`。对照 §四 C：WES 现在把这几层塞进同一份 JSON。
- **并发安全性拿不准时默认独占（fail-closed），且分类是一元的。** `tools/src/index.ts:269` `isConcurrencySafe?(args: unknown): boolean`（调用点 1279）配合 README 声明 `agent-loop/README.zh.md:186`「分类是一元的：安全性取决于比较同级调用或资源的调用必须保持独占」—— 没有二元"部分安全"档，因此实现方漏写这个谓词时的默认方向是安全的。
- **不变式的最小可平移单元是"四件套"而不是单个文件。** `packages/core/*/src/invariant.ts`（每包一份，抛 `InvariantError`，`code='INVARIANT'`）+ 注册与开关 `runtime-diagnostics/invariants/src/index.ts:15-22`、50-66（`{global:true, prepend:true}`、`package_allowlist`/`package_blocklist` 大小写敏感正则、子 fiber 安装与回滚）+ 独立 `./invariant` 子路径与 `dsh-invariants` peerDependency + **双向测试**：`agent-loop/tests/invariant.spec.ts:45-56` 正例（步骤内 `user/message` 带 `surfaceOp:'append'` 不抛）、58-67 反例（63 前缀、65 后缀都 `.toThrow(/diverges from the dispatch-time durable derivation/)`）。§六 那条"每借一个概念就配一条不变式"的纪律，到这里才有可抄的最小骨架。

---

## 九、WES 侧落地决定（2026-09-02 架构侧裁决）

本章是**已定的决定**，不是建议。§七 的依赖链、`| 项 | 内容 |` 表格体例，以及「过线判据必须是命令实取拿到的输出，不是报告里的自述」这条口径，在本章一并沿用。唯一保持开放的是各批的「必须先答的问题」——那是要用户或执行方回答的，架构侧不代答。

### 9.1 编号约定

**不重编 §七 已有的批次 0–5。** 新增项用小数插入，本章引入两个：**批次 0.5**、**批次 6**。

理由：§七 的批次号已经被写进依赖链自身（「依赖 批次 1」「依赖 批次 2」）与总看板的过程记录。重编号会让这两处同时失效，而收益只是"数字更好看"——纯记账成本，不做。代价是小数号读起来别扭，接受。

### 9.2 批次 0 范围确认，并追加一项

§七 批次 0 已定的两项原样不动：① 工作台把 tools 传给模型；② 修掉固定 `effectKey = workbench_chat_answer:1`（多轮副作用互相吞）。**本批追加第 ③ 项。**

| 项 | 内容 |
|---|---|
| 追加做什么 | 建立**弱版请求重建不变式**：每次工作台调模型前，断言「实际发给模型的 `messages`」与「从当前 `ai_sessions` 的 jsonb 消息推导出的 `messages`」逐字节一致 |
| 依据 | §8.3。dsh 的 `agent-loop/src/invariant.ts`（63 行）挂在 `llm/stream` 上（`{ global: true, prepend: true }`），断言 `options.messages` 与 `session.deriveMessages()` 一致。WES 借的是**这条断言的形状**，不是它的推导源 |
| 为什么只能是弱版 | WES 今天没有事件日志——那是批次 2 的产物。推导源只能先落在 jsonb 快照上 |
| 升级到完整版的路径 | 批次 2 把历史表示换成事件序列后，**同一断言只换推导源**（jsonb → 日志重放），断言本体与测试骨架不改写。这就是"完整版顺手挣到"的含义：不预留抽象层，只保证一次改动的半径 |
| 为什么并进批次 0 而不单独排期 | 批次 0 正是 WES 第一次改变「发给模型的东西」的时机，也是偏离最容易被引入的时机。独立排期等于在最危险的窗口里不设防 |
| 与 §七 那条跨批次纪律的接合 | §七 末尾要求「每引入一个借自 dsh 的概念，同批次必须配一条不变式测试」。原批次 0 只做两处修复、不带不变式，是这条纪律唯一的例外；追加第 ③ 项正好把它补齐——批次 0 从此也有自己的判据，不再只靠构建与既有测试绿过关 |
| 已发生的同形事故 | DEF-2026-08-27-001（S2 · open · 已定档）：异步 Run 通道组装时不传 messages/projectId，`modelChatStream` 只推 system + userContent，于是**会话里存着完整历史、请求里只发两条**，五天内无人发现。若有这条断言，它的第一个测试就是红的 |
| 推导源的实取形状 | 弱版断言比对的两段数据里，存储侧只有一列：`ai_sessions`（`apps/api/src/db/schema/json_runtime.ts:202` 起）的 `messages` jsonb（同文件 `:213`，`notNull().default([])`）。同表另有 `attachments` / `artifacts` / `pending_actions` / `linked_records` 四份 jsonb，**它们不属于本断言射程**。这一点必须写进实现的注释，否则"请求重建不变式"会被后续读者误解为覆盖整个会话记录 |
| 与批次 0.5 的判据接合 | 批次 0.5 的过线判据 ②（确认工具参数与中间态没有进入下一轮请求的 messages）用的就是本批建起的**请求侧 dump 能力**。先做本批，0.5 的判据只是多断言一个来源；反过来做则两批各造一套 dump |
| 过线判据 | ① 故意构造一处发送与存储的偏离（例如组装时丢一条历史消息），断言**必须红**，且失败信息指名是哪一侧偏离；② 还原后断言**必须绿**；③ `npm run test:modules` 全绿，且该断言在测试文件里可 `grep` 到，不是只存在于本地脚本 |
| 必须先答的问题 | 断言以什么强度运行：常开（每次请求都跑，成本 O(messages)）、仅测试构建开启，还是按配置开启。dsh 的实取结论是**默认生产路径上关着、可随时整体打开**（§8.3「必须显式挂载」条）；WES 若选常开，需先给出实测开销 |
| 风险 | 弱版会漏掉一类真实偏离：jsonb 本身写错（存了不该存的、或漏存）。它保证的是"发送与存储一致"，不保证"存储正确"。批次 2 之后这类偏离才进入断言射程 |

### 9.3 批次 0.5：SSE 工具调用可视化（新增 · 项目侧需求）

| 项 | 内容 |
|---|---|
| 做什么 | 给 SSE 流补上工具调用可视化：前端把既有 `WorkbenchToolCallTrace` / `toolCalls` 通道（`apps/api/src/services/ai/workbench-dispatch.service.ts:57-60`、`:87-88`，即 MS3 工具调用 chip 的数据源，工作台侧当前恒为空）接上真实数据，并补流式状态 |
| 依赖 | 批次 0。不传 tools 就没有工具调用可看，本批会变成一个空壳 |
| 通道现状（实取） | 该字段是**已存在的 additive 契约**：`WorkbenchToolCallTrace = { name: string; source?: string }`，注释明写「仅新增、可选；缺数据时字段缺省，既有字段语义与事件契约零变更，前端缺数据时保持 MS3 静默降级」；捕获点在 `workbench-dispatch.service.ts:254-266`，按 `${name}:${source}` 去重。**结论：本批不是新建一条链路，是给一条已铺好但恒为空的链路喂数据 + 补三态**，因此前端降级路径无需重做 |
| 同仓已验证的模板（实取） | 事件契约扩展在 WES 里已有走通的先例，不必另找路。ISS-2026-08-10-004 的三步：① 在 `HARNESS_RUN_EVENT_TYPES` 增量登记 `text.delta` / `thought`（`apps/api/src/modules/harness/harness-runtime.types.ts:57-61`，附 additive-only 说明与「新增写入即为缺陷」的负向守护）；② 异步 workflow 经 `deps.appendRunEvent` 写入 `harness_run_events`；③ 前端 `useChatMessages.js:25` 的 `STREAM_EVENT_TYPES` 加 case 消费。**本批按同一形状加工具事件类**，且 `harness-runtime.types.test.ts:121` 已在守护这条扩展路径本身——复用先例，不是首例 |
| 为什么排在批次 1 之前 | §七 批次 1 的过线判据 ① 要求「日志里能看到拦截，不是前端静默替换」。**工具调用不可见 = 之后每一批都无法验证**。这是验证前提，不是体验优化 |
| 事件契约扩展（已获架构侧批准） | `HARNESS_RUN_EVENT_TYPES` 现为 16 类，additive-only（只增不减，增需架构裁决）。本批新增的工具调用事件类属 additive，**批准**。但必须按规则走：登记新类型 → 更新计数 → 跑防漂移测试（`apps/api/src/test-helpers/` 下 `db.drift.test.ts` 等四份在役）→ 把这次基线变更登记进 WES 总看板。绕过任一步，additive 契约就退化成"谁都能改" |
| 同时必须立的一条边界 | 仿 §八 的 dsh `SurfaceEventType`（只有 `user/message`、`assistant/message`、`tool/result` 进入模型可见折叠），**区分「UI 可见事件」与「模型可见事件」**。工具的完整参数与执行中间态给 UI 看可以，**不得整体回灌进模型上下文**，否则长会话比批次 3 之前爆得更快。WES 今天 `messages` 里的东西一律模型可见，没有这层区分——本批要把它建出来 |
| 已有的三态雏形（实取） | 编排循环侧**已经**在发工具事件：`AgentEvent`（`apps/api/src/agent/agent.types.ts:39-43`）的 `need_confirm` / `tool_call` / `tool_result`，在 `routes/agent.routes.ts:100-108` 映射为 SSE 帧 `needs_confirmation` / `tool_started` / `tool_finished`，发射点在 `apps/api/src/agent/orchestrator.ts:64`、`72`、`75`、`90`。**对照下来本批真正新增的只有"执行中"这一态**（现有实现从 `tool_call` 直接跳到结果，长工具挂着时中间无进度）。同时记下：`mutates: true` + `confirm` 那条分支是批次 1 `ask` 决策槽的雏形，但它在编排循环里硬编码——批次 0.5 只把它**显示**出来，不改造成可配置的拦截，改造属批次 1 |
| 三态设计 | 一次工具调用不是 `text.delta` 那样的字符流，而是**「开始 → 执行中 → 完成/失败」**，且可能长时间挂着（例如"新建项目"要落库）。事件必须能表达进度，否则界面上就是一段死空气 |
| 过线判据 | ① 工作台跑一条真实工具调用，UI 上三态逐态可见（命令实取：SSE 帧序列里三类事件按序出现，不是只有最后一帧）；② 命令实取确认**该调用的参数与中间态没有进入下一轮模型请求的 messages**——打印请求侧 messages 计数与内容比对，不靠"前端没显示"来推断；③ 事件类型计数与登记表一致，防漂移测试绿；④ `npm run build:web` + `npm run build:api` + `npm run test:modules` 全绿 |
| 必须先答的问题 | log-only 事件的存储落点**已有一个具体候选，需确认**：`harness_run_events`（`apps/api/src/db/schema/harness.ts:141-157`）已是 per-run 单调 `sequence` + `event_type` + `payload` jsonb，且 `(run_id, sequence)` 唯一索引在 DB 层强制——批次 2 要的 append-only 事件序列在**异步 Run 通道上已存在**。问题因此收窄为：工作台的**同步** SSE 通道今天只透传不落事件表，工具事件要不要补持久化；若要，同步与异步是否共用同一张表。此问不能拖到批次 2 现编 |
| 与批次 6 的分工 | 本批只管**看得见**，不管**可配置**。工具清单的启用/角色可见/审批策略属批次 6。在本批顺手加一个"工具开关"会把一个验证前提做成了治理功能，两件都没做完——不做 |
| 风险 | 可视化一旦上线就变成产品承诺，之后想收回等于功能删减。事件类型命名在本批定死，因为它同时是 DB 值、SSE 帧名和前端契约三份 |
| 本批明确不做 | ① 不做工具启停/角色可见的可配置策略（批次 6）；② 不做执行前的拦截与改写，`ask` 分支本批只显示不改道（批次 1）；③ 不把工具事件回灌进模型可见历史（该折叠规则属批次 2 的历史表示）；④ 不做工具输出的展示模板/渲染层。理由同一条：本批的验收面是"看得见进度"，多一项都会把判据从事件序列比对拖成 UI 主观评价 |

### 9.4 批次 6：工具策略管理页（新增 · 项目侧需求）

| 项 | 内容 |
|---|---|
| 做什么 | 工具清单进【系统管理】二级菜单，后台可审计、可维护 |
| 代码 / 数据边界（本批要害） | 工具的 `execute`、参数 schema、实现**留在代码里，不得变成数据**。落库的只有**策略**：是否启用 / 对哪些角色可见（覆盖 `capability` 默认值）/ 是否需要审批及走哪个审批策略 / 注入模式。参照 dsh `permission-presets`（§一 第 8 项 ③）：把沙箱模式与审批策略打包成具名预设，预设自身不实施任何强制、只产出策略 |
| 必须复用现有机制，不另造 | 系统管理现有配置区一律走 **draft → 生效**；`system_configs` 已有 `version` 与 `effective_at`（`apps/api/src/db/schema/json_runtime.ts:108-112`、`apps/api/src/modules/system/system-pg.repository.ts:150-159`）。工具策略作为**第五个配置区**接入同一套机制，复用其版本、审计与生效流程，不为这个页面另开一套草稿存储 |
| 模型可见 schema 的落点（实取） | 「实现不得进模型」这条边界 WES **今天已经具备**：`toToolDefinition`（`apps/api/src/agent/agent.types.ts:46-55`）是**显式字段投影**，只组装 `{ type, function: { name, description, parameters } }`，`execute` / `capability` / `mutates` / `category` / `discoverable` 结构上不可能随请求发出——这正是 §一 第 2 项里 dsh `schemas()` 显式允许列表的同类物。**所以本批不改投影函数**，策略只作为 `ToolRegistry` 现有五个注入集 selector（`listToolsFor:21`、`listFullToolsFor:32`、`listCoreToolsFor:40`、`listDiscoveryToolsFor:51`、`listDiscoveredToolDefinitionsFor:78`）上叠加的第二层过滤。这五处今天一律只按 `capability` 过滤，且三份带 MS3 注释的注入集（全量回退 / 核心 / 发现）本身就是"注入模式"的既有实现——批次 6 的"注入模式"字段应当映射到这三档，不要另发明第四种口径 |
| 第 10 个存储域 | 阶段 2 九域迁移已于 2026-08-31 收口。新增一个域必须走同一套纪律：drizzle 迁移文件（`apps/api/drizzle/` 现有 22 份在役）、seed 播种清单登记（`apps/api/src/db/seed.ts:168-172`）、防漂移计数。**不得因为"只是个配置页"绕开**——绕开的那一次，事后没人能从迁移序列里还原它的 schema 来历 |
| 依赖 | 批次 0（工具得先能被调用）。**建议在批次 3 之后**：管理页要显示"当前注入了几个工具、占多少 token"，这需要批次 3 的 token-meter；没有它，这个页面只能开关而看不到代价，于是会一直往里塞到上下文爆 |
| 为什么排最后 | 这是运营需求，不是能力需求。能力没跑通就建管理后台，管的是一个空东西 |
| 过线判据 | ① 禁用一个工具后，命令实取确认模型请求里真的不含它（抓组装后的 tools 列表，不看页面状态）；② 变更轨迹可查：谁、何时、改了什么，且能对上 `version` 递增；③ 页面显示当前注入的工具数与 token 占用，两个数与请求侧实测一致；④ 迁移与 seed 落地后 `npm run test:modules` 全绿 |
| 必须先答的问题 | 谁能改工具策略（`capability` 覆盖是权限面的重分配，比改文案敏感得多）；生效前是否需要预览影响面，还是直接生效；已禁用工具的历史调用在审计里如何呈现 |
| 与 RBAC 的关系 | 策略层**只做减法与另存默认，不替代既有权限校验**。今天每个工具带一个必填的 `capability: Capability`（`apps/api/src/agent/agent.types.ts:18`），而 `AgentUser.capabilities: Capability[]`（同文件 `:8`），selector 按 `caps.has(tool.capability)` 过滤。管理页的"对哪些角色可见"是在这条过滤之上再加一层，两层都通过才注入；不得做成"策略里启用了就能绕过 `capability`"——那是把审计页变成提权入口 |
| 本批明确不做 | ① 不做工具的在线编写与热注册（`execute` 不落库，见「代码 / 数据边界」条）；② 不做工具市场/导入导出；③ 不自建一套审批引擎——策略里只存"是否需要审批 + 走哪个审批策略"的引用，审批本身复用系统既有审批链路。理由：这三项都不是"让后台看得见、改得动"所必需的，而第 ① 项一旦做了，本批的要害边界（实现不落库）当场失效 |

### 9.5 更新后的完整顺序

| 顺序 | 批次 | 一句话 | 依赖 |
|---|---|---|---|
| 1 | 批次 0 | 传 tools + 修 effectKey + 弱版请求重建不变式 | 无（阻塞其余全部） |
| 2 | 批次 0.5 | SSE 工具调用可视化 + 事件契约扩展 + UI/模型可见边界 | 批次 0 |
| 3 | 批次 1 | 执行前决策槽（`allow\|modify\|skip\|ask\|stop`） | 批次 0；验证前提在 0.5 |
| 4 | 批次 2 | 历史表示：jsonb 快照 → append-only 事件序列 | 批次 1 |
| 5 | 批次 3 | 上下文预算：token-meter → 确定性剪枝 → compaction | 批次 2 |
| 6 | 批次 4 | 18 个正则 handler 按「谁发起」退役为 command 或 tool | 批次 0、1 |
| 7 | 批次 6 | 工具策略管理页（第 10 个存储域） | 批次 0、3 |
| 8 | 批次 5 | 可选：skills 机制化 / subagent / sandbox | 批次 2 + §六 第 10 条，需独立决策 |

批次 4 与批次 6 的相对顺序可按排期互换（两者互不依赖）。批次 5 保持末位、不进本次范围。**本章唯一的顺序改动是把批次 0.5 插到批次 1 之前，理由是验证能力，不是用户体验。**

> **2026-09-05 修订**：批次 1 的档位由五档收窄为三档，批次 6 拆为 6a/6b 且 6a 提前，另新增批次 7（MCP 接入）。以 §9.7 的表为准，本表保留原貌用于对照决策演变。

### 9.6 与 dsh 迁移决策的关系

本章全部批次仍落在 §四 的 **C 路线（局部替换）**内：借的是断言形状、决策槽分层、surface 白名单、策略预设打包这几条**判据**，`import` 的 dsh 代码为零。因此 §四 判定 C 的那条决定性理由——dsh 处于开发者预览期、README 自陈未来会有破坏兼容性变更、`SessionHeader.version` 不匹配时拒绝加载而不自动迁移——**不影响 WES 构建**：不存在可断裂的上游依赖。

批次 0 与批次 0.5 与迁移决策**完全解耦**：不论最终选 A、B 还是 C，这两批都必须做。它们的理由分别是「工具能不能被调用」和「调用过程看不看得见」，与借不借 dsh 无关。这也意味着——这两批不应拿"迁移方案还没定"当暂停理由。

若日后改判为 A 或 B，本章各批的存续性并不相同。**批次 0（含追加的第 ③ 项）、批次 0.5、批次 6 全部原样存活**：它们落在 WES 自己的契约上——tools 注入、`HARNESS_RUN_EVENT_TYPES` 白名单、`system_configs` 的版本化与 draft→生效、`ToolRegistry` 的注入集——换路线不推翻任何一条已定的判据。批次 1 至批次 4 会变的是**目标形态**（决策槽与事件序列照 dsh 实现重画、上下文预算改用其 compaction），不会变的是**这批工作必须做**：改的是"抄谁的"，不是"做不做"。

排期上的直接后果：迁移决策可以长时间悬置，而批次 0 → 0.5 照跑。真正被决策卡住的只有批次 2 之后（历史表示一换，批次 3 的剪枝对象与批次 4 的 handler 归属才受影响）。

## 9.7 三项排期修订（2026-09-05 架构侧裁决）

本节修订 §9.3–§9.5。修订理由全部来自实际落地过程中的实取发现，不是重新规划。

### 9.7.1 批次 1 的档位由五档收窄为三档

§9.5 原表写 `allow|modify|skip|ask|stop`。**实际只做 `allow` / `ask` / `skip`。**

| 档 | 处置 | 理由 |
|---|---|---|
| `modify`（执行前改写参数） | 移出本批 | 需要参数编辑界面 + 「谁改了什么」的审计口径，够单独一批。塞进批次 1 会让本批的验收面从「闸门是否可靠」滑向「编辑体验好不好」 |
| `stop`（中止整个 run） | **不做** | 与既有取消能力重复。两个词表达同一件事只会让词汇表变脏，而 `HARNESS_RUN_EVENT_TYPES` 是 additive-only、加进去就撤不掉 |

同时记入批次 1 的一个**必要前提**（实取发现，非原计划）：`workbench-intent.service.ts:102-105` 的意图分流命中「写动作词 + 写目标词」即判为 `write_action_request`，直接交给正则 handler，**模型与工具在这一步之前被绕过**。因此「帮我创建一个 ERP 项目」这类话today根本到不了模型。批次 1 必须同时退役这一条意图规则（**只这一条，其余 17 个 handler 仍归批次 4**），否则只加审批等于没做。

### 9.7.2 批次 6 拆为 6a / 6b，6a 提前

| | 内容 | 排期 | 依赖 |
|---|---|---|---|
| **6a** | 工具清单页（**只读**：有哪些工具、需要什么权限、是否写数据） | **提前，与批次 1a 并行** | 批次 0 |
| **6b** | 工具策略（启用/停用、角色可见、审批策略、注入模式） | 原位，批次 3 之后 | 批次 3 |

**6a 提前是用户决定**（2026-09-05：「记得要在系统管理里面做工具列表，让我知道目前有哪些工具」）。代价必须写明：§9.4 把批次 6 排在批次 3 之后的理由是「页面要能显示每个工具占多少 token 成本」，6a 提前意味着**页面能列出工具、但看不到成本**，该列等批次 3 之后由 6b 补。这是有意接受的缺口，不是遗漏。

**6a 的架构约束（要害，不得放宽）**：工具清单必须在运行时从 `ToolRegistry` 派生，**不新建表、不写迁移、不产生第十个存储域**。理由是落库的清单会与代码里的真实注册表漂移，而漂移后的页面比没有页面更糟——它带着后台管理页的权威感，会被当成事实源用于判断「这个 AI 能对我的数据做什么」，而它是错的。§9.4 里「execute 与 schema 留在代码、只有策略落库」那条边界在此进一步收紧为：**6a 阶段连策略都还没有，因此一行都不落库。**

由此提炼出一条可复用的判据，后续新增任何管理页都适用：

> **存没有事实源的东西，派生已经有事实源的东西。**
> 工具存在与否——代码里有答案，派生。
> 要不要停用它——代码里没有答案，这是一个决定，落库。

### 9.7.3 新增批次 7：MCP 接入（第三方工具）

**排在批次 6b 之后。**

**实取现状**：`apps/api` 全仓零 MCP 命中，WES 今天没有任何第三方工具接入能力。因此「让模型把会话总结发到 IM」这类需求，当前只能为每个集成手写一个内部工具——**这不是设计，是缺口**。

**MCP 的价值恰在于把这件事从代码变成配置**：客户端写一次，之后每接一个服务是一条配置（地址 + 凭据引用），服务自报它提供哪些工具，运行时转给模型。§9.7.2 那条判据在此同样成立且方向一致：**接了哪些服务**没有事实源 → 落库；**那个服务提供哪些工具**由服务自己知道 → 派生（问它），不抄。

**两条现有字段体系表达不了的新风险——这是必须先做 6b 的原因：**

| 风险 | 说明 | 现状 |
|---|---|---|
| 工具说明由第三方撰写 | 模型读 `description` 决定用不用某工具。第三方服务的 description 由对方控制，是一段**未经审阅却会进入模型上下文**的文本，构成提示注入面 | 无对应字段，也无审阅环节 |
| 数据外发 | 「把会话总结发到 IM」不改本地数据库，故 `mutates === false`——**但它把数据送出系统，比多数写操作危险**。当前风险模型只有「是否写本地数据」一个维度 | `mutates` 无法表达 |

**因此对批次 6b 的字段设计提出硬性要求（这是本节现在就写、而非等接 MCP 时再写的唯一理由——晚写就要返工）**：

1. 6b 的策略模型必须**在 `mutates` 之外独立引入「数据外发」维度**，不得用 `mutates` 兼任
2. 批次 1 的审批闸门必须对外发类工具同样生效，且**外发审批不适用任何「记住本次选择」的豁免**——写操作可以考虑会话内记忆，外发不行，因为每次外发的内容都不同
3. MCP 服务必须走**显式允许清单**，不得发现即可用

**排序理由**：没有策略层与外发标记就接 MCP，等于把一批未经审阅的工具连同未经审阅的工具说明直接塞给模型。批次 7 依赖 6b，不可互换。

### 9.7.4 修订后的顺序（以此表为准）

| 顺序 | 批次 | 一句话 | 状态 |
|---|---|---|---|
| 1 | 批次 0 | 传 tools + 修 effectKey + 弱版请求重建不变式 | ✅ 已合入 |
| 2 | 批次 0.5 | 工具调用可视化 + 事件契约扩展 + UI/模型可见边界 | ✅ 已合入 |
| 3 | 批次 1a | 写工具审批闸门 + 退役 `write_action_request` 意图规则 | 进行中 |
| 3′ | 批次 6a | 工具清单页（只读，与 1a 并行） | 进行中 |
| 4 | 批次 1b | 前端同意/拒绝 + 工具痕迹持久化 | 待 1a |
| 5 | 批次 2 | 历史表示：jsonb 快照 → append-only 事件序列 | — |
| 6 | 批次 3 | 上下文预算 | 待批次 2 |
| 7 | 批次 4 | 18 个正则 handler 退役 | 待 0、1 |
| 8 | 批次 6b | 工具策略（含数据外发维度） | 待批次 3 |
| 9 | **批次 7** | **MCP 接入（第三方工具）** | **待 6b** |
| 10 | 批次 5 | 可选：skills / subagent / sandbox | 需独立决策 |

**批次 1b 新增的「工具痕迹持久化」也是实取发现**：工具调用 chip 目前只在当次流式输出时显示，`AiMessage` 类型无对应字段（只有 messageId/role/content/createdAt/attachmentIds/artifactIds/metadata），**刷新页面或切回旧会话后痕迹消失**。事件本身已由批次 0.5 落进 `harness_run_events`，但没有任何东西把它还原回对话。用户要求「像主流产品那样留痕在对话框里」，故并入 1b。

## 9.8 新增批次 9：统一用户交互控件做成工具（2026-09-06 架构侧裁决）

**用户需求原文**：AI 需要确认、询问、收集补充信息时，统一调用一个前端控件向用户发起交互；用户可在控件中选 ABC、维护补充信息，确认后提交最新信息发送消息。

### 9.8.1 现状：零件齐全，但产生方式不可靠

实取确认，四个零件都已存在：

| 零件 | 位置 | 状态 |
|---|---|---|
| 前端控件 | `ui/V2_PROTOTYPE/src/components/AiWorkbench/InteractiveFormCard.jsx` | 已有，支持 `submitMessageTemplate` 按模板拼消息 |
| 严格契约 | `INTERACTIVE_FORM_BLOCK_CONTRACT`（`apps/api/src/ai/contracts/wes-contracts.ts:331`，R1 风险档，`additionalProperties: false`） | 已有 |
| 暂停 / 恢复 | `run.status = waiting` + `submitRunInputs` + `run_inputs_submitted` 事件 | 已有（批次 1a 建，且该恢复路径本就是为「收集用户输入」设计的） |
| 前端 SSE 与 chip 管道 | 批次 0.5 / 1b | 已有 |

**问题只在产生方式**：`formBlock` 由 `extractFormBlockFromModelOutput(fullContent, fullContent)`（`apps/api/src/services/ai/handlers/model-answer.ts:79`）**从模型自由文本里抽取**。即模型必须自己想起来写、并且格式完全正确；抽取失败就把一大段 JSON 当正文渲染给用户看——2026-09-06 会话 `7f5cbf75` 的事件流里可见该 JSON 逐字出现在 `text.delta` 中。

### 9.8.2 裁决：改为工具调用，不再靠文本抽取

模型**调用** `ask_user`（暂定名）工具并传入表单结构，服务端按既有契约校验参数 → run 转 `waiting` → 前端渲染既有控件 → 用户填选后经 `submitRunInputs` 恢复 → 结构化答案作为工具结果回灌模型。

**成本低的原因**：这是把现成零件接起来，不是新建机制。四个零件全部复用，新增的只有工具定义与参数校验接线。

**一个必须写清的概念差别**：批次 1a 的闸门是**执行前暂停**（该不该让它做）；`ask_user` 是**执行本身即暂停**（它的作用就是等回答）。两者共用 `waiting` 底层，但恢复路径不同——确认走 `confirmRunAction`，填表走 `submitRunInputs`。该区分现成即有，不新造。

由此推出：`ask_user` 的 `mutates` 为 `false`、决策槽落 `allow`、**不需要审批**——问一个问题不危险，再加一道确认是多余的摩擦。

### 9.8.3 三项范围裁决（2026-09-06 用户批准）

| 项 | 裁决 | 理由 |
|---|---|---|
| 旧的文本抽取路径 | **保留，标记为遗留**；新用法一律走工具 | 直接删有风险——报告生成等其它流程可能在用，尚未逐条盘点。整体退役与批次 4（正则 handler 退役）合并考虑 |
| 控件字段类型 | **只用现有的（文本、单选），不扩** | 「选 ABC」即单选，现有契约已支持。扩字段类型是前端活，与本批要害（让调用变确定）无关；混进来会把验收面从「调用是否可靠」滑向「表单好不好用」 |
| 排期 | **批次 2 之后** | 插在批次 2 前面会让批次 2（历史表示重构）多一个要迁移的形状。若近期急用可提前，代价是批次 2 多一点活 |

### 9.8.4 过线判据（拟）

1. 模型调用 `ask_user` → run 转 `waiting`，控件渲染，**正文里不出现任何 JSON**
2. 用户填选提交 → run 恢复，结构化答案作为工具结果进入模型上下文
3. 参数不合契约（缺 `blockId` / 字段类型不受支持 / 多余属性）→ 工具调用被拒且**错误可读**，不得静默渲染半个控件
4. `ask_user` 不触发审批（决策槽实取为 `allow`）
5. 旧的文本抽取路径行为**逐字不变**（零回归对照）

### 9.8.5 顺带验证了一条既有裁决

批次 6a 定的「工具清单从代码派生、不落库」在此得到印证：`ask_user` 一旦注册，系统管理的工具清单页**自动多出一行，无需任何同步动作**。若当初把清单落了库，此处就要多一次手工同步，且漏同步不会报错。
