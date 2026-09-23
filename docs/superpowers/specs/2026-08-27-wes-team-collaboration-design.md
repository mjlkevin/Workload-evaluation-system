# WES 团队协作系统设计（P0 + 成员维护）

**版本** | 2026-08-27  
**状态** | 评审通过，待编码  
**所有者** | Kevin (mjlkevin@fufeishangban.com)  
**分期** | P0 首期（只读上下文 + 成员维护） / P1（通用评论 + collab workspace） / P2（实时协同 + 看板）  

---

## 1. 背景与需求

### 1.1 用户需求

> 项目团队协作维护中：
> 1. 创建项目的人，默认为项目创建人
> 2. 创建人可以维护项目的成员，添加已有成员到项目中，可以移除项目成员

### 1.2 现状分析

WES 现有协作相关资产已实现 70%：

| 能力 | 现状 | 缺口 |
|---|---|---|
| 项目主线 | `ProjectEvaluationPlan` 持有全部子记录指针 + `ownerUserId` | 未聚合为统一时间线 |
| 团队/成员/角色 | `team` 模块完整（P0 已交付，JSON 存储） | 项目与团队关联单向、无权限体现 |
| 协同工作区 | `collab_workspaces` + `collab_messages` 全完整 | **前端零入口** |
| 改动审计 | `change_logs`（字段级）+ `change_submissions` | 未并入项目时间线 |
| 会话追溯 | `ai_sessions` 带 `linkedRecords.projectId` | owner 私有，成员无可见性 |

缺口不是**模块级**，而是**聚合层**——五处事实散落无序，看不到项目完整上下文。

---

## 2. 架构决策

### 2.1 方案比较

| 方案 | 读侧聚合 | 事件流（权威） | workspace 中枢 |
|---|---|---|---|
| **实现** | 5 个适配器 → 统一事件形 | 21 模块埋埋点 + 回填历史 | workspace 锚点转移 + 跨存储事务 |
| **周期** | 2-3 周 | 6-8 周 | 4-5 周 |
| **风险** | N+1 延迟（可监控） | 改动面大，埋点遗漏 | 跨存储一致性复杂 |
| **演进路径** | → P3 事件表时逐源切换，对外契约不变 | 本身就是终态 | 无自然升级路径 |
| **推荐** | ✅ | P3 二阶段切换 | ❌ 不采用 |

**结论**：采纳**读模型聚合**。首期验证"信息聚合本身是否解决问题"，第二阶段再补事件埋点。演进风险最低。

### 2.2 核心身份选择

**复用 `ProjectEvaluationPlan` 作为聚合根，不新建 Project 实体。**

理由：
- 业务语义对齐：项目 = 一个总方案（GL-）及其全部衍生评估
- 存量兼容：`ownerUserId` + `participantUserIds` 已存，零迁移成本
- 避免双身份问题：分立 Project 会导致 ProjectEvaluationPlan.projectId 和 Project.projectId 的映射维护成本

扩字段：

| 字段 | 类型 | 语义 | 默认值 | 位置 |
|---|---|---|---|---|
| `teamId?` | `string\|null` | 归属团队 ID，沿用 team 模块 3.1 决策「手动关联」 | `null` | `ProjectEvaluationPlan.teamId` |
| `visibility` | `"private"\|"team"` | 项目可见范围 | `"private"` | `ProjectEvaluationPlan.visibility` |

存量数据迁移时用**默认值补齐**（按 AGENTS.md），零行为变化。

---

## 3. 数据模型

### 3.1 项目成员表（PG）

```sql
CREATE TABLE project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_role TEXT,  -- owner/reviewer/implementer/observer
  status TEXT NOT NULL DEFAULT 'active',  -- active/removed
  
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,  -- heartbeat 时更新
  last_activity_at TIMESTAMPTZ,  -- 时间线最新事件回写
  status_note TEXT,  -- 成员自填状态
  
  removed_at TIMESTAMPTZ,
  removed_by_user_id TEXT,
  
  PRIMARY KEY (project_id, user_id),
  INDEX project_members_last_seen (project_id, last_seen_at DESC)
);
```

