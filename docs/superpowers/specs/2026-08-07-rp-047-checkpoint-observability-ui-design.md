# RP-047 检查点可观测性与可交互性 UI 设计（Checkpoint Observability）

> 状态：设计稿（待评审）。归属 RP-047 后续批次，建议拆为 C-OBS（API 契约）与 D-OBS（前端表面）两批串行落地，遵循 post-A2 roadmap 的 Gate 机制。
>
> 前置事实（2026-08-07 核实）：
> - 检查点数据已落 `harness_run_checkpoints`（PostgreSQL，RP-047 Batch A2，`apps/api/src/db/schema/harness.ts`）；
> - `harness-runtime.repository.ts` 已有 `listCheckpointsForRun`（按 sequence 倒序），**尚未暴露任何 HTTP 端点**；
> - 恢复链路事件词汇已冻结：`checkpoint_committed` / `recovery_started` / `recovery_completed` / `run_failed`（`harness-runtime.types.ts`）；Attempt 行携带 `resumeCheckpointId` / `resumeCheckpointKey`（恢复来源）；
> - 兼容性选择逻辑在 `selectHarnessResumeCheckpoint`（workflow 版本匹配 + stateHash 重算 + effectKeys 归属 + resumePolicy 非 manual）；失败码 `RECOVERY_CHECKPOINT_INCOMPATIBLE` / `RECOVERY_LIMIT_EXCEEDED`；
> - 前端主线 `ui/V2_PROTOTYPE`（Vite 5 + React 18.3），`tokens.css` 令牌体系，`Dialog` / `Drawer` / `ToastContainer` 共享组件；`StatusPanel/RunStageIndicator.jsx` 已有时间轴模式可复用；当前**不存在**独立管理员会话审计页面，本设计一并定义。

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

挂在现有 `/api/v1/harness`（Batch C 的 `ai-runs.routes.ts` 落地后迁移对齐，路径以 Batch C 为准）。全部 JWT 鉴权，响应 `{ code, message, data }`。

### 3.1 `GET /harness/runs/:runId/checkpoints`

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

### 3.2 `GET /harness/runs/:runId/checkpoints/:checkpointId`

返回完整详情：视图模型全字段 + `effectKeys` 全量 + `state` 结构化快照（已过 `assertSafeJsonObject` 边界）+ 该检查点相关的恢复事件（若 `usedForResume`）。

### 3.3 管理员审计端点

```
GET /api/v1/admin/audit/sessions?ownerUsername=&status=&q=&limit=&offset=
GET /api/v1/admin/audit/sessions/:sessionId/runs
```

- `requireAdmin`（与用户管理同口径）；非 admin 一律 404。
- 只读；审计访问本身写入 trace 域（沿用 `modules/trace`），满足审计追溯。
- Run 下的检查点读取复用 3.1/3.2（admin 身份绕过 owner 校验但记审计日志）。

### 3.4 openapi.yaml 同步

四个新端点全部补进 `docs/openapi.yaml`，并按需更新 `03_技术设计/系统演进/实现与文档对齐说明.md`。

## 4. 前端表面

### 4.1 表面 A：AI 工作台 StatusPanel「执行检查点」（用户视角，轻量）

落点：`ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/CheckpointStrip.jsx`（新建，≤200 行），作为 `StatusPanel/index.jsx` 的新分区，不改动 `RunStageIndicator` 既有四步时间线。

行为：

- 仅当会话存在关联 Harness Run 且检查点数 ≥1 时渲染；
- 紧凑横向时间轴：最近 8 个检查点节点 + 「共 N 个 · 查看」入口；
- Run active 时 5s 轮询 `afterSequence` 增量追加；Run terminal 后停止轮询；
- 发生过恢复时显示一条醒目提示条：「已自动恢复 1 次，从检查点 `input_committed` 续跑」，点击进入详情 Drawer；
- 点击任意节点 → 复用表面 B 的 `CheckpointDetailDrawer`（同一组件，用户视角隐藏 admin 专属字段）。

