# 工单 · SP-2026-007 MS3：工具发现两段式接口 + MS2-PATCH 前端补丁 + MS2 蒸馏集成测试补测

> 状态：**已批准开工（2026-08-11 用户拍板方案 A：MS3 主体 + MS2-PATCH + MS2 测试补测打包派发）**
> 类型：feat（P1）· 来源：SP-2026-007 M3（RP-018 范围扩展）+ MS2-PATCH（RP-052 补充，方案文档 2026-08-10 修订版）+ MS2 集成测试缺口
> 打包理由：MS2-PATCH 的「引用记忆」标记与 M3 的工具发现 trace chip 同文件同设计语言（`ModelRunTrace.jsx`），拆单会同文件冲突；补测为 MS2 质量收尾，随批关闭
> base：`746fb5e`（main HEAD）· 分支：`qoder/sp007-ms3-tool-discovery` · worktree：`/Users/kevin/AI/wes-worktrees/sp007-ms3`
> 方案依据：`03_技术设计/系统架构/WES-Agent-升级总看板/archive-md/agent-memory-borrowing-plan-2026-08-09.md` §M3、§MS2-PATCH

---

## 1. 业务症状

- **M3**：Agent 工具清单一次性全量注入 `tools` 参数，随工具增多上下文体积线性膨胀，模型在无关工具中做选择，路由偏移风险上升（RP-025 同类问题）。
- **MS2-PATCH**：MS2 记忆蒸馏后端已合入 main，但用户在 AI 工作台完全无感知——draft 记忆无提示、确认入口深埋系统管理后台，「聊完→看记忆→确认→下次自动带入」闭环断裂，功能处于「后端就绪、前端不可见」半哑状态。
- **补测**：蒸馏失败目前在 `harness-boot.ts:148` 仅 `console.error` 留痕，无集成测试覆盖，失败可静默通过。

## 2. 修复方案

### 2.1 M3 后端（约 16h）

1. `apps/api/src/agent/tool-registry.ts`：工具元数据增加 `category` 与 `discoverable` 标记；
2. 新增内置工具 `list_tools`（读、自动执行）：入参意图描述/类别，返回权限内匹配工具的说明书子集，结果必须经 RBAC 能力位过滤；
3. `orchestrator.ts`：默认注入集收敛为「核心工具 + list_tools」，其余工具经发现后进入当轮 tools 参数；保留全量注入回退开关（配置项），异常可一键回退旧行为，**默认启用按需发现**；
4. RP-018 知识库资源工具按此模式注册为首个 discoverable 试点（注册点现状审计后确定，落 §4 允许路径内）。

### 2.2 前端（M3 trace chip + MS2-PATCH，约 8h，须遵循 `skills/improving-wes-ui`：`npx ui-skills start` 前置、单业务表面 = AI 工作台对话流、≤3 根问题、浏览器渲染证据）

5. **工具发现 trace chip**：`ModelRunTrace.jsx` 扩展通用「工具调用」chip——Agent 经 `list_tools` 选中工具执行后，消息下方展示可折叠 trace（复用既有「知识库参考」chip 模式）；
6. **待确认记忆提示条**：run 终态（completed/failed）后若该项目存在 draft 记忆，在对话区域底部或状态面板出提示条（「本次会话产生了 N 条待确认记忆 →」），点击跳转系统管理·记忆管理面板并自动筛选 draft；挂载点（`ChatArea/index.jsx` vs `StatusPanel/index.jsx`）审计后确定；
7. **记忆注入透明度**：AI 回复引用 active 记忆时，trace 区域展示「引用记忆」标记，与条目 5 统一设计语言。

### 2.3 MS2 蒸馏集成测试补测（约 2–3h）

8. 新增集成测试：run 进入终态触发蒸馏钩子；蒸馏失败路径有断言留痕（不得仅 console.error 静默）；蒸馏产物 draft 未确认不注入。优先零生产代码改动；确需可注入性调整时仅限 `harness-boot.ts` 最小改动并在 handoff 中说明。

### 2.4 明确禁止（硬口径）