**为什么不复用 `ProjectEvaluationPlan.participantUserIds` jsonb 数组：**  
`last_seen_at` 是高频行级更新。JSONB 数组一旦并发覆盖就冲突，team 域已出现过 `code=40909`（storeVersion conflict）。

**为什么独立于 team_members：**  
项目成员不一定都在同一团队（跨团队协作是 P2 范围）。且 project_role 与 team 的 role（manager/member）是正交维度。

### 3.2 统一事件类型（应用层）

时间线入口 `ProjectTimelineEntry`：

```ts
type ProjectTimelineEntry = {
  entryId: string;          // 合成 ID: `${subKind}:${nativeId}`，可从源事实推导
  projectId: string;
  kind: "record" | "session" | "change" | "collab" | "artifact" | "member";
  subKind: string;          // e.g. requirement.version_created, session.linked, member.added
  occurredAt: string;       // ISO 8601，排序键
  actor: {
    userId: string;
    username: string;
    role?: string;          // SALES/IMPL/...
  };
  title: string;            // 人类可读摘要
  summary?: string;         // 二级上下文
  target: {
    type: string;           // 目标类型
    id: string;
    versionCode?: string;
    fieldPath?: string;
  };
  links: Array<{ href: string; label: string }>;
  meta?: Record<string, unknown>;
};
```

**entryId 设计**：  
用**合成 ID** `${subKind}:${nativeId}` 而非自增。因投影无写入，必须可从源事实推导，才能保证幂等、dedup、以及第二阶段迁移事件表时 ID 保持稳定。

### 3.3 六类时间线事件来源

| 来源 | 适配器 | 事件例 | 源表 |
|---|---|---|---|
| **记录** | `record.source.ts` | requirement.version_created, assessment.checked_in | versions + project-evaluations |
| **会话** | `session.source.ts` | session.linked, session.resolved | ai_sessions（可见性过滤）+ harness_runs |
| **改动** | `change.source.ts` | change.field_override, submission.merged | change_logs + change_submissions |
| **协作** | `collab.source.ts` | review.created, comment.posted | collab_messages + team_reviews |
| **产物** | `artifact.source.ts` | artifact.generated, export.downloaded | harness_artifacts + deliverables |
| **成员** | `member.source.ts` | member.added, member.removed, owner.transferred | project_members（新表） |

### 3.4 权限判定链（去重 + deny 优先）

```ts
function canReadProject(user, project) {
  const m = membership(user.id, project.id);
  
  // Deny 优先：已移除成员无法通过任何通道重新获得权限
  if (m?.status === "removed") return false;
  
  // 白名单判定
  return project.ownerUserId === user.id                   // 创建人
      || m?.status === "active"                            // 项目成员
      || (project.visibility === "team" 
          && project.teamId 
          && isTeamMember(user.id, project.teamId))        // 本团队可见
      || user.capabilities.includes("user:manage");        // ADMIN
}

function canManageMembers(user, project) {
  return project.ownerUserId === user.id                   // 创建人
      || (project.teamId && isTeamManager(user.id, project.teamId))  // 本团队 manager
      || user.capabilities.includes("user:manage");        // ADMIN
}
```

**两个兜底（双轨权限如何收敿）**：

1. **`temporary_chat` 永不外泄**  
   即使误挂 `projectId`，status=`temporary_chat` 的 session 对非 owner 永远隐藏。给"随手聊"保留私密空间。

2. **他人 session 只读 + 敏感字段遮罩**  
   成员可读他人关联的 session 上下文，但不可续写，且 `pendingActions.payload` 中成本/报价字段需遮罩（复用 team 评审的敏感字段处理）。

---

