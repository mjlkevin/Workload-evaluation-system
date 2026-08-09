# RP-047 检查点可观测性与可交互性 UI 设计（Checkpoint Observability）

> 状态：设计稿（待评审），未实现。归属 RP-047 后续批次，拆为 C-OBS（API 契约）与 D-OBS（前端表面）两批串行落地，遵循 post-A2 roadmap 的 Gate 机制。
>
> 2026-08-09 前端优化评审记录：依 Web Interface Guidelines（Vercel pinned 规则）+ WCAG 2.2 基线重写 §4 前端表面，新增 §4.7–§4.12（组件契约 / 可访问性清单 / 动效与降级 / URL 状态同步 / 空态与超长内容 / 响应式断点），更新 §5/§7/§8，新增 §10 findings 与 §11 Gate 路径。用户已拍板三项决策：① 审计入口扩展既有「系统管理 → 会话管理」（`/system/sessions`）页族，不新建 `/admin/session-audit`；② `state` 快照对所有角色默认折叠；③ 检查点端点直接挂 `/ai-runs` 路径族（Batch C 已落地），不先挂 `/harness`。
>
> 前置事实（2026-08-07 核实，2026-08-09 复核修正）：
> - 检查点数据已落 `harness_run_checkpoints`（PostgreSQL，RP-047 Batch A2，`apps/api/src/db/schema/harness.ts`）；
> - `harness-runtime.repository.ts` 已有 `listCheckpointsForRun`（按 sequence 倒序），**尚未暴露任何 HTTP 端点**；
> - 恢复链路事件词汇已冻结：`checkpoint_committed` / `recovery_started` / `recovery_completed` / `run_failed`（`harness-runtime.types.ts`）；Attempt 行携带 `resumeCheckpointId` / `resumeCheckpointKey`（恢复来源）；
> - 兼容性选择逻辑在 `selectHarnessResumeCheckpoint`（workflow 版本匹配 + stateHash 重算 + effectKeys 归属 + resumePolicy 非 manual）；失败码 `RECOVERY_CHECKPOINT_INCOMPATIBLE` / `RECOVERY_LIMIT_EXCEEDED`；
> - 前端主线 `ui/V2_PROTOTYPE`（Vite 5 + React 18.3），`tokens.css` 令牌体系，`Dialog` / `Drawer` / `ToastContainer` 共享组件；`StatusPanel/RunStageIndicator.jsx` 已有时间轴模式可复用。
> - 【2026-08-09 修正】管理员会话审计列表**已存在**：`/system/sessions`（`components/system/AiSessionAuditPanel.jsx` + `hooks/useAdminAiSessions.js`，`GET /system/ai-sessions`，仅 admin）；本设计仅定义其检查点下钻扩展，不新建页面族入口。
> - 【2026-08-09 修正】Batch C 已落地：后端 `apps/api/src/routes/ai-runs.routes.ts`（挂 `/api/v1/ai-runs`，`routes/index.ts:57`）与前端 `src/api/aiRuns.js` 均已接线；检查点端点直接进入该路径族。

## 1. 目标与非目标

**目标**：让两类角色看得见、点得开、筛得出 Harness Run 的检查点：

1. 业务用户（AI 工作台）：知道自己会话跑到哪一步、是否发生过自动恢复、恢复从哪个检查点续跑。
2. 管理员（会话审计）：按用户/会话下钻任意 Run 的完整检查点历史、恢复谱系与兼容性结论，用于故障定位与审计追溯。

**非目标**：

- 不提供检查点的手动写入、删除、回滚执行（只读可观测；`manual` 策略的人工恢复入口另立需求）；
- 不替换 Batch C 计划的异步 Run API，只做其只读观测面的扩展；
- 不引入任何新 UI 依赖或第二状态管理栈（improving-wes-ui 硬约束）。

## 2. 数据与展示契约

### 2.1 检查点视图模型（CheckpointViewModel）

由后端一次性组装，前端不做兼容性推导（单一事实来源）：

