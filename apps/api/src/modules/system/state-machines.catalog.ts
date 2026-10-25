// ============================================================
// 状态机目录 · 系统管理「状态机规则」可视化的唯一真源
// ============================================================
// 本文件把散落在各模块代码里的状态枚举与转换守卫，登记为结构化目录，
// 经 GET /api/v1/system/state-machines 只读输出给前端渲染。
//
// 维护规则（state-machines.catalog.test.ts + state-machines.capabilities.drift.test.ts 强制）：
//  · 修改任何对象的状态枚举或转换守卫时，必须同步更新本目录；
//  · 存在运行时枚举常量的对象，目录状态集与常量逐字一致（测试比对）；
//  · 尚未落地的流转以 implemented: false 如实标注，禁止虚构已实现。
//  · 每条流转的 trigger/guard 写的是「代码里真实存在的端点/判据」，
//    sourceRef 指向权威源码文件。
// ============================================================

export type StateMachineDomain = "business_object" | "version_document";

export type StateMachineStatus = {
  key: string;
  label: string;
  description: string;
  /** 终态：进入后不再流出（如 cancelled/completed） */
  terminal?: boolean;
};

export type StateMachineTransition = {
  from: string;
  to: string;
  /** 触发方式：真实端点或代码写入点 */
  trigger: string;
  /** 前置守卫：不满足即拒绝的判据（含错误码口径） */
  guard: string;
  /** false = 口径已定义但后端暂无写入路径 */
  implemented: boolean;
};

export type StateMachineAxis = {
  key: string;
  label: string;
  initial: string;
  statuses: StateMachineStatus[];
  transitions: StateMachineTransition[];
};

export type StateMachineDescriptor = {
  id: string;
  objectLabel: string;
  domain: StateMachineDomain;
  /** 权威源码位置（前端展示供溯源） */
  sourceRef: string;
  axes: StateMachineAxis[];
  /** 不随流转变化的硬约束 */
  invariants: string[];
};

