# 工单 ISS-2026-08-10-002 · 右下角全局「后台任务」角标不计数（Shell provider 缺新 run 刷新触发）

> 状态：已派发 KIMIK3（2026-08-10 用户批准） · 分诊 defect P1 · 来源：MT-ISS001-001 验收实测（会话 87c73939-a03e-4bda-87c7-6f148a639213）
> 交叉引用：ISS-2026-08-10-001（顶栏角标数据源，已合入 af1f250）、ISS-2026-08-09-003（读取侧对账，已合入）

## 1. 背景与症状

用户验收实测：开异步开关发问，AI 回答中——**顶栏**「后台任务 进行中 1 · 已完成 0」正确，**右下角全局悬浮角标**恒显「后台任务 0」；切走页签再返回仍为 0；任务完成后亦不收敛、无终态通知。占位恢复与顶栏角标已通过验收。

两个角标是**独立组件、独立数据源**：
- 顶栏：`ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx` 的 `runCounts`，取自统一视图 `workbench.unifiedView.runs`（工作台页提交后自行重拉，故正确）。
- 右下角：`ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx` 的 `ShellBackgroundRuns`，取自 `useBackgroundRuns()` 的 `activeCount = runs.length`（Shell 层 `BackgroundRunProvider` 维护）。

## 2. 根因取证（置信度高）

`ui/V2_PROTOTYPE/src/hooks/useBackgroundRuns.jsx`：

- `refresh()`（L59-72）调用 `listActiveRuns()` 更新 `runs`；**触发时机仅四处**：挂载（L184）、终态事件（L102）、cancelRun（L201）、失败退避重试（L68）。
- context value（L205-213）**未暴露 refresh**；`AiHomeWorkbench/index.jsx` 提交流程对 provider 零通知。
- 后果链：用户提交创建 run → provider 的 `runs` 停留挂载时空数组 → `activeCount` 恒 0 → 订阅协调 effect（L123-148）不为新 run 建 SSE → 终态事件无人消费 → 终态通知缺失、SessionRail 行级徽标亦缺。

**非数据源缺口**：后端 `GET /api/v1/ai/runs/`（`listActiveRunsForOwner`）提交后即返回真实 run——`apps/api/src/modules/harness/f-group-acceptance.test.ts` L226-242 已证「提交后 listActiveRuns 返回真实 run 且 activeCount > 0」。

历史缺口说明：ISS-003 C3 与 ISS-001 的角标修复均落在**顶栏**（统一视图），用户原始症状对象（右下角全局角标）从未被修复。

## 3. 修复方案

**方案 A（推荐）**：context 暴露节流刷新入口（如 `notifyRunsChanged`，内部 1-2s 节流 + mounted 守卫，复用现有 `refresh`），`AiHomeWorkbench` 在提交成功回调 / 统一视图发现新 runId 时调用一次。
**方案 B（备选）**：`sessionRuntimeStore` 在 run 创建时派发模块级事件，provider 挂载期监听并 `refresh`。
两方案均须遵循既有硬口径：**卸载/离页只 abort 本地连接，零 cancel**；flag 关闭静默降级不变。

## 4. Worktree Contract

- base：main HEAD = 64b8398（2026-08-10 派发时实填）
- 分支：`qoder/iss-2026-08-10-002-shell-badge-refresh`
- 初始化双 npm install（根 + ui/V2_PROTOTYPE），exit 0 才可开工
- 状态上限「已回填 / 待主会话复审」，不得自宣交付

## 5. Allowed Paths

1. `ui/V2_PROTOTYPE/src/hooks/useBackgroundRuns.jsx`
2. `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx`
3. `ui/V2_PROTOTYPE/src/__tests__/background-runs.test.jsx`（仅追加用例，禁止新建测试文件）
4. `ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx`（仅追加，如需要）
5. `docs/agent-loop/handoffs/2026-08-10-qoder-ISS-2026-08-10-002.md`（新建）

Forbidden：apps/web 复活、V0_SAAS 当主线、宽泛 reset/clean/restore、 secrets 入任何产物、无关看板收官、package.json 新增依赖。

## 6. RED 先行（≥3 例，全写入既有测试文件）

1. provider 挂载后（runs 空）模拟后端出现新活跃 run，调用暴露的刷新入口 → `activeCount` 变 1、SSE 订阅建立（当前代码无入口，先红）。
2. 工作台提交成功后触发刷新入口（spy 断言调用 ≥1 次）。
3. 回归：provider 卸载零 cancel（既有 G2 用例保持绿）。

## 7. 验证矩阵

- `npm run test:web` ≥ 280 + 新增（基线 280）
- `npm run test:modules` 321/321（后端零改动复验）
- `npm run build:api` / `npm run build:web` 零错误
- `git diff <base> -- apps/ package-lock.json` 零输出

## 8. 硬纪律

1. diff 全落 Allowed Paths；2. RED 证据（先红截图/输出）入 handoff；3. 验证命令在依赖已装环境实跑；4. handoff 含 git log 实输出、风险节、范围外观察。

## 9. 验收口径（修复后人工复测，并入 MT-ISS001-001 复测）

发问后 2s 内右下角角标 ≥1；完成后收敛并弹「已完成」通知；切走返回数字一致；SessionRail 行级徽标同步。