| 字段 | 来源 | 说明 |
|---|---|---|
| `harnessRunCheckpointId` / `sequence` | checkpoints 表 | 唯一键与 Run 内递增序号 |
| `checkpointKey` / `checkpointKind` | checkpoints 表 | `structural` / `semantic` / `combined` |
| `stepKey` / `workflowId` / `workflowVersion` | checkpoints 表 | 所属步骤与工作流版本 |
| `resumePolicy` | checkpoints 表 | `resume_next` / `restart_step` / `manual` |
| `stateHash` / `inputHash` | checkpoints 表 | 列表页只返回哈希；`state` 原文仅详情端点返回 |
| `effectKeyCount` | `effectKeys.length` | 列表页不返回 effectKeys 全量，详情返回 |
| `aiMilestone` | checkpoints 表 | semantic/combined 的业务里程碑标签（时间轴优先展示） |
| `runtimeValidation.checks` | checkpoints 表 | 五项：ownerBound / workflowVersionMatched / stateHashMatched / nextStepKnown / effectsStable |
| `createdAt` | checkpoints 表 | 创建时间戳 |
| `producedByAttempt` | attempts 关联 | 产生该检查点的 attempt 序号（第几次尝试） |
| `resumeEligible` | 后端按 `selectHarnessResumeCheckpoint` 同款规则计算 | 当前是否仍可作为自动恢复点；`manual` 策略恒为 `manual_only` |
| `usedForResume` | attempts 反查 | 是否被某次恢复选为来源；是则附带 `resumedByAttempt` |

### 2.2 恢复谱系视图模型（ResumeLineage）

单个 Run 的恢复链，按 attempt 聚合：

```
{
  attemptNumber, attemptId, status,            // claimed/running/succeeded/failed/orphaned/cancelled
  resumeFromCheckpoint: { id, checkpointKey, sequence } | null,
  recoveryStartedAt, recoveryCompletedAt,      // 来自 recovery_started/recovery_completed 事件
  errorCode                                  // RECOVERY_LIMIT_EXCEEDED / RECOVERY_CHECKPOINT_INCOMPATIBLE | null
}
```

### 2.3 状态词汇口径（冻结，前端不得自造）

| 后端词汇 | 中文展示 | 视觉色系 |
|---|---|---|
| `structural` | 结构检查点 | `--info` |
| `semantic` | 语义检查点 | `--chart-5` |
| `combined` | 复合检查点 | `--brand` |
| `resume_next` | 续跑下一步 | `--ok` |
| `restart_step` | 重做本步骤 | `--warn` |
| `manual` | 仅人工恢复 | `--ink-3` |
| 恢复产生的 attempt 边界 | 恢复点 ↻ | `--accent` |
| `resumeEligible=false` | 不可自动恢复 | `--ink-3` 弱化 + `?` Tooltip |
| Run active（queued/running/waiting/recovering/cancelling） | 进行中 | `--brand` pulse |
| Run terminal（completed/failed/cancelled） | 已完成/失败/已取消 | `--ok` / `--err` / `--ink-3` |

## 3. API 契约

挂在既有 `/api/v1/ai-runs`（Batch C 已落地的异步 Run 路由族，`ai-runs.routes.ts`；2026-08-09 用户拍板直接入族，不走 `/harness` 过渡）。全部 JWT 鉴权，响应 `{ code, message, data }`。

### 3.1 `GET /ai-runs/:runId/checkpoints`

查询参数：

| 参数 | 说明 |
|---|---|
| `limit` / `offset` | 分页，limit 默认 50、上限 200 |
| `afterSequence` | 增量拉取：仅返回 sequence 大于该值的记录（轮询用） |
| `kind` | 逗号分隔多选：`structural,semantic,combined` |
| `resumePolicy` | 逗号分隔多选 |
| `recovered` | `true`/`false`：是否为恢复后 attempt 产生的检查点 |
| `attempt` | 指定 attempt 序号 |
| `eligible` | `true`/`false`/`manual_only`：恢复兼容性筛选 |
| `from` / `to` | ISO 时间范围 |
| `q` | 模糊匹配 `checkpointKey` / `stepKey` / `aiMilestone.label`（`ILIKE %q%`，长度上限 64） |

响应：`{ items: CheckpointViewModel[], total, run: { status, workflowVersion }, lineage: ResumeLineage[] }`。

**权限**：owner 本人可读；非 owner 返回 404（不泄露资源存在性，与 Batch C Step 3 口径一致）。

### 3.2 `GET /ai-runs/:runId/checkpoints/:checkpointId`

返回完整详情：视图模型全字段 + `effectKeys` 全量 + `state` 结构化快照（已过 `assertSafeJsonObject` 边界）+ 该检查点相关的恢复事件（若 `usedForResume`）。

### 3.3 管理员审计端点

```
GET /api/v1/system/ai-sessions                          # 既有：会话列表（AiSessionAuditPanel 已消费）
GET /api/v1/system/ai-sessions/:sessionId/runs          # 新增：会话 → Run 列表（含检查点计数）
```

