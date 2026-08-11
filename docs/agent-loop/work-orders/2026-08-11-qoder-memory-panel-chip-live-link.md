# 工单 · 记忆管理面板恒空修复（DEF-2026-08-11-001）+ MS3 工具发现 chip 活数据链路

> 状态：**已编制（2026-08-11 用户拍板：面板恒空缺陷 + chip 链路合并一张工单）/ 待派发**
> 类型：fix（P1，S2 缺陷）+ feat（设计性缺口补齐）· 来源：SP-2026-007 MS3 回填复核两个遗留（Qoder handoff 自发现 + Codex 复核确认）
> 合并理由：两项同为 MS3/MS2「后端已就位、前端不可见」的读取侧/数据通路缺口，验收都依赖真实对话链路走通，一张工单一次验证闭环
> base：`e521fcb`（main HEAD，MS3 合入后）· 分支：`qoder/memory-panel-chip-live-link` · worktree：`/Users/kevin/AI/wes-worktrees/memory-panel-chip`
> 关联：ISS-2026-08-11-002 / DEF-2026-08-11-001 / RP-052 / RP-018 / risks.html BE-2026-08-11-sp007-ms3-review:risks:1-2

---

## 1. 业务症状

- **面板恒空（缺陷）**：系统管理 → 记忆管理面板在生产环境很可能恒空。根因两缺口叠加：① 后端 `memory.usecase.listMemory` 查询条件未传 projectId（多项目隔离字段缺失，恒返回空集）；② 前端 `MemoryManagementPanel.jsx` 请求自始至终不携带 projectId，且不读取 `?status=draft` query——MS2-PATCH 交付的蒸馏成功提示条「去确认」跳转 `/system?tab=memory&status=draft` 落地后无自动筛选。后果：RP-052「蒸馏产物在 UI 可见、可确认」人工验收口径不成立（后端蒸馏落 PG 正常，harness-boot 12 用例守护）。
- **chip 活数据链路缺口（设计性）**：MS3 已交付工具发现 / 引用记忆 / 记忆注入透明度三个 trace chip（`ModelRunTrace.jsx`，随 e521fcb 合入），但 dispatch 链路不过编排器，chip 无生产数据通路——真实对话中 chip 不亮，MS3 前端交付的用户价值不可见。

## 2. 修复方案

### 2.1 记忆面板恒空修复（约 1–2h + 测试）

1. `apps/api/src/modules/harness/memory.usecase.ts`：`listMemory` 缺 projectId 时改返回 owner 全量或默认 `default` 项目（与 harness 其他读取口径对齐，施工前审计既有读取口径后选定并在 handoff 说明）；
2. `MemoryManagementPanel.jsx`：请求携带 projectId（取当前项目上下文）；读取 location query 初始化 status filter，`?status=draft` 跳转后自动筛选 draft；
3. 补 RED 测试（见 §4）。

### 2.2 chip 活数据链路（约 3–4h）

4. dispatch 链路 trace 增加 **additive 字段**承载 chip 所需数据（工具发现结果、引用记忆标记），不得改变既有字段语义与事件契约——施工前审计 MS3 三个 chip 组件所需数据形状（`ModelRunTrace.jsx` 与 memory-visibility 测试为基准），从 dispatch trace 组装点透传；
5. 前端 `ModelRunTrace.jsx` / ChatArea 链路透传渲染，真实 dispatch run 下 chip 可见；
6. 数据缺失时保持 MS3 已交付的静默降级行为（不报错、不空框）。

### 2.3 明确禁止（硬口径）

1. 禁止改任何 URL 路由、请求/响应契约的既有字段语义；新增字段一律 additive；
2. **禁止触碰 RP-055 在途批次文件**：`apps/api/src/modules/system/*`（credentials.store / system.repository / system.usecase 等）、`config/system/*`、`ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` 本体、`useSystemManagement.js`——`MemoryManagementPanel.jsx` 为本工单唯一获准的 SystemManagement 目录文件；**若 RP-055 批 2（前端）开工，须与本工单串行：先合入本工单或 rebase，禁止并行改同目录**；
3. 禁止碰凭据域、流式通道（workbench-chat-stream/workflow）、看板页、SP-006 评测工单在途文件；
4. 禁止引入新 npm 依赖；**新增测试文件必须挂入 `apps/api/package.json` 对应 test 脚本清单**（允许的唯一 package.json 改动）；若与 SP-006（`qoder/sp006-eval-baseline`）在同行冲突，按 08-09 先例逐行比对双方新增、禁止整块选边。

## 3. Allowed Paths

1. `apps/api/src/modules/harness/memory.usecase.ts`（listMemory projectId 口径）
2. `apps/api/src/modules/harness/*.test.ts`（新增/扩展守护测试）
3. `ui/V2_PROTOTYPE/src/pages/SystemManagement/MemoryManagementPanel.jsx`（请求带 projectId + query 初始化筛选）
4. dispatch trace 组装点（审计后确定，候选 `apps/api/src/modules/ai/` 或 `apps/api/src/services/ai/` 内 dispatch 路径；trace 类型定义随之扩展）
5. `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx` 与 ChatArea 链路（chip 数据透传）
6. `ui/V2_PROTOTYPE/src/__tests__/`（新增前端守护测试）

## 4. RED（≥3，先写失败测试）

1. **listMemory 非空**：无 projectId 调用返回 owner 全量（或 default 项目）记录——base 应红（现恒空）；
2. **面板 query 初始化**：`?status=draft` 渲染时 status filter 自动为 draft——base 应红（不读 query）；
3. **chip 数据通路**：dispatch trace 含 chip 所需 additive 字段的守护断言——base 应红（字段不存在）；
4. **chip 渲染**：trace 带工具发现/引用记忆数据时对应 chip 渲染——base 应红（无数据通路时组件不亮）。

## 5. 验证矩阵

- `npm run test:modules`：新增用例全过，基线不下降（base e521fcb 口径 335）
- `npm run test:harness`：基线不下降（base 口径 187 例 0 fail / 75 skipped 为 DB 依赖既有模式）
- `npm run test:ai`：基线不下降（base 口径 260）
- `npm run test --prefix ui/V2_PROTOTYPE`：基线不下降（base 口径 306/307，唯一失败 UserManagement「persists bulk role changes」为预置问题）+ 新增组件测试全过
- `npm run build:api`、`npm run build:web`：零错误
- 真实链路证据：一次真实 dispatch run 的 trace 数据（脚本断言或截图）证明 chip 字段到达前端；面板在非空项目下的真实数据渲染证据（1440px + 760px 两档）
- `git diff e521fcb --stat`：全部落 §3 Allowed Paths；`apps/api/package.json` diff 仅限 test 脚本挂线行

## 6. 分支 / Handoff / 验收

- worktree 内作业，先 `npm install`（根 + `ui/V2_PROTOTYPE/`），打印 `Worktree Contract ACK` 后再动手；
- handoff 按 `skills/wes-qoder-worktree-protocol/references/protocol.md` 结构化回填，状态只能到「已回填 / 待 Codex 复核」；
- 验收口径：① 面板真实数据非空，draft 记忆可见可确认（RP-052 人工验收解锁）；② MS2-PATCH 提示条「去确认」跳转后自动筛选 draft；③ 真实 dispatch run 下 MS3 chip 可见；④ 验证矩阵全绿；Codex 复核通过后由用户决定是否合入 main；
- 合入后看板收尾：DEF-2026-08-11-001 流转关闭、risks 两行关闭、RP-052 进入人工验收。
