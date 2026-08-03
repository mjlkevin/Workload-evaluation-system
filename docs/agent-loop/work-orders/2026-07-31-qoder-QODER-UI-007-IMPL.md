# Qoder Work Order · QODER-UI-007-IMPL

date: 2026-07-31
taskId: QODER-UI-007-IMPL
issue: ISS-203
requirement: RP-044
target: `/reviews`
surface: `review list only`
executor: qoder1
reviewer: codex
finalAcceptor: user-owner
status: `ASSIGNED / WAITING_QODER_ACK`
allowNextTask: `false`
mainMergeAllowed: `false`
deliveryStatusAllowed: `已回填 / 待 Codex 复核`

## Objective

只优化 `/reviews` 列表的三个已确认根问题：

1. P1：列表加载失败被伪装为“暂无数据”；
2. P2：新建失败仍产生 `REV-LOCAL-*` 幽灵评审并导航到详情；
3. P3：列表主动作依赖双击/选择后操作，键盘、筛选、选择和历史反馈语义不足。

本任务不是全站 UI 重构，不处理评审详情内容布局、全局 Shell、其他 ListPage
消费者、UI-05 集成、后端 API、权限、数据库或总看板最终状态。

## Project And Worktree Contract

- projectRoot: `/Users/kevin/AI/Workload-evaluation-system`
- baseCommit: `910269a`
- worktreePath: `/Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/ui-007-reviews-list`
- branch: `qoder/ui-007-reviews-list`
- webMainline: `ui/V2_PROTOTYPE`
- unrelatedChangesPolicy: `preserve`

`/Users/kevin/AI/Workload-evaluation-system-agent` 是已注销历史路径。项目内旧协议
示例若仍包含该路径，必须以当前 `AGENTS.md` 和 `codex-project-registry.md` 为准。
禁止在 main checkout 直接编辑；禁止依赖或复制 main checkout 的未提交业务代码。

## Mandatory Reading

在任何编辑前完整读取：

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `QODER.md`
4. `skills/wes-qoder-worktree-protocol/SKILL.md`
5. `skills/wes-qoder-worktree-protocol/references/protocol.md`
6. `skills/wes-multi-agent-collaboration/SKILL.md`
7. `skills/improving-wes-ui/SKILL.md`
8. `skills/improving-wes-ui/references/quality-checklist.md`
9. `skills/improving-wes-ui/references/upstream-provenance.md`
10. `docs/agent-loop/audits/2026-07-31-codex-QODER-UI-007-reviews-list-audit.md`
11. `docs/superpowers/plans/2026-07-31-ui-07-reviews-list.md`
12. 本 Work Order

Qoder 当前若仍不支持注册项目本地 Skill，直接使用已确认的
`skillMode=manual-read`；不要再次花时间寻找不存在的平台安装 API。每次新执行会话
仍须重新完整读取上述 Skill 和引用文件。

## Required ACK Before Editing

第一条执行回复必须只给出以下合同并停止等待确认；字段不得省略：

```markdown
## QODER-UI-007 Worktree Contract ACK
projectRoot: /Users/kevin/AI/Workload-evaluation-system
currentMainBranch: codex/role-driven-ai-home-workbench
baseCommit: 910269a
worktreePath: /Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/ui-007-reviews-list
branch: qoder/ui-007-reviews-list
taskId: QODER-UI-007-IMPL
issue: ISS-203
requirement: RP-044
skillMode: manual-read | registered
surface: /reviews list only
allowedPaths:
- ui/V2_PROTOTYPE/src/hooks/useReviewList.js
- ui/V2_PROTOTYPE/src/pages/ReviewList.jsx
- ui/V2_PROTOTYPE/src/components/ListPage.jsx
- ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx
- ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx
forbidden:
- no main-checkout edits
- no UI-05 integration
- no ReviewDetail layout/content redesign
- no global Shell/index.css/App.jsx changes
- no backend/API/DB/auth changes
- no ui/V0_SAAS or apps/web
- no new UI dependency or second component system
- no broad reset/clean/restore/format/rebase/merge
- no board HTML edits or delivery status finalization
- no secrets, real credentials, tokens or production data
requiredVerification:
- focused RED then GREEN tests
- npm run test:web
- npm run build:web
- UI scope checker
- current browser 1440px + 760px + keyboard paths
statusAuthority: Qoder stops at 已回填 / 待 Codex 复核
allowNextTask: false
```