## 4. API 契约

### 4.1 只读接口（5 个）

#### 4.1.1 `GET /api/v1/projects/:projectId/context`

项目概览快照。

```json
{
  "code": 0,
  "data": {
    "project": {
      "projectId": "...",
      "projectName": "...",
      "ownerUserId": "...",
      "teamId": "...",
      "visibility": "team|private",
      "createdAt": "..."
    },
    "chain": {
      "requirement": { "versionCode": "RI-...", "status": "checked_in" },
      "assessment": { "versionCode": "AS-...", "status": "checked_out", "checkedOutBy": "..." },
      "devAssessment": null,
      "resourceCost": null,
      "wbs": null,
      "globalPlan": { "versionCode": "GL-...", "status": "..." }
    },
    "stats": {
      "memberCount": 5,
      "activeSessionCount": 2,
      "openReviewCount": 1,
      "unreadCommentCount": 0
    },
    "recentActivity": {
      "lastChangedAt": "...",
      "lastChangedBy": "...",
      "actorUsername": "..."
    }
  }
}
```

权限：`canReadProject`

#### 4.1.2 `GET /api/v1/projects/:projectId/timeline`

统一时间线。

```
GET /api/v1/projects/:projectId/timeline
  ?kinds=record,change&actor=userId&since=2026-08-01&until=2026-08-27
  &cursor=&limit=50
```

游标分页用复合键 `(occurredAt, entryId)` 避免同秒事件丢失。

```json
{
  "code": 0,
  "data": {
    "entries": [
      {
        "entryId": "requirement.version_created:...",
        "kind": "record",
        "subKind": "requirement.version_created",
        "occurredAt": "2026-08-27T14:30:00Z",
        "actor": { "userId": "...", "username": "..." },
        "title": "需求 RI-001 新建版本",
        "target": { "type": "requirement", "id": "...", "versionCode": "RI-001" },
        "links": [{ "href": "/requirements/RI-001", "label": "打开需求" }]
      },
      ...
    ],
    "nextCursor": "...",
    "hasMore": false
  }
}
```

权限：`canReadProject`  
并发采用适配器并发 fetch + 归并排序。首屏 P95 超阈值才升级事件表。

#### 4.1.3 `GET /api/v1/projects/:projectId/sessions`

项目内可见 session 列表（包含他人的）。

```json
{
  "code": 0,
  "data": {
    "sessions": [
      {
        "sessionId": "...",
        "ownerUserId": "...",
        "ownerUsername": "...",
        "title": "...",
        "status": "project_discovery|...",
        "linkedRecords": { "projectId": "...", "requirementVersionId": "..." },
        "messageCount": 15,
        "createdAt": "...",
        "updatedAt": "...",
        "isCurrentUserOwner": false,
        "isReadonly": true  // 非 owner 可读、不可续写
      }
    ]
  }
}
```

权限：`canReadProject`，且排除 `status=temporary_chat` 的 session

#### 4.1.4 `GET /api/v1/projects/:projectId/members`

成员列表 + 最近状态。

```json
{
  "code": 0,
  "data": {
    "members": [
      {
        "userId": "...",
        "username": "...",
        "projectRole": "owner|reviewer|implementer|observer",
        "status": "active|removed",
        "joinedAt": "2026-08-01T...",
        "lastSeenAt": "2026-08-27T14:25:00Z",
        "lastActivityAt": "2026-08-27T14:20:00Z",
        "lastActivityTitle": "评论了 GL-001",
        "statusNote": "正在整理需求包",
        "removedAt": null,
        "removedByUsername": null,
        "canBeRemoved": true,  // UI 侧用于灰化按钮
        "canChangeRole": true
      }
    ]
  }
}
```

权限：`canReadProject` + 成员自填的 `statusNote` 对所有项目成员可见（增强协作透明度）

#### 4.1.5 `GET /api/v1/projects/:projectId/member-candidates?q=&limit=20`