- `requireAdmin`（与用户管理同口径）；非 admin 一律 404。
- 只读；审计访问本身写入 trace 域（沿用 `modules/trace`），满足审计追溯。
- Run 下的检查点读取复用 3.1/3.2（admin 身份绕过 owner 校验但记审计日志）。

### 3.4 openapi.yaml 同步

三个新端点（3.1、3.2、3.3 的 runs 子端点）全部补进 `docs/openapi.yaml`，并按需更新 `03_技术设计/系统演进/实现与文档对齐说明.md`。

## 4. 前端表面

### 4.1 表面 A：AI 工作台 StatusPanel「执行检查点」（用户视角，轻量）

落点：`ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/CheckpointStrip.jsx`（新建，≤200 行），作为 `StatusPanel/index.jsx` 的新分区，不改动 `RunStageIndicator` 既有四步时间线。

行为：

- 仅当会话存在关联 Harness Run 且检查点数 ≥1 时渲染；无检查点时整块不渲染（不占位、不渲染空壳 UI）；
- 紧凑横向时间轴：最近 8 个检查点节点 + 「共 N 个 · 查看」入口；
- Run active 时 5s 轮询 `afterSequence` 增量追加；Run terminal 后停止轮询；
- 发生过恢复时显示一条醒目提示条：「已自动恢复 1 次，从检查点 `input_committed` 续跑」，点击进入详情 Drawer；
- 点击任意节点 → 复用表面 B 的 `CheckpointDetailDrawer`（同一组件，用户视角隐藏 admin 专属字段）。

可访问性：轮询新增节点与恢复提示条包在 `aria-live="polite"` 容器内（不整表重读，仅播报增量文案如「新增 2 个检查点」）；节点为 `<button>` 不用 `<div onClick>`，`aria-label` 含完整语义（如「第 5 个检查点 input_committed，语义检查点，可自动恢复」）；装饰性图标 `aria-hidden="true"`。

### 4.2 表面 B：会话管理页族的检查点下钻（扩展既有页面，不新建入口）

【2026-08-09 拍板】审计入口复用既有「系统管理 → 会话管理」（`/system/sessions`，`AiSessionAuditPanel.jsx`），admin 守卫已由 `isAdminOnlyPath` 覆盖 `/system` 前缀（`utils/adminAccess.js`），无需新增守卫逻辑。

路由（`App.jsx` 新增 2 条，均在既有 `ProtectedLayout` 内）：

```
/system/sessions                                    → 既有列表：行末新增「检查点」入口（有 Run 才可点）
/system/sessions/:sessionId/runs                    → SessionRunsList（Run 列表，新建）
/system/sessions/:sessionId/runs/:runId/checkpoints → RunCheckpointAudit（检查点主界面，新建）
```

文件结构（遵守页面分模块约定，单文件 ≤200 行）：

```
ui/V2_PROTOTYPE/src/pages/SessionAudit/
├── SessionRunsList.jsx          # Run 列表：状态/工作流版本/attempt 数/检查点数/恢复次数（≤200 行）
├── RunCheckpointAudit.jsx       # 主界面：工具栏 + 时间轴 / 表格双视图（≤200 行，组装层）
├── hooks/
│   ├── useCheckpoints.js        # 分页、筛选、增量轮询、useMemo 派生；URL search params 读写
│   └── useAuditRuns.js          # 会话 → Run 列表加载（消费 3.3 runs 子端点）
├── components/
│   ├── CheckpointTimeline.jsx   # 垂直时间轴（含 attempt 分隔带）
│   ├── CheckpointTable.jsx      # 密集表格视图（语义化 <table>）
│   ├── CheckpointFilterBar.jsx  # 筛选 + 搜索（250ms 防抖，对齐 AiSessionAuditPanel 既有口径）
│   ├── CheckpointDetailDrawer.jsx  # 详情抽屉（复用表面 A/B）
│   └── ResumeLineagePanel.jsx   # 恢复谱系面板
└── utils/checkpointLabels.js    # §2.3 词汇映射（唯一来源，供单测）
```

主界面布局：顶部筛选栏；中部「时间轴 / 表格」视图切换（默认时间轴）；右侧 Drawer 详情。页面标题层级：页面 h1（SystemManagement 壳已有则降级为 h2，不跳级）；列表/表格用 `role="list"`/语义 `<table>` 优先于 ARIA；页面顶部提供跳到主内容的 skip link（如 Shell 已有则复用）。

API 收口：检查点读取统一走 `src/api/aiRuns.js` 新增函数（`listRunCheckpoints` / `getCheckpointDetail`），与 Batch C 既有 `listActiveRuns` / `getRunSnapshot` 同层；`AiSessionAuditPanel` 的 runs 下钻入参改经 `useAuditRuns.js`。页面不直拼请求。