### 4.2 表面 B：管理员会话审计页（新建页面族）

路由（`App.jsx`，admin 守卫，非 admin 访问重定向 `/`）：

```
/admin/session-audit            → SessionAuditList（会话列表 + 筛选）
/admin/session-audit/:sessionId → SessionAuditDetail（Run 列表）
/admin/session-audit/:sessionId/runs/:runId → RunCheckpointAudit（检查点主界面）
```

文件结构（遵守页面分模块约定，单文件 ≤200 行）：

```
ui/V2_PROTOTYPE/src/pages/SessionAudit/
├── index.jsx                    # 路由出口（≤100 行）
├── SessionAuditList.jsx         # 会话列表：用户/状态/Run 数/检查点数/时间
├── RunCheckpointAudit.jsx       # 主界面：工具栏 + 时间轴 + 表格双视图
├── hooks/
│   ├── useCheckpoints.js        # 分页、筛选、增量轮询、useMemo 派生
│   └── useAuditSession.js       # 会话/Run 列表加载
├── components/
│   ├── CheckpointTimeline.jsx   # 垂直时间轴（含 attempt 分隔带）
│   ├── CheckpointTable.jsx      # 密集表格视图
│   ├── CheckpointFilterBar.jsx  # 筛选 + 搜索（300ms 防抖）
│   ├── CheckpointDetailDrawer.jsx  # 详情抽屉（复用 surfaces A/B）
│   └── ResumeLineagePanel.jsx   # 恢复谱系面板
└── utils/checkpointLabels.js    # §2.3 词汇映射（唯一来源，供单测）
```

主界面布局：顶部筛选栏；中部「时间轴 / 表格」视图切换（默认时间轴）；右侧 Drawer 详情。

### 4.3 时间轴设计（CheckpointTimeline）

垂直时间轴，自上而下 sequence 递增（最新在底部，自动滚动到底；提供「倒序」开关）：

- **节点形状编码 kind**（不只靠颜色）：structural=实心圆、semantic=菱形、combined=双环；
- **attempt 分隔带**：每次恢复插入一条 `--accent` 分隔条：「⚡ 第 N 次尝试 · 从 `#k checkpointKey` 恢复 · 2026-08-07 10:32:05」，恢复产生的检查点节点左侧连接线改为**虚线**，节点右上角加 ↻ 角标——这是「恢复后检查点」的主视觉区分；
- **活跃态**：Run active 时最新节点套用既有 `wes-timeline-pulse` 动画；Run terminal 后全部静态；
- **兼容性**：`resumeEligible=false` 节点降饱和（灰化）并在旁注「不可自动恢复」+ `?` Tooltip 解释原因（版本不匹配 / 校验失败 / manual 策略）；`runtimeValidation.checks` 有失败项时节点加 `--err` 感叹号角标；
- **被用作恢复来源的检查点**：节点加 `--accent` 描边，hover 提示「此检查点被第 N+1 次尝试用作恢复起点」。

### 4.4 详情 Drawer（CheckpointDetailDrawer）

复用 `components/ui/Drawer.jsx`，内容分区：

1. **标识区**：`checkpointKey`（`--font-mono` + 复制按钮）、kind 徽章、`#sequence`、创建时间；
2. **恢复语义区**：resumePolicy 徽章 + 一句话解释（如「恢复时跳过本检查点，直接执行下一步骤」）；stepKey、workflowVersion；
3. **完整性区**：stateHash / inputHash（等宽、前 12 字符 + 复制全量）；runtimeValidation 五项清单（✓/✗ 图标 + 文字，不只靠颜色）；effectKeys 计数（详情展开全量列表）；
4. **语义里程碑区**（semantic/combined）：`aiMilestone.label` / summary；
5. **状态快照区**：默认折叠，展开以 JSON 树只读渲染 `state`；区域顶部固定安全提示「快照已在服务端脱敏，请勿粘贴外部敏感信息」；
6. **恢复来源区**（仅恢复后检查点）：ResumeLineagePanel——来源检查点（可点击跳转该检查点详情）、recovery_started/completed 时间、退避次数、失败码（如有）；来源检查点不存在时显示「来源检查点已随 attempt 清理」占位文案。