1. 禁止改任何 URL 路由、请求/响应契约；既有工具调用行为在「全量回退」模式下逐字节一致；
2. **禁止触碰另一会话在途 P1 批次文件**：`apps/api/src/modules/system/*`、`apps/api/src/routes/system.routes.ts`、`apps/api/src/services/ai/assessment.service.ts`、`apps/api/src/utils/file.ts`、`apps/api/package.json`、`ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`、`ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`、`ui/V2_PROTOTYPE/layout.css`、`ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`、`config/system/*`；
3. 「工具注入模式」系统管理前端入口**不在本批**（SystemManagement.jsx 在途冲突），本批只交付后端配置项 + 读取接口；前端入口拆后续小单；
4. 禁止碰凭据域、流式通道（workbench-chat-stream/workflow）、看板页；
5. 禁止引入新 npm 依赖（dependencies/devDependencies 零变更）；**新增测试文件必须挂入 `apps/api/package.json` 对应 test 脚本清单**——这是允许的唯一 package.json 改动（防「测试写了没挂线」第三次发生）；若与并行的 SP-006 评测工单（`qoder/sp006-eval-baseline`）在同行冲突，按 08-09 先例逐行比对双方新增、禁止整块选边。

## 3. Allowed Paths

1. `apps/api/src/agent/tool-registry.ts`、`default-registry.ts`、`orchestrator.ts`、`agent.types.ts`（扩展）
2. `apps/api/src/agent/tools/`（新增 `list-tools.tools.ts` 及测试；RP-018 知识库工具注册调整）
3. `apps/api/src/agent/*.test.ts`（新增/扩展守护测试）
4. `apps/api/src/modules/harness/harness-boot.ts`（仅限补测所需最小可注入性调整）
5. `apps/api/src/modules/harness/*.test.ts` 或 `apps/api/src/modules/memory/*.test.ts`（新增蒸馏集成测试）
6. `apps/api/src/modules/knowledge/`（如需配合 discoverable 注册）
7. `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/StatusPanel/ModelRunTrace.jsx`（chip 扩展）
8. `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/index.jsx` 或 `StatusPanel/index.jsx`（提示条，审计后二选一）
9. `ui/V2_PROTOTYPE/src/__tests__/`（新增前端守护测试）
10. 全量注入开关配置读取点（现状审计后确定，限 `apps/api/src/config*` 或既有配置模式，不新增配置文件类型）

## 4. RED（≥3，先写失败测试）

1. **list_tools 存在性**：注册表含 `list_tools`，按意图返回子集且越权工具不可见——base 应红（工具不存在）；
2. **默认注入收敛**：编排循环默认注入工具数较全量模式下降 ≥ 50%（对比断言）——base 应红（现全量注入）；
3. **蒸馏集成**：终态钩子触发蒸馏 + 失败路径断言留痕——base 应红（无集成覆盖）；
4. **前端提示条**：draft 记忆存在时提示条渲染并可跳转筛选——base 应红（组件不存在）。

## 5. 验证矩阵

- `npm run test:modules`：新增用例全过，基线不下降（base 746fb5e 口径 328；合入时若目标分支基线已涨，以合入时实跑不下降为准）
- `npm run test:ai`：基线不下降（base 口径 256）；RP-025 类意图路由回归用例全过
- `npm run test --prefix ui/V2_PROTOTYPE`：基线不下降（base 口径 299）+ 新增组件测试全过
- `npm run build:api`、`npm run build:web`：零错误
- 前端渲染证据：trace chip / 提示条 / 引用记忆标记在 1440px 与 760px 两档浏览器证据（截图或脚本断言）
- `git diff 746fb5e --stat`：全部落 §3 Allowed Paths；`apps/api/package.json` 依赖零变更、diff 仅限 test 脚本挂线行

## 6. 分支 / Handoff / 验收

- worktree 内作业，先 `npm install`（根 + `ui/V2_PROTOTYPE/`），打印 `Worktree Contract ACK` 后再动手；
- handoff 按 `skills/wes-qoder-worktree-protocol/references/protocol.md` 结构化回填，状态只能到「已回填 / 待 Codex 复核」；
- 验收：验证矩阵全绿 + 回退开关实测有效（全量模式下旧行为一致）+ RBAC 过滤测试覆盖 + 前端两档渲染证据；Codex 复核通过后由用户决定是否合入 main。