### 4.3 时间轴设计（CheckpointTimeline）

垂直时间轴，自上而下 sequence 递增（最新在底部，自动滚动到底；提供「倒序」开关）。布局复用 `RunStageIndicator` 既有模式：`timelineItemStyle` grid `28px minmax(0,1fr)` + marker 28px（`RunStageIndicator.jsx:43-69`）；`minmax(0,1fr)` 保证长文本可截断（flex/grid 子项 `min-w-0` 同义）。

- **节点形状编码 kind**（不只靠颜色，WCAG 1.4.1 不唯色）：structural=实心圆、semantic=菱形、combined=双环；
- **节点可交互**：每个节点是 `<button>`（不用 `<div onClick>`），Enter/Space 天然触发；`aria-label` 含序号、key、kind 中文、兼容性结论；
- **attempt 分隔带**：每次恢复插入一条 `--accent` 分隔条：「⚡ 第 N 次尝试 · 从 `#k checkpointKey` 恢复 · 2026-08-07 10:32:05」（时间用 `Intl.DateTimeFormat` 渲染，不硬编码格式），恢复产生的检查点节点左侧连接线改为**虚线**，节点右上角加 ↻ 角标——这是「恢复后检查点」的主视觉区分；
- **活跃态**：Run active 时最新节点套用既有 `wes-timeline-pulse` 动画（仅 transform/opacity，`index.css:1046-1049`）；Run terminal 后全部静态；`prefers-reduced-motion` 降级见 §4.9；
- **兼容性**：`resumeEligible=false` 节点降饱和（灰化）并在旁注「不可自动恢复」+ `?` Tooltip 解释原因（版本不匹配 / 校验失败 / manual 策略）；`runtimeValidation.checks` 有失败项时节点加 `--err` 感叹号角标（图标 + 文字，不只靠颜色）；
- **被用作恢复来源的检查点**：节点加 `--accent` 描边，hover/focus 提示「此检查点被第 N+1 次尝试用作恢复起点」（hover 信息必须有键盘可达的等价呈现，如 aria-label 或可见旁注）。

数字列（sequence、attempt 序号、计数、时间列）统一 `font-variant-numeric: tabular-nums`，避免轮询追加时数字宽度跳动。加载更早检查点时顶部哨兵显示「加载更早…」（以 `…` 结尾，不用 `...`）。

### 4.4 详情 Drawer（CheckpointDetailDrawer）

复用 `components/ui/Drawer.jsx`（焦点陷阱、`aria-modal`、Esc 关闭、关闭后焦点回到触发节点均已内置，`Drawer.jsx:44-104`），本组件只填内容。内容分区：

1. **标识区**：`checkpointKey`（`--font-mono` + 复制按钮，复制按钮必带 `aria-label`）；`checkpointKey` 与哈希文本加 `translate="no"` 防浏览器自动翻译乱码；kind 徽章、`#sequence`、创建时间（`Intl.DateTimeFormat`）；
2. **恢复语义区**：resumePolicy 徽章 + 一句话解释（如「恢复时跳过本检查点，直接执行下一步骤」）；stepKey、workflowVersion；
3. **完整性区**：stateHash / inputHash（等宽、前 12 字符 + 复制全量）；runtimeValidation 五项清单（✓/✗ 图标 + 文字，不只靠颜色）；effectKeys 计数（详情展开全量列表）；
4. **语义里程碑区**（semantic/combined）：`aiMilestone.label` / summary；
5. **状态快照区**：所有角色默认折叠（含 admin，2026-08-09 拍板），展开以 JSON 树只读渲染 `state`；区域顶部固定安全提示「快照已在服务端脱敏，请勿粘贴外部敏感信息」；加载中文案「加载快照…」；
6. **恢复来源区**（仅恢复后检查点）：ResumeLineagePanel——来源检查点（可点击跳转该检查点详情）、recovery_started/completed 时间、退避次数、失败码（如有）；来源检查点不存在时显示「来源检查点已随 attempt 清理」占位文案。

触摸与滚动：Drawer 内容区 `.wes-drawer__body` 补 `overscroll-behavior: contain`（现状缺失，见 §10 finding F4）；Drawer 内可点击控件 `touch-action: manipulation`。焦点：Drawer 打开后默认焦点落在关闭按钮或标识区首个可聚焦元素（经 `initialFocusRef`）；内部展开/折叠用原生 `<button aria-expanded>`，不用自造 role。