添加成员时的候选人池。

```json
{
  "code": 0,
  "data": {
    "candidates": [
      {
        "userId": "...",
        "username": "...",
        "displayName": "...",
        "businessRole": "SALES|IMPL|PRE_SALES|PM|PMO",
        "teamNames": ["销售部", "实施中心"],
        "alreadyInProject": false
      }
    ]
  }
}
```

逻辑：
- 无 `q` → 返回 `项目归属团队成员 ∪ 请求者所在团队成员`（交集，去重）
- `q` ≥ 2 字符 → 全部 `status=active` 用户前缀匹配，`limit` 硬上限 20
- 不含邮箱、手机、账号停用状态（字段白名单）
- 不含已移除的项目成员（`status=removed` 的行）

权限：`canManageMembers`

### 4.2 写接口（4 个）

#### 4.2.1 `POST /api/v1/projects/:projectId/heartbeat`

更新 `lastSeenAt`，幂等。

```json
{
  "statusNote": "正在核对成本估算"  // 可选
}
```

响应：`{ code: 0, data: { lastSeenAt: "..." } }`

权限：`canReadProject`（成员心跳，低权限）  
调用：页面进入、定时（10min）、路由切换时调用；UI 侧自适应取消重复调用

#### 4.2.2 `POST /api/v1/projects/:projectId/members`

添加成员。

```json
{
  "userId": "...",
  "projectRole": "reviewer|implementer|observer"  // owner 不可由本接口赋予
}
```

响应：`{ code: 0, data: { userId, projectRole, joinedAt } }`

逻辑：
- 校验 `userId` 是 `active` 用户；不在项目里则自动 insert
- `project_role` 可选，默认 `implementer`
- 时间线事件 `member.added`

权限：`canManageMembers`

#### 4.2.3 `DELETE /api/v1/projects/:projectId/members/:userId`

移除成员（软删除）。

```json
{
  "reason": "人员离职，不再参与项目"  // 可选
}
```

响应：`{ code: 0, data: { userId, status: "removed", removedAt } }`

限制：
- 创建人不可被移除（返回 `code=40911`）
- 本人可以自行移除（主动离开项目）
- 已移除成员重复删除幂等（成功）

逻辑：
- 写 `removed_at` + `removed_by_user_id` + `status='removed'`，**不删行**
- 时间线事件 `member.removed`
- 持有的版本检出锁**不自动释放**（防止丢编辑），成员面板显示告警 + 引导 ADMIN 强制解锁

权限：`canManageMembers`

#### 4.2.4 `PATCH /api/v1/projects/:projectId/owner`

转移创建人（ADMIN-only）。

```json
{
  "newOwnerUserId": "..."
}
```

响应：`{ code: 0, data: { projectId, oldOwner, newOwner, transferredAt } }`

原子语义（执行顺序：先 PG 后 JSON，fail-closed）：

1. 校验 `newOwnerUserId` 是 `active` 用户
2. 若不在项目中，自动 `insert project_members`
3. 旧创建人降为 `implementer`，`status='active'`（保留历史上下文）
4. 新创建人改为 `owner`
5. 更新 `ProjectEvaluationPlan.ownerUserId`
6. 时间线事件 `member.owner_transferred`

权限：`requireCapability("user:manage")`（ADMIN-only）

---

## 5. 权限矩阵完整版

| 操作 | 创建人 | 本团队 manager | 项目成员 | 同团队非成员 | 团队外 | ADMIN | 已移除成员 |
|---|---|---|---|---|---|---|---|
| 读项目概览 | ✅ | ✅ | ✅ | ⚠️ `visibility=team` | ❌ | ✅ | ❌ |
| 读时间线 | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| 读项目 session | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| 读成员列表 | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| **heartbeat** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **添加成员** | ✅ | ✅ 需 `teamId` | ❌ | ❌ | ❌ | ✅ | ❌ |
| **移除成员** | ✅ 不可自移 | ✅ 需 `teamId` | ⚠️ 仅自己 | ❌ | ❌ | ✅ | ❌ |
| **候选人池** | ✅ | ✅ 需 `teamId` | ❌ | ❌ | ❌ | ✅ | ❌ |
| **转移创建人** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