export const STATE_MACHINE_CATALOG: StateMachineDescriptor[] = [
  // ---------------- 业务对象 ----------------
  {
    id: "project",
    objectLabel: "项目",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/project-evaluations/",
    axes: [
      {
        key: "status",
        label: "项目状态",
        initial: "draft",
        statuses: [
          { key: "draft", label: "草稿", description: "项目创建后的初始态（手动新建或 AI 工作台生成）" },
          { key: "active", label: "进行中", description: "枚举预留值，当前后端无写入点" },
          { key: "reviewing", label: "待评审", description: "AI 实施评估草稿已经人工确认" },
          { key: "published", label: "已发布", description: "评审通过后对外发布（流转未实现）", terminal: true },
          { key: "archived", label: "已归档", description: "结项归档（流转未实现）", terminal: true },
        ],
        transitions: [
          {
            from: "draft",
            to: "reviewing",
            trigger: "确认 AI 实施评估草稿 POST /api/v1/project-evaluations/assessment-drafts/:assessmentId/confirm",
            guard: "人工确认才流转；同步写 currentStage=manual_confirmed、aiDraftReviewStatus=confirmed",
            implemented: true,
          },
          {
            from: "draft",
            to: "active",
            trigger: "预留流转（当前无触发方）",
            guard: "枚举合法但未定义业务入口",
            implemented: false,
          },
          {
            from: "reviewing",
            to: "published",
            trigger: "评审通过发布（待实现）",
            guard: "暂无把 projectStatus 写为 published 的代码路径",
            implemented: false,
          },
          {
            from: "published",
            to: "archived",
            trigger: "结项归档（待实现）",
            guard: "暂无把 projectStatus 写为 archived 的代码路径",
            implemented: false,
          },
        ],
      },
    ],
    invariants: [
      "非法 projectStatus 仓储层兜底为 draft（normalizeProjectStatus）",
      "项目按 owner 隔离（listProjectEvaluationsForUser），不暴露跨 owner 项目",
      "项目容器落在 version_records（recordKind=project_evaluation，type=global）",
    ],
  },
  {
    id: "version_document",
    objectLabel: "版本文档（评估/需求/资源/开发/总方案）",
    domain: "version_document",
    sourceRef: "apps/api/src/types/index.ts + modules/versions/",
    axes: [
      {
        key: "status",
        label: "文档主状态",
        initial: "draft",
        statuses: [
          { key: "draft", label: "草稿", description: "新建记录的默认主状态" },
          { key: "reviewed", label: "已评审", description: "进入时自动补记 reviewedAt/reviewedBy（只记首次）" },
          { key: "published", label: "已发布", description: "对外发布口径，同样补记审核信息" },
          { key: "archived", label: "已归档", description: "归档态" },
        ],
        transitions: [
          {
            from: "draft",
            to: "reviewed",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "draft",
            to: "published",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "draft",
            to: "archived",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "reviewed",
            to: "draft",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "reviewed",
            to: "published",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "reviewed",
            to: "archived",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "published",
            to: "draft",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "published",
            to: "reviewed",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "published",
            to: "archived",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "archived",
            to: "draft",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "archived",
            to: "reviewed",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
          {
            from: "archived",
            to: "published",
            trigger: "PATCH /api/v1/versions/:recordId/status",
            guard: "需 estimates:write 与 admin/operator 且为本人 owner 记录；值域内不限定步进，非法值 40001；首次进入 reviewed/published 补记审核人与时间",
            implemented: true,
          },
        ],
      },
      {
        key: "checkout",
        label: "编辑锁（检出状态）",
        initial: "checked_in",
        statuses: [
          { key: "checked_in", label: "已检入", description: "只读态；新建记录默认「已检入的草稿」" },
          { key: "checked_out", label: "已检出", description: "排他编辑态，登记检出人与时刻" },
        ],
        transitions: [
          {
            from: "checked_in",
            to: "checked_out",
            trigger: "checkout POST /api/v1/versions/:id/checkout",
            guard: "非历史归档（40902）；versionDocStatus=reviewed 只读需先升版（40902）；未被他人占用——并发 CAS 恰一赢家",
            implemented: true,
          },
          {
            from: "checked_out",
            to: "checked_in",
            trigger: "checkin POST /api/v1/versions/:id/checkin",
            guard: "须检出态且检入人=检出人（40301/40902）；版本号 minor+1（A1→A2），行锁事务内递增",
            implemented: true,
          },
          {
            from: "checked_out",
            to: "checked_out",
            trigger: "save-draft PATCH /api/v1/versions/:id/save-draft",
            guard: "须检出态且检出人本人；只更新 payload，不递增版本号、不检入",
            implemented: true,
          },
          {
            from: "checked_out",
            to: "checked_in",
            trigger: "undo-checkout POST /api/v1/versions/:id/undo-checkout",
            guard: "仅检出人；丢弃修改，payload 回滚到检出时 lastCheckinPayload 快照",
            implemented: true,
          },
          {
            from: "checked_in",
            to: "checked_out",
            trigger: "promote POST /api/v1/versions/:id/promote（归档旧版，新版本直接处于已检出态）",
            guard: "须 checked_in + versionDocStatus=drafting + 非历史归档；新编码字母+1 数字归 1（A3→B1，检入后 B1→B2）",
            implemented: true,
          },
          {
            from: "checked_out",
            to: "checked_in",
            trigger: "force-unlock PATCH /api/v1/versions/:id/force-unlock",
            guard: "仅 system:manage（管理员）；用于持有人缺位时的锁治理",
            implemented: true,
          },
        ],
      },
      {
        key: "doc",
        label: "版本文档审核态",
        initial: "drafting",
        statuses: [
          { key: "drafting", label: "修订中", description: "可检出、可升版的活跃态（当前唯一代码写入值）" },
          { key: "reviewed", label: "已审核", description: "只读闸门：检出/升版被 CAS 拒绝；暂无当前写入端点" },
        ],
        transitions: [
          {
            from: "drafting",
            to: "reviewed",
            trigger: "文档审核标记（暂无现行写入端点，历史数据留档值）",
            guard: "reviewed 后 checkout CAS 拒绝（reviewed_readonly）、promote 拒绝（must_be_drafting）",
            implemented: false,
          },
        ],
      },
    ],
    invariants: [
      "checked_in 只读、checked_out 可编辑；状态只能由检出/检入等动作改变",
      "历史归档版本（isHistoricalArchive）不可检出、不可升版",
      "检入递增自然数、升版字母+1 且自然数归 1；baseCode 固定为首次检入前编码",
      "升版后状态以后端返回为准（新版本记录独立 id，旧版进归档）",
    ],
  },
  {
    id: "ai_session",
    objectLabel: "AI 会话",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/ai-sessions/",
    axes: [
      {
        key: "status",
        label: "会话阶段",
        initial: "temporary_chat",
        statuses: [
          { key: "temporary_chat", label: "临时对话", description: "默认态；非法值兜底进此态" },
          { key: "rough_estimate", label: "粗略评估", description: "会话进入粗估阶段" },
          { key: "project_discovery", label: "项目挖掘", description: "会话进入项目发现阶段" },
          { key: "requirement_drafting", label: "需求起草", description: "会话进入需求起草阶段" },
          { key: "assessment_drafting", label: "评估起草", description: "会话进入实施评估起草阶段" },
          { key: "standard_review", label: "标准评审", description: "标准治理域评审阶段" },
          { key: "standard_drafting", label: "标准起草", description: "标准治理域起草阶段" },
          { key: "linked_record", label: "已关联记录", description: "会话产物已关联版本记录" },
          { key: "archived", label: "已归档", description: "创建时可指定的阶段值，既有会话无归档入口" },
        ],
        transitions: [
          {
            from: "temporary_chat",
            to: "linked_record",
            trigger: "会话阶段更新（未实现）",
            guard: "createAiSession 仅在创建时归一化初始 status；POST /api/v1/sessions/:sessionId/events 不接收或更新会话 status",
            implemented: false,
          },
          {
            from: "linked_record",
            to: "archived",
            trigger: "会话归档（未实现）",
            guard: "现行仓储没有既有会话 status 更新方法，无法通过会话事件归档",
            implemented: false,
          },
        ],
      },
    ],
    invariants: [
      "阶段值仅在创建会话时指定（非法兜底 temporary_chat）；既有会话阶段流转无现行写入入口",
      "域二值：business_evaluation / standard_governance",
    ],
  },
  {
    id: "ai_artifact",
    objectLabel: "AI 会话产物",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/ai-sessions/ai-sessions.usecase.ts",
    axes: [
      {
        key: "status",
        label: "产物状态",
        initial: "generated",
        statuses: [
          { key: "generated", label: "已生成", description: "默认态；非法值兜底进此态" },
          { key: "accepted", label: "已采纳", description: "顾问采纳产物内容" },
          { key: "linked", label: "已关联", description: "产物已关联版本记录" },
          { key: "superseded", label: "已被取代", description: "新增产物可指定的状态值，无既有产物更新入口" },
          { key: "discarded", label: "已丢弃", description: "新增产物可指定的状态值，无既有产物更新入口" },
        ],
        transitions: [
          {
            from: "generated",
            to: "accepted",
            trigger: "既有产物采纳状态更新（未实现）",
            guard: "appendAiSessionEvent 归一化新增产物初始 status（非法兜底 generated），仓储只追加数组，不修改既有产物",
            implemented: false,
          },
          {
            from: "accepted",
            to: "linked",
            trigger: "既有产物关联状态更新（未实现）",
            guard: "现行仓储没有既有产物 status 更新方法；相同 artifactId 的追加也不替换旧项",
            implemented: false,
          },
        ],
      },
    ],
    invariants: ["会话事件可追加任意合法初态的新产物；既有产物状态变更无现行入口，不能把追加初态视为流转"],
  },
  {
    id: "harness_run",
    objectLabel: "Harness Run（AI 异步任务）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/harness/harness.types.ts + harness-runtime.types.ts",
    axes: [
      {
        key: "status",
        label: "Run 状态",
        initial: "queued",
        statuses: [
          { key: "queued", label: "排队中", description: "活动态；提交后等待 worker" },
          { key: "running", label: "执行中", description: "活动态；worker 持有租约执行" },
          { key: "waiting", label: "等待输入", description: "活动态；等待用户确认动作/补充信息" },
          { key: "recovering", label: "恢复中", description: "活动态；租约过期后接管恢复" },
          { key: "cancelling", label: "取消中", description: "活动态；取消请求已受理" },
          { key: "completed", label: "已完成", description: "终态", terminal: true },
          { key: "failed", label: "已失败", description: "终态", terminal: true },
          { key: "cancelled", label: "已取消", description: "终态", terminal: true },
        ],
        transitions: [
          {
            from: "queued",
            to: "running",
            trigger: "worker claim（领取任务并建立租约）",
            guard: "租约 + heartbeat 机制维持活动性",
            implemented: true,
          },
          {
            from: "running",
            to: "waiting",
            trigger: "任务产生待确认动作（pending action）",
            guard: "等待用户 confirm/cancel 后回到 running",
            implemented: true,
          },
          {
            from: "running",
            to: "completed",
            trigger: "步骤链执行完毕，产出 final 输出",
            guard: "终态不可再流转（RUN_ALREADY_TERMINAL）",
            implemented: true,
          },
          {
            from: "running",
            to: "failed",
            trigger: "执行异常/护栏拦截",
            guard: "终态不可再流转",
            implemented: true,
          },
          {
            from: "running",
            to: "cancelling",
            trigger: "取消请求 POST（run 取消接口）",
            guard: "仅非终态可发起；已进入终态返回 RUN_ALREADY_TERMINAL",
            implemented: true,
          },
          {
            from: "cancelling",
            to: "cancelled",
            trigger: "worker 感知取消标记后收敛",
            guard: "终态",
            implemented: true,
          },
          {
            from: "running",
            to: "recovering",
            trigger: "租约过期，系统接管恢复",
            guard: "attempt 标记 orphaned 后重建执行",
            implemented: true,
          },
        ],
      },
    ],
    invariants: [
      "活动态集合 = queued/running/waiting/recovering/cancelling；终态集合 = completed/failed/cancelled（常量权威）",
      "取消是异步两段式：*→cancelling→cancelled，不做瞬断",
    ],
  },
  {
    id: "harness_attempt",
    objectLabel: "Harness 执行尝试（Attempt）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/harness/harness-runtime.types.ts",
    axes: [
      {
        key: "status",
        label: "Attempt 状态",
        initial: "claimed",
        statuses: [
          { key: "claimed", label: "已领取", description: "worker claim 成功" },
          { key: "running", label: "执行中", description: "心跳持续上报" },
          { key: "succeeded", label: "已成功", description: "终态", terminal: true },
          { key: "failed", label: "已失败", description: "终态", terminal: true },
          { key: "orphaned", label: "已失联", description: "租约过期未续，等待接管", terminal: true },
          { key: "cancelled", label: "已取消", description: "终态", terminal: true },
        ],
        transitions: [
          {
            from: "claimed",
            to: "running",
            trigger: "worker 开始执行",
            guard: "租约 leaseExpiresAt + heartbeatAt 维护",
            implemented: true,
          },
          {
            from: "running",
            to: "succeeded",
            trigger: "单步尝试成功",
            guard: "终态",
            implemented: true,
          },
          {
            from: "running",
            to: "failed",
            trigger: "尝试失败（可触发 run 恢复/终局）",
            guard: "终态",
            implemented: true,
          },
          {
            from: "running",
            to: "orphaned",
            trigger: "租约到期未心跳，被扫描标记",
            guard: "run 转入 recovering 重建执行",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["attemptNo 递增记录每次尝试；orphaned 是失联判定而非业务失败"],
  },
  {
    id: "harness_action",
    objectLabel: "Harness 待确认动作（Action）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/harness/harness.types.ts + harness.usecase.ts",
    axes: [
      {
        key: "status",
        label: "动作状态",
        initial: "pending",
        statuses: [
          { key: "pending", label: "待确认", description: "写动作默认态——AI 只提议不自动执行" },
          { key: "confirmed", label: "已确认", description: "用户确认后进入执行队列" },
          { key: "executed", label: "已执行", description: "终态", terminal: true },
          { key: "cancelled", label: "已取消", description: "用户/run 取消联动", terminal: true },
          { key: "failed", label: "已失败", description: "执行失败", terminal: true },
        ],
        transitions: [
          {
            from: "pending",
            to: "confirmed",
            trigger: "用户确认动作（harness confirm 接口，usecase 写入）",
            guard: "仅 pending 可确认；run 由 waiting 回到 running",
            implemented: true,
          },
          {
            from: "pending",
            to: "cancelled",
            trigger: "用户取消或 run 取消级联（repository 批量置 cancelled）",
            guard: "仅未确认动作可取消",
            implemented: true,
          },
          {
            from: "confirmed",
            to: "executed",
            trigger: "worker 执行确认后的动作",
            guard: "幂等键防重复执行",
            implemented: true,
          },
          {
            from: "confirmed",
            to: "failed",
            trigger: "执行失败路径（usecase 写 failed）",
            guard: "终态",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["写动作类请求只返回待确认动作，不自动执行（AGENTS.md AI 工作台边界）"],
  },
  {
    id: "harness_output",
    objectLabel: "Harness 输出（Artifact 内容）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/harness/harness-runtime.types.ts",
    axes: [
      {
        key: "status",
        label: "输出状态",
        initial: "partial",
        statuses: [
          { key: "partial", label: "阶段性", description: "执行过程中的中间输出" },
          { key: "final", label: "终稿", description: "run 完成后的定稿输出" },
        ],
        transitions: [
          {
            from: "partial",
            to: "final",
            trigger: "run 收敛完成时定稿",
            guard: "version 字段随覆写递增",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["partial→final 是发布语义，不是执行状态"],
  },
  {
    id: "manual_test_result",
    objectLabel: "人工测试结果",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/harness/harness.types.ts（MANUAL_TEST_RESULT_STATUSES）",
    axes: [
      {
        key: "result",
        label: "执行结论",
        initial: "passed",
        statuses: [
          { key: "passed", label: "通过", description: "用例执行通过" },
          { key: "failed", label: "失败", description: "用例执行失败" },
          { key: "blocked", label: "阻塞", description: "受依赖/环境阻塞无法执行" },
          { key: "skipped", label: "跳过", description: "本轮不执行" },
        ],
        transitions: [],
      },
    ],
    invariants: ["登记即结论：以登记/覆写为主，无步进状态机", "metadata 保留账号、截图等佐证"],
  },
  {
    id: "change_submission",
    objectLabel: "变更提交",
    domain: "business_object",
    sourceRef: "apps/api/src/db/schema/change_submissions.ts + routes/change.routes.ts",
    axes: [
      {
        key: "status",
        label: "变更状态",
        initial: "submitted",
        statuses: [
          { key: "submitted", label: "已提交", description: "创建默认态" },
          { key: "reviewed", label: "已评审", description: "枚举预留：暂无独立评审写入端点" },
          { key: "merged", label: "已合并", description: "变更生效", terminal: true },
          { key: "rejected", label: "已驳回", description: "变更驳回", terminal: true },
        ],
        transitions: [
          {
            from: "submitted",
            to: "merged",
            trigger: "POST /api/v1/change/change-submissions/:id/merge",
            guard: "需 man-day:adjust 能力位",
            implemented: true,
          },
          {
            from: "submitted",
            to: "rejected",
            trigger: "POST /api/v1/change/change-submissions/:id/reject",
            guard: "需 man-day:adjust 或 deliverable:reject 能力位",
            implemented: true,
          },
          {
            from: "submitted",
            to: "reviewed",
            trigger: "评审中间态（待实现）",
            guard: "枚举合法但无现行写入端点",
            implemented: false,
          },
        ],
      },
    ],
    invariants: ["父实体三类：opportunity_brief / requirement_pack / assessment_version", "merge/reject 为终局动作，幂等由后端裁决"],
  },
  {
    id: "dev_assessment",
    objectLabel: "开发评估",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/dev-assessment/",
    axes: [
      {
        key: "status",
        label: "开发评估状态",
        initial: "draft",
        statuses: [
          { key: "draft", label: "草稿", description: "创建初始态" },
          { key: "in_progress", label: "进行中", description: "AI 生成回填后写入（usecase）" },
          { key: "review_pending", label: "待复核", description: "提交复核" },
          { key: "confirmed", label: "已确认", description: "复核确认" },
          { key: "merged", label: "已合并", description: "并入总方案", terminal: true },
        ],
        transitions: [
          {
            from: "draft",
            to: "in_progress",
            trigger: "AI 评估结果落库（dev-assessment.usecase）",
            guard: "PATCH 更新时 status 必须命中五态白名单，否则忽略该字段",
            implemented: true,
          },
          {
            from: "in_progress",
            to: "review_pending",
            trigger: "PATCH /dev-assessments 状态流转（白名单校验）",
            guard: "同上",
            implemented: true,
          },
          {
            from: "review_pending",
            to: "confirmed",
            trigger: "PATCH 复核确认",
            guard: "同上",
            implemented: true,
          },
          {
            from: "confirmed",
            to: "merged",
            trigger: "PATCH 并入总方案",
            guard: "同上",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["contractMode 二值：embedded / separate，与状态机正交"],
  },
  {
    id: "sales_briefing",
    objectLabel: "售前简报",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/sales-briefing/",
    axes: [
      {
        key: "status",
        label: "简报状态",
        initial: "open",
        statuses: [
          { key: "open", label: "进行中", description: "创建默认态" },
          { key: "converted", label: "已转化", description: "转化为需求包" },
          { key: "abandoned", label: "已放弃", description: "商机放弃" },
        ],
        transitions: [
          {
            from: "open",
            to: "converted",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "open",
            to: "abandoned",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "converted",
            to: "open",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "converted",
            to: "abandoned",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "abandoned",
            to: "open",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "abandoned",
            to: "converted",
            trigger: "PATCH /api/v1/sales/briefs/:id",
            guard: "需 estimates:create；status 仅接受 open|converted|abandoned，非法值忽略该字段；无前态限制",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["status 为 open/converted/abandoned 值域约束，不构成不可逆终态；linkedRequirementPackId 为独立可选更新字段"],
  },
  {
    id: "collab_question",
    objectLabel: "协作问题（消息）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/collab/",
    axes: [
      {
        key: "status",
        label: "问题状态",
        initial: "open",
        statuses: [
          { key: "open", label: "待解决", description: "question 类消息创建默认态" },
          { key: "resolved", label: "已解决", description: "非 question 消息创建即 resolved" },
          { key: "closed", label: "已关闭", description: "可通过通用更新重新打开" },
        ],
        transitions: [
          {
            from: "open",
            to: "resolved",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "open",
            to: "closed",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "resolved",
            to: "open",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "resolved",
            to: "closed",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "closed",
            to: "open",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
          {
            from: "closed",
            to: "resolved",
            trigger: "PATCH /api/v1/collab/messages/:messageId",
            guard: "需 evidence:write；status 仅接受 open|resolved|closed，非法值忽略该字段；无前态限制",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["工作空间统计只数 question 且 status=open 的消息"],
  },
  {
    id: "team_review",
    objectLabel: "团队评审",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/team/team.types.ts + team.usecase.ts",
    axes: [
      {
        key: "status",
        label: "评审状态",
        initial: "open",
        statuses: [
          { key: "open", label: "进行中", description: "创建默认态" },
          { key: "closed", label: "已关闭", description: "可重新打开" },
        ],
        transitions: [
          {
            from: "open",
            to: "closed",
            trigger: "PATCH /api/v1/teams/:teamId/reviews/:reviewId/status",
            guard: "需 deliverable:review 或 deliverable:reject，且为团队 manager；仅接受 open|closed，非法值拒绝并返回 42201；无前态限制",
            implemented: true,
          },
          {
            from: "closed",
            to: "open",
            trigger: "PATCH /api/v1/teams/:teamId/reviews/:reviewId/status",
            guard: "需 deliverable:review 或 deliverable:reject，且为团队 manager；仅接受 open|closed，非法值拒绝并返回 42201；无前态限制",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["评审可关闭与重开；更新需团队 manager，持久化使用版本冲突检查（40909）"],
  },
  {
    id: "knowledge_entry",
    objectLabel: "知识库条目",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/knowledge/knowledge-pg.repository.ts + routes/knowledge.routes.ts",
    axes: [
      {
        key: "status",
        label: "条目状态",
        initial: "active",
        statuses: [
          { key: "draft", label: "草稿", description: "仓储更新可设为草稿" },
          { key: "active", label: "生效", description: "创建默认态，参与检索召回" },
          { key: "archived", label: "已归档", description: "退出检索", terminal: true },
        ],
        transitions: [
          {
            from: "draft",
            to: "active",
            trigger: "KnowledgePgRepository.update(id, { status })",
            guard: "现有条目不可为 archived（否则 KNOWLEDGE_ENTRY_ARCHIVED）；仓储直接应用 patch.status，不限制 draft/active 双向；当前无 HTTP 更新端点",
            implemented: true,
          },
          {
            from: "active",
            to: "draft",
            trigger: "KnowledgePgRepository.update(id, { status })",
            guard: "现有条目不可为 archived（否则 KNOWLEDGE_ENTRY_ARCHIVED）；仓储直接应用 patch.status，不限制 draft/active 双向；当前无 HTTP 更新端点",
            implemented: true,
          },
          {
            from: "active",
            to: "archived",
            trigger: "POST /api/v1/knowledge/entries/:entryId/archive",
            guard: "需 system:manage；条目存在，否则 KNOWLEDGE_ENTRY_NOT_FOUND；仓储 archive 不限制前态，可重复归档",
            implemented: true,
          },
          {
            from: "draft",
            to: "archived",
            trigger: "POST /api/v1/knowledge/entries/:entryId/archive",
            guard: "需 system:manage；条目存在，否则 KNOWLEDGE_ENTRY_NOT_FOUND；仓储 archive 不限制前态，可重复归档",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["archived 条目不可 update（KNOWLEDGE_ENTRY_ARCHIVED），但可重复 archive；draft/active 无单向步进限制", "检索语料只含非 archived 条目（knowledge.retrieval 测试锚定）"],
  },
  {
    id: "memory",
    objectLabel: "跨会话记忆（原子/场景）",
    domain: "business_object",
    sourceRef: "apps/api/src/modules/memory/memory.controller.ts + memory.usecase.ts + memory.repository.ts",
    axes: [
      {
        key: "status",
        label: "记忆状态",
        initial: "draft",
        statuses: [
          { key: "draft", label: "草稿", description: "schema 默认态；蒸馏产出先落 draft" },
          { key: "active", label: "生效", description: "确认注入后参与跨会话记忆" },
          { key: "archived", label: "已归档", description: "退出注入，可重新确认恢复 active" },
        ],
        transitions: [
          {
            from: "draft",
            to: "active",
            trigger: "POST /api/v1/memory/atoms/confirm；POST /api/v1/memory/scenes/confirm",
            guard: "JWT 身份派生 ownerUserId；请求体 memoryIds 校验（非法 INVALID_BODY/422）；仓储仅按 id + ownerUserId 隔离更新，不限制前态",
            implemented: true,
          },
          {
            from: "archived",
            to: "active",
            trigger: "POST /api/v1/memory/atoms/confirm；POST /api/v1/memory/scenes/confirm",
            guard: "JWT 身份派生 ownerUserId；请求体 memoryIds 校验（非法 INVALID_BODY/422）；仓储仅按 id + ownerUserId 隔离更新，不限制前态",
            implemented: true,
          },
          {
            from: "active",
            to: "archived",
            trigger: "POST /api/v1/memory/atoms/archive；POST /api/v1/memory/scenes/archive",
            guard: "JWT 身份派生 ownerUserId；请求体 memoryIds 校验（非法 INVALID_BODY/422）；仓储仅按 id + ownerUserId 隔离更新，不限制前态",
            implemented: true,
          },
          {
            from: "draft",
            to: "archived",
            trigger: "POST /api/v1/memory/atoms/archive；POST /api/v1/memory/scenes/archive",
            guard: "JWT 身份派生 ownerUserId；请求体 memoryIds 校验（非法 INVALID_BODY/422）；仓储仅按 id + ownerUserId 隔离更新，不限制前态",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["原子与场景共用同一状态值域 draft/active/archived", "confidence 数值与状态正交（默认 80）"],
  },
  {
    id: "user_account",
    objectLabel: "用户账号",
    domain: "business_object",
    sourceRef: "apps/api/src/db/schema/users.ts + modules/auth/auth.usecase.ts",
    axes: [
      {
        key: "status",
        label: "账号状态",
        initial: "active",
        statuses: [
          { key: "active", label: "启用", description: "schema 默认态，可登录" },
          { key: "disabled", label: "停用", description: "禁止登录，可恢复" },
        ],
        transitions: [
          {
            from: "active",
            to: "disabled",
            trigger: "PATCH /api/v1/auth/users/:userId/status",
            guard: "admin 起；不能停用自己（cannot_disable_self）；sub_admin 不能停 admin",
            implemented: true,
          },
          {
            from: "disabled",
            to: "active",
            trigger: "PATCH 同接口（status≠disabled 一律落 active）",
            guard: "同上角色约束",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["角色三值 admin|sub_admin|user；首个注册用户为 admin", "业务角色 businessRole 与账号状态正交"],
  },
  {
    id: "runtime_token",
    objectLabel: "一次性令牌（邀请码/密码重置）",
    domain: "business_object",
    sourceRef: "apps/api/src/db/schema/json_runtime.ts",
    axes: [
      {
        key: "status",
        label: "令牌状态",
        initial: "active",
        statuses: [
          { key: "active", label: "可用", description: "schema 默认态" },
          { key: "used", label: "已使用", description: "一次性消费后终态", terminal: true },
        ],
        transitions: [
          {
            from: "active",
            to: "used",
            trigger: "核销（注册使用邀请码 / 重置密码消费 token）",
            guard: "一次性：used 不可复用；重置 token 另有过期时间 expiresAt",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["令牌类禁止硬删，历史留档（已切换 PostgreSQL 存储）"],
  },
  {
    id: "version_code_rule",
    objectLabel: "版本号编码规则",
    domain: "business_object",
    sourceRef: "apps/api/src/types/index.ts + modules/system/system.usecase.ts",
    axes: [
      {
        key: "status",
        label: "规则状态",
        initial: "draft",
        statuses: [
          { key: "draft", label: "草稿", description: "disabled 规则改配置后回到 draft" },
          { key: "active", label: "生效", description: "编码取号只认 active 规则（含 effectiveAt）" },
          { key: "disabled", label: "停用", description: "退出取号候选" },
        ],
        transitions: [
          {
            from: "draft",
            to: "active",
            trigger: "activateVersionCodeRule POST /system/version-code-rules/:ruleId/activate",
            guard: "requireAdmin；激活同时写 effectiveAt",
            implemented: true,
          },
          {
            from: "active",
            to: "disabled",
            trigger: "disableVersionCodeRule POST .../disable",
            guard: "requireAdmin",
            implemented: true,
          },
          {
            from: "disabled",
            to: "draft",
            trigger: "updateVersionCodeRuleConfig PATCH .../config",
            guard: "disabled 规则一经编辑自动回 draft（system.usecase L205）",
            implemented: true,
          },
        ],
      },
    ],
    invariants: ["同 moduleKey 同一时刻仅一条 active；store 数组顺序对 UI 可见（sortOrder 保序）"],
  },
  {
    id: "master_data",
    objectLabel: "主数据（行业/产品/SKU/模块/标准人天）",
    domain: "business_object",
    sourceRef: "apps/api/src/db/schema/industry.ts + product_master_data.ts",
    axes: [
      {
        key: "status",
        label: "启用状态",
        initial: "active",
        statuses: [
          { key: "active", label: "启用", description: "新单据可选" },
          { key: "inactive", label: "停用", description: "新单据选不到，历史记录照常显示" },
        ],
        transitions: [
          {
            from: "active",
            to: "inactive",
            trigger: "setStatus 端点（行业/产品四条 controller 同构）",
            guard: "仅接受 active|inactive，其余 40001（MASTER_DATA_INVALID）",
            implemented: true,
          },
          {
            from: "inactive",
            to: "active",
            trigger: "setStatus 同端点重新启用",
            guard: "同上",
            implemented: true,
          },
        ],
      },
    ],
    invariants: [
      "只停用、禁止硬删（外键 onDelete: restrict 挡删除）",
      "status 值域沿用全仓约定：text + drizzle enum 选项做 TS 约束，不建 PG CHECK",
    ],
  },
  {
    id: "wbs_task",
    objectLabel: "WBS 任务",
    domain: "business_object",
    sourceRef: "02_产品设计/产品闭环收敛清单-V1.md §1 + modules(wbs)",
    axes: [
      {
        key: "status",
        label: "任务状态",
        initial: "未开始",
        statuses: [
          { key: "未开始", label: "未开始", description: "派生视图初始态" },
          { key: "进行中", label: "进行中", description: "任务执行中" },
          { key: "已完成", label: "已完成", description: "任务完成", terminal: true },
        ],
        transitions: [
          {
            from: "未开始",
            to: "进行中",
            trigger: "任务编辑与持久化（二轮需求，未实现）",
            guard: "MVP 为只读派生视图，按最新 global 版本生成任务行",
            implemented: false,
          },
          {
            from: "进行中",
            to: "已完成",
            trigger: "任务编辑与持久化（二轮需求，未实现）",
            guard: "同上",
            implemented: false,
          },
        ],
      },
    ],
    invariants: ["首发 MVP 只读：展示派生来源 sourceGlobalVersionRecordId 与 moduleKey 关联"],
  },
];