### 4.5 筛选与搜索（CheckpointFilterBar）

- 多选芯片：类型（3 项）、恢复策略（3 项）、恢复状态（正常创建 / 恢复后 / 曾被用作恢复源）、兼容性（可自动恢复 / 不可 / 仅人工）；
- attempt 下拉、时间范围（今天 / 24h / 7d / 自定义双输入）；
- 搜索框：checkpointKey / stepKey / 里程碑标签，**250ms 防抖**（对齐 `AiSessionAuditPanel.jsx:57` 既有口径，不用 300ms），服务端 `q` 参数执行；搜索框 `spellCheck={false}`、`autocomplete="off"`，placeholder 以 `…` 结尾并给示例（如「搜索检查点 / 步骤 / 里程碑，如 input_committed…」）；
- 所有控件必须有可见 `<label>` 或 `aria-label`（芯片组用 `<fieldset>` + `<legend>` 或 `role="group"` + `aria-label`）；
- 筛选条件编码进 URL search params（审计页可分享链接，参数表见 §4.10）；
- 筛选/搜索命中数为 0 时给出明确空态与「清除全部筛选」按钮（空态文案见 §4.11）；
- 结果计数与加载状态用 `aria-live="polite"` 播报（如「命中 23 个检查点」），不用整列表重读。

### 4.6 视觉令牌映射（不新增令牌优先）

| 语义 | 令牌 |
|---|---|
| structural / semantic / combined 徽章底色 | `--info-soft` / `--chart-5`（描边） / `--brand-soft` |
| 恢复分隔带与 ↻ 角标 | `--accent` / `--accent-soft` |
| 兼容性失败角标 | `--err` / `--err-soft` |
| 活跃 pulse | 复用 `.wes-timeline-pulse`（`index.css:1037`） |
| 灰化不可恢复 | `--ink-3` + `opacity:.55` |
| 哈希/键值文本 | `--font-mono` + `translate="no"` |
| 数字/时间列 | `font-variant-numeric: tabular-nums`（不新增令牌，CSS 属性） |

注：`tokens.css` 中 `--info` 只有 `--info` / `--info-soft` 两档（无 `--info-ink`，`tokens.css:27-28`），structural 徽章文字色用 `--ink-2`，不为单页新增 `--info-ink`。确需新增令牌时，只加到 `tokens.css` 并附注释，不做组件库迁移。

### 4.7 组件层级与 props 契约（新增，实现时不得偏离）

```
AiHomeWorkbench/StatusPanel
└─ CheckpointStrip { runId, checkpoints: CheckpointViewModel[≤8], total, recoverySummary, onOpenDetail(cp) }

/system/sessions/:sessionId/runs
└─ SessionRunsList          → useAuditRuns(sessionId)
/system/sessions/:sessionId/runs/:runId/checkpoints
└─ RunCheckpointAudit
   ├─ CheckpointFilterBar   { value: FilterState, onChange(partial), resultCount, loading }
   ├─ CheckpointTimeline    { items, lineage, runStatus, order: 'asc'|'desc', onSelect(cp), onLoadEarlier }
   │  └─ TimelineNode       （<button>，memo，key=sequence）
   ├─ CheckpointTable       { items, onSelect(cp) }（语义 <table>，行高 --table-row-height）
   └─ CheckpointDetailDrawer{ open, checkpoint, detail, onClose, variant: 'user'|'admin' }
      └─ ResumeLineagePanel { lineageItem, onJumpToCheckpoint(id) }
```

- `CheckpointViewModel` 字段以 §2.1 为准，前端不做兼容推导；后端字段缺失时展示 `—`，不造默认值。
- `variant='user'` 隐藏 admin 专属字段（state 快照区、审计提示）；同一组件两表面复用，不写两套 Drawer。
- 行/节点组件 `React.memo`，key 用 `sequence`；选择状态（当前打开的 checkpointId）提升在 `useCheckpoints` 并同步 URL（§4.10）。

### 4.8 可访问性清单（aria / live region 逐项验收）