注：⚠️ = 条件生效（visibility / 成员身份 / 职能）

---

## 6. 前端页面：项目主线

`ui/V2_PROTOTYPE/src/pages/ProjectMainline.jsx`

### 6.1 页面结构

**三栏布局**（Tailwind + tokens 桥接类名，preflight 关闭）

```
┌─────────────────────────────────────────────────────────────┐
│ 项目名 | 团队: 销售部 | 可见性: 私有 | [编辑基本信息]           │
├──────────┬────────────────────────────────────┬──────────────┤
│ 链路导航 │       统一时间线（中区）            │  成员面板    │
│          │                                    │              │
│ RI-001   │ [今天]                             │ Owner        │
│ ├─AS-001 │   14:30 ✏️ 需求包新建版本            │ Kevin        │
│ ├─DV-001 │       👤 Kevin                     │ Implementer  │
│ ├─RS-001 │                                    │ Alice ⏱️      │
│ └─GL-001 │   14:20 💬 评审关闭，2 条评论        │ 最近: 14:25  │
│ └─WBS    │       👤 Alice（reviewer）         │ 状态: 整理中  │
│          │                                    │ [编辑状态]   │
│          │ [昨天]                             │              │
│          │   23:50 📊 导出 Excel               │ ─────────   │
│          │       👤 Kevin                     │ [添加成员]   │
│          │                                    │ Alice        │
│          │   23:40 🔗 session linked          │  ├─移除     │
│          │       👤 Codex                     │  └─[... 2]  │
│          │                                    │              │
│          │ [8 月 26 日]                        │              │
│          │   ... (按时间倒序)                  │              │
├──────────┴────────────────────────────────────┴──────────────┤
│ 时间线过滤: [全部] [记录] [改动] [会话] [协作] [产物]         │
│ 按人过滤:   [全部] [Kevin] [Alice] ...                      │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 左栏：链路导航

显示项目纵向链路（RI → AS → DV → RS → WBS → GL），每节点卡片包含：

- 版本号 + 状态徽章（`checked_in` / `checked_out` / 待检出）
- 当前负责人 avatar
- **检出锁持有人** ⚠️ 直观标注（"谁正持有"）
- 点击进入详情 / 打开版本对比

### 6.3 中栏：统一时间线

6 类事件，按日分组，倒序排列：

| 事件 | 图标 | 示例 |
|---|---|---|
| 记录变动 | `📋` | 需求包升版 → RI-002 |
| 改动覆盖 | `✏️` | 字段 "范围" 手动覆盖 |
| AI Session | `🤖` | session linked → 需求发现 |
| 协作评审 | `💬` | 评审关闭，7 条评论 |
| 产物导出 | `📊` | 导出 Excel（可下载） |
| 成员变更 | `👥` | Alice 加入项目 |

**点击跳转**：评论类事件跳 review 详情；session 跳 session 详情；版本变动跳版本对比。

**过滤器**：

- 类型（checkbox 复选：记录/改动/会话/协作/产物/成员）
- 作者（dropdown，项目成员列表）
- 日期范围（datepicker）

**分页**：cursor-based，每页 50 条，到底自动加载 / 手动"加载更多"。

### 6.4 右栏：成员面板

**成员列表**：

```
[Owner]
Kevin (avatar)
 ├─ 最后活跃: 14:25
 ├─ 最近动作: 移除了 Bob
 ├─ 状态: 整理成本估算
 └─ [编辑状态] (仅自己可编辑本人)

