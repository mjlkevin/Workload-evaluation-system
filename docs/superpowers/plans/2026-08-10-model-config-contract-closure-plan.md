# 模型配置契约闭环优化计划（Model Config Contract Closure）

> 日期：2026-08-10 · 状态：**P1~P3 全部解锁**（凭据工单 ISS-2026-08-05-001 与修复单 ISS-2026-08-10-006 均已合入主线）
> 来源：2026-08-10 模型配置设计评审（截图：`/system/model-config` 三卡片 + API Key 管理）
> 基线：main HEAD `e607a40`；test:modules 328/328、build 零错误、web 299/299 全绿

---

## 0. 2026-08-10 晚更新：凭据工单已合入，开工事实重锚

GLM 凭据工单（`9fa7425` → merge `85b8248`）+ 修复单 ISS-2026-08-10-006（`19f899c` → merge `d6a9cfa`，KEK 缺失 dev 警告 + 启动验证 + 前端保存失败不清空输入框 + action key 分离）合入后，与本计划相关的代码事实已变为：

| 新事实 | 对本计划的影响 |
|---|---|
| `resolveActiveRequirementKimiApiKey()` 改为 **DB 缓存 → env** 两级（`system.repository.ts:402`），文件 apiKey 恒空 | 原 F8 已修复；P3 T11 只剩前端语义改造 |
| `credentials.store.ts` 已带**内存缓存** | T10 读盘缓存范围缩小：只剩 `requirement-settings.json` 文件读取缓存 |
| 测试连接密钥链已就位：`resolveDraftKimiApiKeyForTest()` = 显式传入 → DB → env（`system.repository.ts:414`） | T4 直接复用该链，只需把"测的模型"改为 resolvedModel |
| `system.usecase.ts` 已 async 化并传递 JWT actor | T12 生效审计可直接沿用 actor 模式 |
| 路由锚点确认：`GET /requirement-settings`、`POST /requirement-settings/kimi-api-key/test` 均在 `routes/system.routes.ts`（`system:manage` 守卫） | T2 effective 接口挂同一路由：`GET /requirement-settings/effective` |
| **ISS-006 教训：KEK 缺失时界面无前置提示，保存才报错** | T2 扩容：effective 接口同时返回**凭据健康状态**（已配置/来源/KEK 就绪/最近审计），T3 前端对应显示健康徽标 |
| ISS-006 改过 `useSystemManagement.js`（action key 重命名为 `saveModelDraftWithKey`）与 `SystemManagement.jsx` | T3/T5 前端施工须基于 `d6a9cfa` 之后代码，注意 action key 新命名 |
| 用户尚未录入新 Moonshot 密钥（旧密钥须轮换，用户暂缓） | AI 真实调用当前无密钥；T4 开发以 mock 测试为主，真实连通验证待用户录密钥后补 |

**工作区纪律**：主检出现存他会话 WIP 脏文件（UserManagement.jsx、Shell.jsx、requirement-settings.json 等），一律不碰；实施只动本计划任务列出的文件。

## 1. 背景：评审确认的八个事实（F8 已由 GLM 修复）

| # | 事实 | 证据 | 现状 |
|---|---|---|---|
| F1 | KIMI 评估卡片显示的模型（如 kimi-k3）**不生效**，评估主链路用 env `KIMI_MODEL`（默认 kimi-k2.5） | `assessment.service.ts:38`；`config/env.ts:36` | 待 T1 修复 |
| F2 | 评估温度配置（0.3）不生效：调用硬编码 `temperature: 0.1`；K2 系列在 provider 层不发送 temperature | `ai-assessment.ts:776`；`kimi-provider.ts:353` | 待 T8 能力矩阵驱动渲染 |
| F3 | `kimiEvaluation.timeoutMs` 名义是评估超时，实际被 7+ 处 handler 当作全局 AI 超时复用 | report-analysis、workbench-*、company-profile、harness-boot/usecase 等 | 待 P2 拆分 |
| F4 | 文件解析卡片仅 `fileParsing.model` 生效；`allowedExtensions / maxFileSizeMb / maxSheetCount / strictMode / ocrEnabled` 五字段零消费方 | `extractor.service.ts:361/437` | 待 T5 下架 / T9 接通 |
| F5 | 实际上传限制硬编码 10MB，与 UI 显示的 maxFileSizeMb=20MB 矛盾 | `ai.routes.ts:15`；`templates.routes.ts:12` | 待 T9 修复 |
| F6 | 生成模型整张卡片（`kimiGeneration` 全部字段）无任何业务消费方 | 全仓 grep 仅 system 模块自身读写 | 待 T5 下架 |
| F7 | "测试连通性"测的是配置里的模型，实际调用可能用 env 模型——测的与跑的不一致 | `SystemManagement.jsx:446` | 待 T4 修复 |
| ~~F8~~ | ~~apiKey 明文存 JSON，无变更审计~~ | — | ✅ 已由 ISS-2026-08-05-001 修复（DB 加密 + credential_audit） |