| 元素 | 要求 |
|---|---|
| 时间轴节点 / 表格行入口 | `<button>`，`aria-label` 含序号 + key + kind + 兼容性；禁止 `<div onClick>` |
| 图标按钮（复制、刷新、倒序、关闭） | 必带 `aria-label`；装饰性 SVG/emoji `aria-hidden="true"` |
| 轮询增量、恢复提示、筛选命中数 | `aria-live="polite"` 容器，仅播报增量文案 |
| Drawer | 复用 `Drawer.jsx` 既有焦点陷阱 + `aria-modal` + 焦点回归；不自写 |
| 筛选控件 | 可见 label 或 `aria-label`；芯片组 `role="group"` + `aria-label` |
| 标题 | 页面 h1/h2 不跳级；Drawer 内 h2（`Drawer.jsx:134` 已内置）之下用 h3 |
| 焦点环 | 新增交互元素显式 `:focus-visible` 环（参考 `index.css:245` 模式）；禁 `outline:none` 无替代 |
| 复合控件（搜索框 + 清除按钮） | `:focus-within` 高亮容器 |
| 状态语义 | kind/兼容性/恢复状态均形状或图标 + 文字双编码，不唯色（WCAG 1.4.1） |
| 键盘 | 时间轴节点 Tab 可达、Enter/Space 触发；Drawer Esc 关闭；视图切换为原生 button 不用自造 tab |

### 4.9 动效与降级

- 唯一循环动效复用既有 `wes-pulse`（仅 transform/opacity，合成器友好，`index.css:1046-1049`）；不新增循环动画。
- 新增的一次性过渡（Drawer 内容区展开、视图切换）必须显式列出属性（如 `transition: opacity .15s ease-out, transform .15s ease-out`），**禁止 `transition: all`**；动效可被用户操作中途打断（新轮询追加不阻塞点击）。
- `prefers-reduced-motion` 降级：新增 CSS 必须随附降级；同时修复既有缺口——`.wes-timeline-pulse` 目前不在任何 reduce 媒体查询内（`index.css` 现有两处查询仅覆盖 `.ai-empty-state` 与 `.wes-toast`，见 §10 finding F2），D-OBS 顺手补入：`@media (prefers-reduced-motion: reduce){ .wes-timeline-pulse{ animation:none } }`。
- 自动滚动到底用 `scrollIntoView({ behavior:'smooth' })`，reduce 环境下降级为 `behavior:'auto'`（经 `matchMedia('(prefers-reduced-motion: reduce)')` 判断）。

### 4.10 URL 状态同步（可分享链接）

筛选、视图、分页、选中项全部编码进 URL search params（`useSearchParams`），刷新/分享后状态可还原：

| 参数 | 含义 | 示例 |
|---|---|---|
| `view` | 视图：`timeline`（默认）/ `table` | `view=table` |
| `order` | 时间轴顺序：`asc`（默认）/ `desc` | `order=desc` |
| `kind` / `policy` / `eligible` | 多选，逗号分隔 | `kind=semantic,combined` |
| `recovered` / `attempt` / `from` / `to` | 恢复筛选 / attempt / 时间范围 | `recovered=true` |
| `q` | 搜索词（250ms 防抖后写入，避免逐字改 URL） | `q=input_committed` |
| `offset` | 分页游标（哨兵加载后更新） | `offset=100` |
| `cp` | 当前打开的检查点 id（Drawer 深链接） | `cp=<uuid>` |

规则：默认值不写入 URL（保持链接短）；`cp` 存在时页面加载后直接打开对应 Drawer；参数解析失败时回退默认值而非报错。

### 4.11 空态与超长内容处理

| 场景 | 处理 |
|---|---|
| 会话无 Run / Run 无检查点 | 显式空态文案（如「该会话还没有产生检查点」），不渲染空表格/空时间轴壳 |
| 筛选命中 0 | 「没有符合筛选条件的检查点」+「清除全部筛选」按钮（对齐 `AiSessionAuditPanel.jsx:137` 模式） |
| 请求失败 | 错误文案 + 重试按钮，不用静默空列表 |
| 来源检查点已清理 | 「来源检查点已随 attempt 清理」占位，不渲染死链接 |
| 长 `checkpointKey` / `aiMilestone.label` | `truncate`（单行）+ `title` 全文；容器 `min-w-0` |
| 长 summary / 快照 | line-clamp 2 行 + 展开；快照仅展开时格式化 |
| 长哈希 | 截断 12 字符 + 复制全量（避免布局重排） |
| 文案规范 | 省略号用 `…`；加载态以 `…` 结尾（「加载中…」）；时间统一 `Intl.DateTimeFormat` |

### 4.12 响应式断点（1440 / 760）