### 4.5 筛选与搜索（CheckpointFilterBar）

- 多选芯片：类型（3 项）、恢复策略（3 项）、恢复状态（正常创建 / 恢复后 / 曾被用作恢复源）、兼容性（可自动恢复 / 不可 / 仅人工）；
- attempt 下拉、时间范围（今天 / 24h / 7d / 自定义双输入）；
- 搜索框：checkpointKey / stepKey / 里程碑标签，300ms 防抖，服务端 `q` 参数执行；
- 筛选条件编码进 URL search params（审计页可分享链接）；
- 筛选/搜索命中数为 0 时给出明确空态与「清除全部筛选」按钮。

### 4.6 视觉令牌映射（不新增令牌优先）

| 语义 | 令牌 |
|---|---|
| structural / semantic / combined 徽章底色 | `--info-soft` / `--chart-5`（描边） / `--brand-soft` |
| 恢复分隔带与 ↻ 角标 | `--accent` / `--accent-soft` |
| 兼容性失败角标 | `--err` / `--err-soft` |
| 活跃 pulse | 复用 `.wes-timeline-pulse` |
| 灰化不可恢复 | `--ink-3` + `opacity:.55` |
| 哈希/键值文本 | `--font-mono` |

确需新增令牌时，只加到 `tokens.css` 并附注释，不做组件库迁移。

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

不引入虚拟滚动库：分页 + 哨兵加载在当前数据规模（单 Run 检查点通常 <500）下足够；若后续实测超出，再走独立架构决策。

## 6. 安全与权限

- 所有端点 JWT；owner 隔离：非 owner 访问 Run 检查点返回 404；admin 端点 `requireAdmin`，非 admin 返回 404；
- 审计面只读，不提供任何写操作；admin 读取行为记入 trace；
- `state` 快照仅在详情端点返回，默认 UI 折叠展示；服务端写入前已有 `assertSafeJsonObject` 边界，API Key/token 等禁入检查点（设计稿 §7.2 既有约束）；
- 搜索参数长度与字符边界校验，防 `ILIKE` 注入参数膨胀。

## 7. 测试与验收口径

- 后端：route 集成测试覆盖分页/筛选/搜索/权限（owner 404、非 admin 404）、`resumeEligible` 计算与 `selectHarnessResumeCheckpoint` 一致性用例；
- 前端：focused tests 覆盖 `checkpointLabels.js` 词汇映射、筛选参数序列化、时间轴对「恢复分隔带/虚线/角标」的条件渲染（Testing Library）；
- 视觉/交互验收：1440px 与 760px 浏览器证据、键盘可达（时间轴节点可聚焦、Drawer Esc 关闭）、状态不只靠颜色表达；
- 命令：`npm run test:modules`、`npm run build:api`、`npm run build:web`、UI scope checker。

## 8. 落地分批与依赖

| 批次 | 内容 | 依赖 |
|---|---|---|
| C-OBS | §3 全部端点 + repository 查询扩展 + 测试 + openapi | Batch B 已集成（检查点/恢复事件在库） |
| D-OBS | §4 两个前端表面 + hooks + 测试 | C-OBS Gate 通过 |

两批均遵循 Qoder worktree 协议与 Codex Gate；不在本设计中合并主线或声明交付。

## 9. 遗留决策点（评审时确认）

1. admin 审计入口位置：独立 `/admin/session-audit` 路由（本设计推荐）vs 并入 `/users` 页族右侧工作区；
2. `state` 快照对 admin 是否默认展开（本设计：默认折叠）；
3. Batch C 的 `ai-runs.routes.ts` 落地后，3.1/3.2 是否迁移至 `/ai-sessions/:sessionId/runs/:runId/checkpoints` 路径族（本设计：先挂 `/harness`，Batch C 时统一迁移，前端经 `src/api/harness.js` 收口所以只改一处）。
