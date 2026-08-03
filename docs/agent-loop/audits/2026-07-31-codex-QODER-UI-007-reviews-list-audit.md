# Codex UI Audit · QODER-UI-007 · Review List

date: 2026-07-31
taskId: QODER-UI-007-AUDIT
target: `/reviews`
scope: `review list only`
branch: `codex/role-driven-ai-home-workbench`
head: `910269a`
verdict: `CONFIRMED / READY_FOR_SPEC`
issue: `ISS-203`
derivedRequirement: `RP-044`
implementationAuthorized: `false`
allowNextTask: `false`
nextOwner: `user-owner`

## Audit Conclusion

`/reviews` 列表在 1440px 和 760px 下均可加载、筛选且没有页面级横向溢出，
但当前评审任务流存在三个经运行态确认的根问题：

1. 列表请求失败被渲染成“暂无数据”，用户无法区分“当前没有评审”与“系统没有
   成功取到评审”；
2. 新建评审请求失败后仍返回本地临时 ID，并导航到一个空白评审详情，形成
   “创建成功”的错误心智；
3. 详情入口和列表动作采用“双击行 / 先选择再操作”的隐式模式，行本身不可
   键盘聚焦；筛选状态和选择框缺少明确语义，历史动作仍使用原生 `alert()`。

本轮只完成审计和问题池分诊，没有修改业务代码、集成 UI-05、创建实现
worktree，或授权 Qoder 开始实现。

## Scope Contract

- one business surface: `/reviews` list
- confirmed root issues: `3`
- second UI stack: `not allowed`
- source contract:
  - `skills/improving-wes-ui/SKILL.md`
  - `skills/improving-wes-ui/references/quality-checklist.md`
  - `docs/codex-workflows/qoder-ui-optimization-bootstrap.md`
- current runtime:
  - current Vite source from the main checkout;
  - isolated local audit API with synthetic review data and synthetic login;
  - no production account, credential, API key, or external write.

## Confirmed Root Issues

### Root 1 · 列表加载失败被伪装为空数据

- priority: `P1`
- contract:
  - 异步失败必须显示清晰、非阻断且靠近 owner 的错误反馈；
  - 空状态只代表请求成功但结果为空，不能代表请求失败。
- runtime reachability:
  - `/reviews` → `useReviewList` → `GET /pm/reviews`;
  - 隔离 API 返回 HTTP 503 后，页面显示“暂无数据”“共 0 条”，没有
    `role="alert"`、`role="status"` 或失败文案。
- deterministic owner:
  - `ui/V2_PROTOTYPE/src/hooks/useReviewList.js` 已维护 `loading/error`；
  - `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx` 没有把这两个状态交给页面；
  - `ui/V2_PROTOTYPE/src/components/ListPage.jsx` 只有通用 empty state。
- expected direction:
  - 给 `ListPage` 增加明确的 loading/error contract；
  - 失败时提供内联错误和“重试”，成功空列表才显示空状态；
  - 使用 `role="alert"` 或等效可播报错误区域。

### Root 2 · 新建失败仍导航到本地幽灵评审

- priority: `P1`
- contract:
  - 创建动作必须等待真实结果；
  - 失败不得被包装成成功、不得产生无法追溯的本地业务记录；
  - pending / success / failure 生命周期必须一致。
- runtime reachability:
  - `/reviews` → “+ 新建” → `useReviewList.create`;
  - 隔离 API 返回 HTTP 500 后，浏览器仍导航到
    `/reviews/REV-LOCAL-42248`;
  - 页面展示“评审中”“通过/驳回”等真实业务动作，但 Checklist、评论、
    交付物和关联信息全部为 0/空，且没有失败提示。
- deterministic owner:
  - `ui/V2_PROTOTYPE/src/hooks/useReviewList.js` 在请求前插入 local row，
    catch 后仍返回 `local.id`;
  - `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx` 只要收到 ID 就导航。
- expected direction:
  - 真实 API 成功后再提交正式 ID 并导航；
  - 失败时留在列表、移除 optimistic ghost、恢复按钮并显示内联错误；
  - 若产品需要草稿，必须使用后端可追踪的 draft contract，而不是
    `REV-LOCAL-*`。

### Root 3 · 列表主动作缺少显式、键盘可达的语义

- priority: `P2`
- contract:
  - 主要动作应该清晰、就近、可通过键盘完成；
  - 选择、筛选和异步结果需要可被辅助技术识别；
  - 历史等非破坏性反馈不应使用阻断式原生对话框。