[Implementer]  
Alice (avatar)
 ├─ 最后活跃: 12:30
 ├─ 最近动作: 上传需求包
 ├─ 状态: 等待 PM 审阅
 └─ ⚠️ 持有检出锁（DV-001）

[Observer]
Bob (avatar，已移除 2026-08-27)
 ├─ 加入时间: 2026-08-01
 ├─ 移除时间: 2026-08-27 14:15
 ├─ 移除者: Kevin
 └─ (仅创建人/ADMIN 可恢复)
```

**操作（按权限）**：

- 创建人 / 本团队 manager / ADMIN：[添加成员] [移除成员] [更改角色]
- 成员本人：[编辑自己的状态] [自行离开项目]

**[添加成员]** 弹窗：

- 搜索框（默认展示团队成员 + 创建人团队成员，支持全量搜索）
- 候选人卡片（username / displayName / businessRole / 已在项目则灰化）
- 选择 projectRole（reviewer / implementer / observer，可选，默认 implementer）
- [添加] [取消]

响应后实时刷新成员列表 + 追加时间线事件。

---

## 7. 分期计划

### 7.1 P0 首期（本次设计范围）

**范围**：只读项目上下文 + 成员维护

**交付物**：

1. 后端
   - `modules/project-context/` （5 适配器 + usecase + controller）
   - `modules/project-context/guard.ts` （资源级守卫）
   - `project_members` 表迁移
   - 9 个接口实现 + 路由聚合
   - 权限单测（7 主体 × 7 操作 = 49 组合）

2. 前端
   - `pages/ProjectMainline.jsx` （三栏布局）
   - `components/ProjectTimeline.jsx` （事件渲染）
   - `components/ProjectMembers.jsx` （成员管理）
   - `api/projectContext.ts` （API 客户端）
   - 响应式：desktop 优先，tablet 视图调整（右栏可折叠）

3. 文档
   - `docs/openapi.yaml` 更新（6 个 schema 定义）
   - `实现与文档对齐说明.md` 补充
   - 数据库迁移说明（触发器 1 + 4 确认）

**验证命令**：

```bash
npm run test:modules          # 权限矩阵完整单测
npm run test:integration      # API 端对端
npm run build:api             # 后端构建
npm run build:web             # 前端构建
npm run test:e2e:web          # 前端主线页交互（如可用）
```

**交付完成度**：项目团队成员能在统一页面看到项目全貌 + 成员维护权限分配清晰。

### 7.2 P1 二期（预留设计方向）

- **通用评论系统** `project_comments` 表（anchored comments，可挂任意对象）
- **collab workspace 前端入口** 恢复协同工作区（质询-回复-决策）
- **成员状态实时** SSE 或轮询机制（去掉 10min 定时 heartbeat）

### 7.3 P2 三期（预留）

- **项目事件权威表** `project_events` 替换适配器
- **任务分派与 @提醒**
- **协同效率看板**（成员贡献度、评审周期等）
- **跨团队共享与外部协作**

---

## 8. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| **N+1 延迟** | 中 | 5 适配器并发 fetch + 指标监控。P95 > 1s 时升级事件表 |
| **跨存储一致性** | 中 | Project JSON + project_members PG，软引用 + ops 校验脚本定期清孤儿 |
| **隐私倒灌** | 高 | 上线前扫描存量 `ai_sessions` 中 `projectId` 已填的记录，给 owner 一次性确认或撤销窗口 |
| **manager 通道依赖 teamId** | 低 | 项目创建时引导绑定，未绑定时成员面板标注权限限制 |
| **检出锁悬空** | 低 | 移除成员时不自动解锁，面板告警 + 引导 ADMIN 手工强制解锁，避免丢编辑 |
| **移除成员后文件权限漂移** | 低 | deny 优先判定链，moved_at 冻结，无自动恢复机制 |

---

## 9. 测试策略

### 9.1 权限矩阵单测

**7 主体 × 7 操作 = 49 组**（含已移除成员、团队 manager、visibility 为空等边界）

- `canReadProject()` 覆盖所有通道组合
- deny 优先不被绕过
- `temporary_chat` session 永不外泄
- manager 权限依赖 `teamId` 检证

### 9.2 适配器单测

每个 source 独立单测：mock 源 repo，校验事件形 + 排序 + 游标边界

- 同秒事件复合游标不丢失
- `entryId` 幂等性（同一源事实多次读返回相同 ID）

### 9.3 API 集成测试

- 5 读接口的响应格式 + 权限约束
- 4 写接口的原子性 + 边界
- 9 接口全路径（从鉴权 → 业务逻辑 → 数据写 → 响应）

### 9.4 前端页面交互

- 时间线分页加载
- 过滤器联动（按日期 + 作者 + 类型）
- 成员操作（添加 → 候选池响应 → 列表刷新 → 时间线追加事件）

### 9.5 跨域数据一致性

- JSON 写失败后 PG 孤儿行可检测
- JSON owner 转移失败，PG 只多一行 owner（可修复）

---

## 10. 实施依赖

### 10.1 前置条件

1. **AGENTS.md DB 迁移方案更新**  
   补充 `project_members` 作为"第三个 DB-backed 域"的触发判定

2. **ProjectEvaluationPlan 扩字段**  
   JSON 数据迁移（补默认值）

3. **现有权限系统扩展**  
   新增 `assertProjectOwner` 资源级守卫

### 10.2 外部契约

- **OpenAPI 契约** (`docs/openapi.yaml`)  
  新增 6 个 schema + 9 个 path
  
- **前端样式** （Tailwind + tokens）  
  复用现有设计系统，无新增 design token

### 10.3 时间与工作量估算（参考）

| 组件 | 周期 | 备注 |
|---|---|---|
| 适配器 + usecase | 2-3d | 逻辑简单，单测覆盖 |
| API 接口 + 路由 | 1-2d | 4 写 + 5 读 |
| PG 迁移 + 权限 | 1d | 表定义 + guard 中间件 |
| 前端页面 | 3-4d | 三栏布局 + 交互 |
| 单测 + 集成 | 2-3d | 权限矩阵覆盖度高 |
| **总计** | **9-13d** | 人天估算，内含文档 + review |

---

## 11. 立项决策清单

| 项 | 决策 | 依据 |
|---|---|---|
| 聚合根选择 | 复用 ProjectEvaluationPlan | 业务对齐 + 零迁移 |
| 架构方案 | 读模型聚合（不建事件表） | 首期验证信息价值，P3 可升级 |
| Session 可见性 | 关联后自动可见 | 完整上下文 + deny 优先防滥用 |
| 存储位置 | PostgreSQL | 审计 + 多人并发写 + P95 查询 |
| 首期范围 | 只读 + 成员维护 | 解决核心痛点，控制改动面 |
| 成员权限 | 创建人 + manager + ADMIN 三通道 | 符合运维现状 + team 模块语义 |
| Owner 转移 | P0 ADMIN-only 接口 | 防止项目卡住，但降低 P0 改动 |
| 候选池可见 | 团队内默认 + 全量搜索 | 跳团队协作常见场景，又不暴露用户目录 |

---

## 12. 后续回顾清单

首期上线后 1 周内检查：

- [ ] 时间线 P95 延迟（≤ 1s 为良好）
- [ ] project_members 并发冲突率（期望 0）
- [ ] 移除成员后权限生效延迟
- [ ] 前端主线页访问量 + 用户反馈
- [ ] 是否有跨存储一致性问题报告

若有性能或稳定性问题，触发 P1 优化或 P3 事件表迁移决策。

---

**文档版本**：1.0  
**最后更新**：2026-08-27  
**审批人**：Kevin  
**下一步**：编码实施，按 `wes-tdd` Skill 走 RED-GREEN-REFACTOR