保留的优点：草稿/生效双态、旧模型名迁移与测试覆盖、凭据 DB 缓存→env 两级链 + 脱敏 hint、provider 层 temperature=1 错误自动重试、文件解析模型三级回退。

## 2. 目标架构：三层契约（对标 OpenAI Playground / Dify / OpenRouter / Bedrock）

```
模型目录 Model Registry（新增）
  每模型一条注册记录：id / displayName / provider / 能力矩阵
  （temperature: fixed|range、maxOutputTokens、contextWindow、status: available|deprecated）
场景绑定 Scenario Binding（现有三卡片改造）
  评估 / 文件解析 / 生成 / 对话 → 各绑定目录内一个模型 + 该模型支持的参数子集
生效状态 Effective State（新增只读层）
  GET /api/system/requirement-settings/effective 返回每场景：
  resolvedModel / source(ui|env_fallback) / supportedParams / lastVerified{at,ok,model,elapsedMs}
```

**铁律：前端不渲染后端没有消费方的字段；参数面板由能力矩阵驱动渲染**（不支持温度的模型不出温度控件，以一行说明替代，遵循 `?` Tooltip 约定）。

## 3. 与 GLM 凭据工单的关系（已闭环）

| 事项 | 处置 |
|---|---|
| 凭据迁移后端（加密落库 + 审计 + 幂等导入） | ✅ 已由 GLM 完成并合入（`85b8248`），本计划不重复建设 |
| `system.repository.ts` / `system.usecase.ts` 双线修改风险 | ✅ 已解除——GLM 已合入，P2 基于 `e84c727` 之后的新代码施工 |
| 凭据区前端改造（GLM 红线未碰前端） | 保留为 T11，范围缩小为语义标签 + 审计入口 |
| 模型配置生效审计（谁/何时生效哪版草稿） | GLM 未覆盖，保留 T12，复用 `credential_audit` 表模式与 actor 传递 |

## 4. P1 求真（可立即开工，预估 1.5~2 天）

**目标：界面不再有不生效的旋钮，所见即所得。**

| 任务 | 改动文件 | 验收口径 |
|---|---|---|
| T1 评估链路改读配置模型 | `services/ai/assessment.service.ts`（`model` 改取 `requirementSettings.kimiEvaluation.model`，env 仅作兜底） | 配置 kimi-k2.6 后评估响应 `meta.model` 与实际调用模型一致；模块测试覆盖 |
| T2 生效状态接口 | `routes/system.routes.ts` + `modules/system/system.controller.ts/usecase.ts`：新增 `GET /requirement-settings/effective`（只读装配，不改 repository schema），返回每场景 resolvedModel/source/supportedParams + **凭据健康**（已配置/来源/KEK 就绪/最近审计，吸收 ISS-006 教训） | 每场景返回 resolvedModel/source/supportedParams；env 兜底时 source=env_fallback；KEK 缺失或未配置时健康字段明确标示 |
| T3 前端表格化重构（RP-053，用户 2026-08-10 23:01 拍板：废弃卡片） | `SystemManagement.jsx` + hooks + 页内样式：三卡片改为**场景配置表**（列：场景/生效模型/来源/关键参数摘要/凭据健康/最近验证/状态/操作）；行内展开只读详情（全参数 + 草稿 vs 生效 diff）；编辑仍走 Dialog（项目约定，失败不清空输入沿用 ISS-006 修复）；API Key 区并入表格体系；死配置行置灰"规划中"（吸收 T5） | 三场景一屏可对比；env 兜底行黄色标示；KEK 缺失/未配置表格内可见预警；test:web 299 基线零回归 + build:web 通过 |
| T4 "验证此场景"替代"测试连通性" | `POST /requirement-settings/kimi-api-key/test` 升级为用 resolvedModel 发最小真实请求（密钥链复用 `resolveDraftKimiApiKeyForTest`）；前端按钮接新返回结构，结果显示在"最近验证"列 | 返回体含实际调用模型名 + 耗时；与 T1 链路模型一致；**用户已录入新密钥（····epCz），真实连通验证已解除阻塞** |
| ~~T5 死配置从 UI 下架~~ | 已并入 T3：死配置不再"下架删除"，改为表格内置灰"规划中"行（保留信息、明确不可用） | 见 T3 |