- **≥1440px**：主界面单行布局：筛选栏一行（允许 wrap）+ 视图切换 + 结果计数；时间轴/表格占主宽，Drawer 440px 右侧覆盖（`components.css:90` 既有宽度）。
- **≤760px**（对齐 `components.css:121` 既有断点）：筛选栏换行为两行，搜索框占满宽；视图切换保留（表格视图横向滚动，首列 sticky）；Drawer 自动全屏宽（`.wes-drawer{width:100vw}` 已有，`components.css:126`）；会话列表「检查点」入口保持可点，行内长文本截断；所有可点控件触达区 ≥ `--control-height`（36px）且 `touch-action: manipulation`。
- 不引入新断点；若 760–1440 之间出现布局破损，实现时以现有断点内微调解决，不新增中间断点（避免断点蔓延）。

## 5. 性能设计（大量检查点场景）

| 措施 | 说明 |
|---|---|
| 服务端分页 | 默认 limit=50；筛选/搜索在 SQL 层完成，前端不拉全量 |
| 增量轮询 | 仅 Run active 时以 `afterSequence` 拉增量（5s），追加而非整表重拉；terminal 后停止 |
| 首屏窗口 | 时间轴首屏只渲染最近 50 条；向上滚动经 IntersectionObserver 哨兵触发「加载更早」 |
| 视图降级 | 过滤后 >200 条时提示「结果较多，建议切到表格视图」；表格视图行高固定 `--table-row-height` |
| 渲染稳定 | 行/节点组件 `React.memo`，key 用 `sequence`；筛选与派生统计走 `useMemo` |
| 详情懒加载 | Drawer 打开才请求 3.2 详情端点；state 大 JSON 折叠且仅在展开时格式化 |
| 哈希展示 | 长哈希默认截断 12 字符展示，复制取全量，避免长串导致的布局重排 |

**虚拟化权衡（显式声明）**：Web Interface Guidelines 要求列表 >50 条虚拟化；本项目受「不引入新 UI 依赖」硬约束，采用替代方案：**服务端分页 50 + IntersectionObserver 哨兵加载更早 + `React.memo` 行/节点组件**，配合表格视图的 `content-visibility: auto` 行级渲染降级。触发独立架构决策的阈值：**单 Run 检查点 >500 条**且哨兵加载下交互可感卡顿（滚动掉帧或筛选响应 >300ms）时，才提交虚拟滚动方案（含依赖引入）的独立架构决策，不在本设计内预置。

## 6. 安全与权限

- 所有端点 JWT；owner 隔离：非 owner 访问 Run 检查点返回 404；admin 端点 `requireAdmin`，非 admin 返回 404；
- 审计面只读，不提供任何写操作；admin 读取行为记入 trace；
- `state` 快照仅在详情端点返回，默认 UI 折叠展示；服务端写入前已有 `assertSafeJsonObject` 边界，API Key/token 等禁入检查点（设计稿 §7.2 既有约束）；
- 搜索参数长度与字符边界校验，防 `ILIKE` 注入参数膨胀。

## 7. 测试与验收口径

- 后端：route 集成测试覆盖分页/筛选/搜索/权限（owner 404、非 admin 404）、`resumeEligible` 计算与 `selectHarnessResumeCheckpoint` 一致性用例；
- 前端：focused tests 覆盖 `checkpointLabels.js` 词汇映射、URL search params 序列化/反序列化（§4.10 参数表）、时间轴对「恢复分隔带/虚线/角标」的条件渲染、`aria-live` 增量播报、`CheckpointDetailDrawer` 的 `variant='user'` 字段隐藏（Testing Library）；
- 视觉/交互验收：1440px 与 760px 浏览器证据、键盘可达（时间轴节点可聚焦、Drawer Esc 关闭、焦点回归到触发节点）、状态不只靠颜色表达、`prefers-reduced-motion` 下 pulse 静止；
- 命令：`npm run test:modules`、`npm run build:api`、`npm run build:web`、UI scope checker。

## 8. 落地分批与依赖

| 批次 | 内容 | 依赖 |
|---|---|---|
| C-OBS（API 检查点只读端点） | §3 全部端点（挂 `/ai-runs` 族 + `/system/ai-sessions/:sessionId/runs`）+ repository 查询扩展 + 测试 + openapi | Batch B/C 已集成（检查点在库、`ai-runs.routes.ts` 已接线） |
| D-OBS（前端检查点可观测表面） | §4 两个前端表面（CheckpointStrip + 会话管理下钻）+ hooks + 测试 + `wes-timeline-pulse` reduce 降级补丁 | C-OBS Gate 通过 |

两批均遵循 Qoder worktree 协议与 Codex Gate；不在本设计中合并主线或声明交付。D-OBS 启动前须先跑 `npx ui-skills start` 并执行 `skills/improving-wes-ui/SKILL.md` 全流程（单表面、≤3 根问题、浏览器证据）。