若 base commit、worktree/branch 可用性或 allowedPaths 无法满足，停止并回填阻断，
不得在 main checkout 代替执行。

## Allowed Paths

只有以下业务/测试文件可修改或新建：

- `ui/V2_PROTOTYPE/src/hooks/useReviewList.js`
- `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx`
- `ui/V2_PROTOTYPE/src/components/ListPage.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx`

不要求每个文件都变更。只提交修复三个根问题所需的最小文件集合。需要新增其他
文件时先停止并请求扩大范围。

## Implementation Contract

### P1 · 加载失败不能等同于空数据

Required behavior:

- `useReviewList` 的 loading 和 load error 必须到达 `/reviews` 可见 UI；
- 首次加载和刷新期间显示明确 busy/loading 状态，不把未完成请求显示为空列表；
- HTTP/网络失败显示靠近列表 owner 的非阻断错误区域，并提供“重试”；
- 失败区域使用 `role="alert"` 或同等可播报语义；
- 只有请求成功且结果确实为空时才显示“暂无数据”；
- 重试不得重置无关页面状态或制造重复行。

Acceptance examples:

- GET 200 + `[]` → 空状态；
- GET 503 → 错误文案 + 重试，不出现“共 0 条 = 成功空列表”的假象；
- 重试 GET 200 → 错误消失，真实行出现。

### P2 · 新建失败不能导航到幽灵详情

Required behavior:

- 鉴权运行态中，只有 POST 成功并返回后端真实 ID 后才允许导航；
- POST 失败后仍停留 `/reviews`；
- 不保留或展示 `REV-LOCAL-*` 幽灵记录；
- 失败显示靠近“新建”动作的内联 `role="alert"`；
- 创建期间按钮 busy/disabled，结束后恢复；
- 失败不得清空已经加载的评审列表；
- 成功后使用服务端 ID 导航，并按现有 contract 刷新列表。

若无鉴权 mock/offline 模式仍需要本地数据，只能保留为明确的测试/演示路径，不能
污染鉴权 API 失败路径。

### P3 · 主动作显式、键盘可达、反馈非阻断

Required behavior:

- 每一行提供可见且原生键盘可达的“查看详情”按钮或链接；
- 不再要求用户猜测“双击行”才能进入详情；可保留双击作为辅助，但不能作为唯一
  入口；
- ReviewList 的批量动作收敛为真实可用动作：保留一个明确的“查看详情”和“历史”，
  移除重复“预览/修改”以及模块不支持的“删除”；
- 筛选按钮公开当前选择状态，例如 `aria-pressed`；
- 表头与行选择框都有准确 accessible name；
- “历史”不得触发原生 `alert()`，改为现有 WES 风格的非阻断内联 status 或共享
  Dialog；在没有真实历史接口时必须诚实说明当前能力，不伪造历史数据；
- 行选择、Cmd/Ctrl 多选和 Shift 范围选择的既有行为不得回归；
- 760px 下新增动作仍可达，不造成页面级水平溢出。

## Design And Architecture Boundaries

- 保留 Vite + React 18、现有 `tokens.css`、`components.css`、`layout.css`；
- 不新增 Tailwind、Radix、Motion、Base UI、React Aria、MUI、Ant Design、
  CSS-in-JS 或其他 UI 依赖；
- 优先给 `ListPage` 增加可选、向后兼容的状态/语义 props；不要改变其他六个
  ListPage 消费者的默认业务行为；
- 不改变 `/pm/reviews` API 契约，不新增后端 fallback；
- 不通过静态 mock 掩盖接口失败；
- 不修改 `ReviewDetail.jsx` 解决本列表任务；
- 不处理已知的 760px 全局 Shell 纵向堆叠观察。

## TDD Contract

任何实现代码前先添加聚焦测试，并在 handoff 中记录预期 RED 结果。至少覆盖：