- runtime reachability:
  - 行只绑定单击选择与双击打开详情；
  - 运行态行没有 `tabindex`、`role` 或可访问名称，不能直接键盘聚焦；
  - “待评审”筛选可过滤 6 → 3 条，但切换前后都没有 `aria-pressed`;
  - 表头和行选择框在 DOM 中均没有可访问名称；
  - 选中一行后点击“历史”触发原生 `alert()`。
- deterministic owner:
  - `ui/V2_PROTOTYPE/src/components/ListPage.jsx` 负责行、筛选和选择语义；
  - `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx` 负责评审历史反馈。
- expected direction:
  - 提供明确的行级“查看评审”入口，行支持 Enter/Space 或使用真实链接；
  - 筛选使用 `aria-pressed`/等效选择语义，选择框提供行级 label；
  - 历史以 Drawer/Dialog 或内联区域承载，不再使用 `alert()`；
  - 保留批量选择，但不要把详情入口隐藏在选择动作之后。

## Browser Evidence

### Step 1 · 1440px 正常列表

- health: `PARTIAL`
- result:
  - 6 条评审可见；
  - 状态筛选、搜索和表格均在 viewport 内；
  - page `clientWidth=1440`, `scrollWidth=1440`;
  - console warning/error: `0`.
- limitation:
  - 行主动作和异步失败问题在正常截图中不直接暴露。
- screenshot:
  - `assets/2026-07-31-ui-07-reviews/01-reviews-list-1440.png`

### Step 2 · 760px 窄屏列表

- health: `PARTIAL`
- result:
  - page `clientWidth=745`, `scrollWidth=745`;
  - toolbar、搜索和表格没有页面级横向溢出；
  - 状态、日期和评审号发生多行折叠，但仍可读取。
- limitation:
  - 全局 Shell 会把完整导航堆叠在内容上方，显著增加首屏滚动距离；
    这是 UI-03/UI-05 Gate 已记录的跨页面 Shell 观察，不归 UI-07 列表 owner。
- screenshot:
  - `assets/2026-07-31-ui-07-reviews/02b-reviews-list-760-viewport.png`

### Step 3 · 列表 HTTP 503

- health: `FAIL`
- result:
  - 页面显示“暂无数据”“共 0 条”；
  - `role="alert"` count: `0`;
  - `role="status"` count: `0`;
  - 后端失败文案不可见。
- screenshot:
  - `assets/2026-07-31-ui-07-reviews/03-reviews-list-load-failure-1440.png`

### Step 4 · 新建 HTTP 500

- health: `FAIL`
- result:
  - 浏览器导航到 `/reviews/REV-LOCAL-42248`;
  - 详情呈现为可审批的“评审中”页面；
  - `role="alert"` count: `0`;
  - `role="status"` count: `0`;
  - “新建评审失败”不可见。
- screenshot:
  - `assets/2026-07-31-ui-07-reviews/04-reviews-create-failure-ghost-detail-1440.png`

## Intake And Triage

- dedup result:
  - 未在 `issues.html`、`requirements.html`、`defects.html` 或
    `changes.html` 命中 `/reviews` 同类 issue / RP；
  - 仅命中 UI 路线图候选 `UI-07` 和既有 Shell 窄屏观察。
- source issue:
  - `ISS-203 · /reviews 失败状态、创建可信度与操作可达性`
- triage:
  - `requirement`
- derived requirement:
  - `RP-044 · UI-07 评审列表可信反馈与显式操作入口`
- status:
  - `待用户确认 / 未授权实现`
- implementation boundary:
  - list only;
  - 最多修复上述三个根问题；
  - 评审详情的审批内容布局另开 Work Order；
  - 不顺带处理全局 Shell、UI-05 集成或其他列表页。

## Board Sync

- structured event:
  - `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-31-ui-007-reviews-list-audit.json`
- visible HTML:
  - `not updated`;
  - `issues.html`、`requirements.html`、`changes.html` 当前存在用户未提交改动，
    本轮不覆盖；结构化事件和本审计先作为可应用事实源。

## Next

等待用户确认后，生成单独的 `QODER-UI-007-IMPL` Work Order。Qoder 必须先
完成 Worktree Contract ACK，只实现本审计的三个根问题，按 TDD 提供
1440px / 760px / keyboard 证据，最终状态只能到“已回填 / 待 Codex 复核”。