## 9. 决策记录（2026-08-09 用户拍板，原遗留决策点已关闭）

1. **审计入口**：扩展既有「系统管理 → 会话管理」（`/system/sessions`）页族下钻，**不新建** `/admin/session-audit`；原设计稿「当前不存在会话审计页」前提已修正（既有 `AiSessionAuditPanel.jsx`）。【已拍板】
2. **`state` 快照**：对所有角色（含 admin）默认折叠。【已拍板】
3. **端点路径**：检查点端点直接挂 `/ai-runs/:runId/checkpoints`（Batch C 已落地），不走 `/harness` 过渡；前端收口 `src/api/aiRuns.js`。【已拍板】

未决项（不阻塞 C-OBS 启动）：

- `/system/ai-sessions` 现有响应是否已含「是否有 Run」标识（决定会话列表「检查点」入口的禁用态逻辑），C-OBS 实现时核实并顺带补齐；
- Run active 轮询 5s 间隔与 Batch C SSE 事件流的关系：若会话页已订阅 `/ai-runs/:runId/events` SSE，CheckpointStrip 可改为事件驱动增量，留待 D-OBS 实现时按接线现状选型（不引入新依赖的前提不变）。

## 10. 高信号 findings（2026-08-09 评审，`文件:行` 格式）

规格文档（本次优化对象）：

```text
docs/…-ui-design.md:3（原） - 状态未标「未实现」→ 已修为「设计稿（待评审），未实现」
docs/…-ui-design.md:10（原） - 「不存在独立管理员会话审计页」与事实冲突 → 已修正为扩展既有 /system/sessions
docs/…-ui-design.md:154（原） - 筛选 300ms 防抖与既有面板 250ms 口径不一致 → 已统一 250ms
docs/…-ui-design.md:167（原） - 分隔带时间示例硬编码格式，未要求 Intl.DateTimeFormat → 已补
docs/…-ui-design.md:185-189（原） - 筛选控件 label / 空态文案 / URL 参数表缺失 → 已补 §4.5/§4.10/§4.11
docs/…-ui-design.md:216（原） - 未写虚拟化替代方案与阈值 → 已补 §5 权衡声明（>500 触发架构决策）
```

既有代码（支撑 finding，本批不改，归 D-OBS 或独立跟进）：

```text
ui/V2_PROTOTYPE/src/index.css:1037-1045 - F2：.wes-timeline-pulse 无 prefers-reduced-motion 降级（现有两处查询 :1186/:1551 均未覆盖）→ D-OBS 顺手补
ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx:153 / components.css:98 - F4：.wes-drawer__body 无 overscroll-behavior: contain → D-OBS 补
ui/V2_PROTOTYPE/src/utils/adminAccess.js:7 - isAdminOnlyPath 已含 /system 前缀，新下钻路由免新增守卫 ✓
ui/V2_PROTOTYPE/src/components/system/AiSessionAuditPanel.jsx:32-38 - 手工 pad 拼日期（违反 Intl 规则）；本次不改，D-OBS 可顺手统一
ui/V2_PROTOTYPE/src/components/system/AiSessionAuditPanel.jsx:70 - 「加载中...」用 ... 非 …；同上 D-OBS 顺手
ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/RunStageIndicator.jsx:78 - 既有 pulse span 用 aria-label 但无 role，读屏不播报；新组件按 §4.8 用 aria-live 文案替代该模式
ui/V2_PROTOTYPE/tokens.css:27-28 - --info 无 -ink 档；structural 徽章文字用 --ink-2，不新增令牌
apps/api/src/routes/ai-runs.routes.ts:43-51 / routes/index.ts:57 - Batch C 路由族已接线，checkpoint 端点直接入族 ✓
```

## 11. Gate 治理路径

| 阶段 | 门禁 | 通过标准 |
|---|---|---|
| C-OBS（API 检查点只读端点） | Codex Gate + Qoder worktree 协议 | route 集成测试绿（含权限 404）、`resumeEligible` 一致性用例、openapi 同步、handoff 回填「待 Codex 复核」 |
| D-OBS（前端检查点可观测表面） | 同上 + improving-wes-ui 全流程 + UI scope checker | §7 前端测试绿、1440/760 浏览器证据、§4.8 a11y 清单逐项验收、`npm run build:web` 绿 |

两批串行：D-OBS 不得先于 C-OBS Gate 通过启动；本规格状态保持「设计稿（待评审），未实现」，任何一批完成后只回填状态至「已回填 / 待复核」，不得自行宣布交付。
