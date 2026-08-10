# 工单 · O9：AI 模块 facade 落地迁移（消除 modules/ai 仅 re-export 违例）

> 状态：**已派发 KIMIK3（2026-08-10 Sprint 4 开工批准）**
> 类型：refactor（P2 架构债）· 来源：AGENTS.md §5 已声明 21 领域迁移完成，modules/ai 为 facade 违例遗留
> 交叉引用：O4（AI 服务层 handler 化重构，已交付关闭，前置依赖已满足）/ ISS-2026-08-05-001（凭据域 DB 化，在途，不阻塞）
> base：`a0cfcf5`（main HEAD，Sprint 4 开工状态更新后）
> 分支：`qoder/sprint4-o9-ai-module-facade-migration` · worktree：`/Users/kevin/AI/wes-worktrees/sprint4-o9`

---

## 1. 业务症状（架构债视角）

`apps/api/src/modules/ai/ai.module.ts` 当前为纯 re-export 文件（从 `ai.controller` 直接 export 8 个函数），无 controller/usecase/repository 三层结构，违反 AGENTS.md §5「21 领域全部完成三层迁移」的口径。routes 层通过 `import * as AiModule` 消费，契约与实现耦合在 controller 文件。

## 2. 根因

O4（AI 服务层 handler 化重构）已完成意图拆分（7 个 handler），但 modules/ai 未同步升级为标准三层 facade——controller 仍直接承载业务逻辑，无独立 usecase 层做编排。

## 3. 修复方案（契约零变更）

### 3.1 新建三层结构（Allowed Paths 内）
- `apps/api/src/modules/ai/ai.usecase.ts`：从现有 controller 提取业务编排逻辑（意图路由、handler 调度、流式/非流式分支），controller 仅做 HTTP 适配；
- `apps/api/src/modules/ai/ai.repository.ts`：若 controller 中存在直接文件/JSON 读写（如 requirement-settings.json 非密钥部分），下沉至此；密钥部分已移凭据域（ISS-2026-08-05-001），此处不碰；
- `apps/api/src/modules/ai/ai.controller.ts`：精简为 Express handler 适配层，调 usecase；
- `apps/api/src/modules/ai/ai.module.ts`：改为标准 barrel，export `{ aiController, aiUsecase, aiRepository }`（或工厂函数），不再直接 re-export controller 函数。

### 3.2 routes 层兼容
- `apps/api/src/routes/ai.routes.ts`：当前 `import * as AiModule from "../modules/ai/ai.module"`；迁移后改为 `import { aiController } from "../modules/ai/ai.module"`，路由注册逻辑不变；
- 若 routes 层直接调 `AiModule.chat` 等具名函数，改为 `aiController.chat` 或解构；契约（URL/方法/请求体/响应体）**零变更**。

### 3.3 测试迁移
- 现有 `ai.controller.test.ts`（若有）拆为 controller 层 HTTP 契约测试 + usecase 层业务逻辑测试；
- 新增 `ai.usecase.test.ts`、`ai.repository.test.ts`；
- test:modules 基线 ≥321 不下降。

### 3.4 明确禁止
1. 禁止改任何 URL 路由、请求/响应契约；
2. 禁止碰凭据域（ISS-2026-08-05-001 在途，apiKey 读写已由该工单接管）；
3. 禁止碰流式通道（workbench-chat-stream.handler.ts、workbench-chat.workflow.ts 等）；
4. 禁止改前端、看板页。

## 4. Allowed Paths

1. `apps/api/src/modules/ai/ai.usecase.ts`（新增）
2. `apps/api/src/modules/ai/ai.repository.ts`（新增/扩展）
3. `apps/api/src/modules/ai/ai.controller.ts`（重构）
4. `apps/api/src/modules/ai/ai.module.ts`（重构为 barrel）
5. `apps/api/src/modules/ai/ai.usecase.test.ts`（新增）
6. `apps/api/src/modules/ai/ai.repository.test.ts`（新增）
7. `apps/api/src/routes/ai.routes.ts`（兼容引用调整）
8. `apps/api/src/modules/ai/ai.controller.test.ts`（重构/迁移）

## 5. RED（≥3）

1. **三层存在性**：`ai.module` export 含 usecase/repository 实例，controller 不直接 export 业务函数——base 代码应红（现纯 re-export）；
2. **契约不变**：路由层所有 endpoint 请求/响应与 base 一致——base 应绿（不改契约），但新增用例守护；
3. **测试覆盖**：usecase.test.ts 覆盖意图路由分支 ≥2 条——base 应红（无该文件）。

## 6. 验证矩阵

- `npm run test:modules`：≥321 + 新增用例全过
- `npm run build:api`：零错误
- `npm run test:web`：≥288（前端零改动）
- `git diff a0cfcf5 -- apps/api/src/modules/ai/ apps/api/src/routes/ai.routes.ts`：全落 §4

## 7–9. 分支 / Handoff / 验收

- 分支 `qoder/sprint4-o9-ai-module-facade-migration`，worktree 内作业；
- handoff 按 wes-multi-agent-collaboration SKILL.md；
- 验收：test:modules 全绿 + build 零错误 + 路由契约 diff 为空（可用 `git diff --stat` 确认 routes 仅 import 调整）。