T1/T2/T4 遵循 TDD（RED-GREEN-REFACTOR），每步跑 `npm run test:modules`；T3/T5 跑 `npm run build:web` + web 测试。UI 批次遵循 `skills/improving-wes-ui`（单业务表面=模型配置页签，≤3 个已证实根问题/批）。

## 5. P2 建模（已解锁，建议 P1 合入后开工，预估 2~3 天）

| 任务 | 内容 | 验收口径 |
|---|---|---|
| T6 模型目录 | 新增 `config/model-registry.json` + 能力矩阵；`normalizeKimiConfiguredModel` 迁移逻辑并入目录校验 | 非法/弃用模型在保存时被拒并给出可选列表 |
| T7 场景配置统一解析 | 新增 `resolveScenarioConfig('assessment'|'fileParsing'|'generation')`，评估/解析/生成统一从它取 resolvedModel + 生效参数；顺带拆分 F3 的全局超时复用 | 三场景全走同一解析入口；评估超时可独立调整不影响对话流 |
| T8 参数区动态渲染 | effective 接口下发 supportedParams，前端编辑弹窗按能力矩阵出控件（F2 的根治） | 选 K2 模型时温度控件不渲染且有一行说明 |
| T9 上传限制接通 | `maxFileSizeMb` 驱动 multer（消灭 F5 的 20MB vs 10MB 矛盾）；`allowedExtensions/maxSheetCount` 接入上传校验；接不了的字段（strictMode/ocrEnabled 若无消费方）从 schema 删除 | 超限上传被拒且错误信息可读；配置值与实际限制一致 |
| T10 配置读盘缓存 | `loadRequirementSystemConfigStore()` 加 mtime 内存缓存（凭据缓存 GLM 已做，此处只剩文件读） | 连续 AI 调用不重复同步读盘；配置生效后缓存正确失效 |

## 6. P3 治理（已解锁，预估 1~2 天，范围较原计划缩小）

| 任务 | 内容 | 验收口径 |
|---|---|---|
| T11 凭据区前端语义改造 | API Key 区标签从"仓库存储密钥"改为"凭据域托管（加密落库）"；加"变更记录"入口展示最近 credential_audit 记录（需一个只读审计查询接口） | 页面语义与 DB 存储事实一致；可见最近 set/clear 审计行（时间 + actor，不含密钥） |
| T12 配置生效审计 | 记录谁/何时将哪版模型配置草稿生效，复用 `credential_audit` 表模式与 usecase 已就位的 actor 传递 | 生效操作产生审计行，页面可查最近生效记录 |

## 7. 验证命令基线（已按合入后更新）

- `npm run test:modules`（当前基线 **328** 全绿，新增用例随批增加）
- `npm run build:web` / `npm run build:api` 零错误
- web 测试基线 **299/299 全绿**（ISS-006 后 UserManagement 既有失败已消除）
- 前端相关批次更新 `ui/V2_PROTOTYPE/src/__tests__/ModelConfig.test.jsx` 等既有测试

## 8. 纪律与边界

- 主检出 WIP 脏文件（UserManagement.jsx、Shell.jsx、requirement-settings.json 等）一律不碰、不提交、不回退。
- 不引入第二前端/后端实现；UI 改动遵循 `skills/improving-wes-ui`。
- 实施遵循 `skills/wes-tdd` RED-GREEN-REFACTOR；每批完成后按 `skills/maintain-wes-command-board` 同步 plan.html / changes.html，T6/T7 落地时补 design.html 三层契约图。
- 真实 AI 连通验证（T4 收尾、评估链路实跑）依赖用户录入新 Moonshot 密钥，未录入前以 mock 测试为准。