1. GET 失败显示 alert 而不是空状态；
2. 点击重试后 GET 成功恢复列表；
3. POST 失败停留列表、无 `REV-LOCAL-*`、保留已有行、按钮恢复；
4. POST 成功只导航到服务端 ID；
5. 每行存在可键盘访问的“查看详情”；
6. 筛选按钮暴露 pressed 状态、选择框有 accessible name；
7. 历史反馈无原生 alert，并使用 status/Dialog；
8. ReviewList 不再展示不支持的删除和重复修改动作。

RED 阶段必须因目标行为缺失而失败，不能是 import、mock、环境或语法错误。实现后
转为 GREEN，再跑全量回归。

## Required Verification

在 worktree 内执行并回填精确结果：

```bash
git diff --check 910269a..HEAD
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ReviewList.test.jsx src/__tests__/ListPage.test.jsx
npm run test:web
npm run build:web
node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 910269a -- \
  ui/V2_PROTOTYPE/src/hooks/useReviewList.js \
  ui/V2_PROTOTYPE/src/pages/ReviewList.jsx \
  ui/V2_PROTOTYPE/src/components/ListPage.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx
git status --short --branch
```

如果只创建一个测试文件或某个允许文件未修改，按实际变更路径收窄命令，不要为满足
模板制造空文件。

## Browser Verification

必须使用当前实现的浏览器渲染证据；认证阻断时使用隔离本地 API 和合成数据，禁止
使用真实密码、token、用户数据或生产 API。

### 1440px

- 正常 6 行列表，搜索、筛选、行级“查看详情”与批量动作可见；
- GET 503 显示错误 + 重试，不显示成功空态；
- POST 500 留在列表、已有行保留、无 `REV-LOCAL-*`；
- POST 200 导航到服务端返回 ID；
- console error 为 0。

### 760px

- 页面 `scrollWidth <= clientWidth`，新增动作没有被裁切；
- 表格保持清晰的换行或局部滚动策略；
- 全局 Shell 的既有首屏堆叠只记录为 out-of-scope，不纳入本任务修复。

### Keyboard

- Tab 可到达行级“查看详情”；Enter/Space 可触发；
- 筛选与选择控件有可识别状态/名称；
- 历史反馈不会被 native alert 阻断；
- 焦点状态保持可见。

审计前截图参考：

- `docs/agent-loop/audits/assets/2026-07-31-ui-07-reviews/01-reviews-list-1440.png`
- `docs/agent-loop/audits/assets/2026-07-31-ui-07-reviews/02b-reviews-list-760-viewport.png`
- `docs/agent-loop/audits/assets/2026-07-31-ui-07-reviews/03-reviews-list-load-failure-1440.png`
- `docs/agent-loop/audits/assets/2026-07-31-ui-07-reviews/04-reviews-create-failure-ghost-detail-1440.png`

## Commit And Handoff

提交格式：

```text
feat(WES UI): UI-07 · 评审列表可信反馈与显式操作入口
```

最终 handoff 必须包含：

- 状态：`已回填 / 待 Codex 复核`；
- projectRoot、worktreePath、branch、baseCommit、head commit、clean status；
- 三个根问题逐项实现说明；
- changed files 和逐文件意图；
- RED 证据、focused/full/build/scope checker 精确结果；
- 1440px、760px、keyboard 和成功/失败浏览器证据；
- 已知风险与未验证项；
- 建议看板同步页面；
- `allowNextTask=false`、`integrationAuthorized=false`；
- 下一步只能是“等待 Codex 复核”。

最终不得：

- 宣布 `已交付`；
- cherry-pick、merge、push 或删除 worktree；
- 修改总看板 HTML；
- 自动领取 UI-06、评审详情或其他 UI 任务。

## Stop Conditions

遇到下列任一情况立即停止并回填阻断：

- 需要修改 allowedPaths 之外的业务文件；
- 需要更改后端 API、权限、DB、JWT 或数据模型；
- 需要引入新 UI 依赖；
- base commit 不存在、worktree/branch 冲突或无法隔离；
- 不能获得当前浏览器证据；
- 测试失败来自既有基线且无法与本任务隔离；
- 发现 UI-05 或 main checkout dirty changes 必须先被整合才能继续。
