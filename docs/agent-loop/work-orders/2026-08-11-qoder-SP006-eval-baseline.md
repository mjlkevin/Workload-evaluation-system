# 工单 · SP-2026-006：AI 输出质量回归基线升级（LLM 裁判 + 三类产物样本 + MS5 评测资产合并）

> 状态：**已批准开工（2026-08-11 用户拍板：MS5/SP-006 对齐不转发、内部消化，合并出一张工单）**
> 类型：feat（P1）· 来源：SP-2026-006（O6 · DeepEval 方法论借鉴 GT-001）+ SP-2026-007 MS5 评测资产部分；需求登记 RP-054
> 合并理由：两边重叠的是评测基建（样本格式 / runner / 报告格式 / LLM 裁判 / 报告入口），同一作者一次落地可彻底消除重复建设；MS5 剩余部分（Trace Schema 草案、M1–M4 迭代必附对比报告制度、前端报告面板）不在本批，留 SP-2026-007 MS5 收口
> base：`746fb5e`（main HEAD）· 分支：`qoder/sp006-eval-baseline` · worktree：`/Users/kevin/AI/wes-worktrees/sp006-eval-baseline`
> 现状基座：RP-048 骨架已合入 main——`apps/api/src/services/ai/eval/`（samples.ts 14 样本 + assertions.ts 6 类确定性断言 + runner.test.ts，挂 test:ai，零 LLM 外部依赖）

---

## 1. 业务症状

- 三类核心 AI 产物（工作量评估、售前简报、需求解析报告）没有"是否真的变好了"的回归线；现有骨架只覆盖工作台意图路由样本，且全是确定性断言，评不了语义质量。
- 记忆/检索能力（MS1/MS2 已合入）同样无固定评测样本，M1–M4 后续迭代无法回答"有没有提升"。
- LLM 裁判模型选型是 SP-2026-006 唯一待决策项，骨架未含语义评分通道。

## 2. 修复方案

### Step 0 · LLM 裁判选型（先行交付物）

1. 产出选型对比文档 `docs/agent-loop/eval-judge-selection-2026-08-11.md`：候选 = 当前系统已配置模型（复用模型配置域读取链，不碰凭据域实现），维度 = 评分一致性 / 单次成本 / 时延；给出推荐默认值并先行落地，handoff 中标注待用户确认。

### Step 1 · 评测基建升级（TS 轻量版，零框架引入）

2. `eval/` 下新增裁判通道（如 `judge.ts`）：对样本输出做语义评分（维度建议：结构完整性 / 事实一致性 / 可执行性），与既有 6 类确定性断言并存；**裁判调用失败必须降级**为仅结构断言 + 报告标记 `judge_degraded`，不得阻塞 CI；
3. 报告输出 `report.ts`：JSON 报告对齐 `05_测试与质量/测试报告/` 既有格式，含基线 vs 当前对比；结构断言部分两次运行结果必须一致，裁判分数允许波动并保留 raw 记录。

### Step 2 · 三类产物样本扩展

4. 工作量评估、售前简报、需求解析报告各补固定样本 ≥5 组（样本 = 输入 + 结构断言 + 裁判评分点），挂入同一 runner；骨架 14 样本与 6 类断言**零回归**。

### Step 3 · MS5 评测资产（记忆/检索域）

5. 30 组「项目背景 → 应召回的记忆/知识」固定样本落评测资产目录（JSON，放 `apps/api/src/services/ai/eval/__assets__/` 或 `data/` 下审计后确定）；
6. 三项指标接入同一 runner：召回命中率、注入体积、端到端回答引用正确率；指标定义与方案文档 §M5 验收口径一致（默认注入体积 ≤6000 字符等护栏沿用 M1 口径）。

### 明确禁止（硬口径）

1. 禁止引入 Python / DeepEval 框架，禁止新增 npm 依赖（dependencies/devDependencies 零变更）；
2. 前端零改动；禁止碰系统管理页与任何在途批次文件；
3. 禁止碰凭据域实现（裁判取模型配置只走既有读取链）；API Key 不得出现在任何文件与输出中；
4. 骨架既有样本/断言行为零变更（只增不改）；
5. 新增测试文件必须挂入 `apps/api/package.json` 对应 test 脚本清单（允许的唯一 package.json 改动；若与 MS3 工单并行产生同行冲突，按 08-09 先例逐行比对双方新增、禁止整块选边）。

## 3. Allowed Paths

1. `apps/api/src/services/ai/eval/`（samples.ts / assertions.ts / runner.test.ts 扩展；新增 judge.ts / report.ts 及测试）
2. `apps/api/src/services/ai/eval/__assets__/` 或 `data/`（新增评测样本 JSON，审计后二选一）
3. `apps/api/package.json`（仅限 test:ai 脚本挂线新增文件）
4. `docs/agent-loop/eval-judge-selection-2026-08-11.md`（新增，裁判选型对比）
5. 裁判模型配置读取点（复用既有链，限读不改）

## 4. RED（≥3，先写失败测试）

1. **裁判通道存在性**：judge 模块导出 + 报告 JSON 含语义评分字段——base 应红（模块不存在）；
2. **降级路径**：裁判调用抛错时 runner 仍输出结构断言结果并标记 `judge_degraded`——base 应红（无裁判通道）；
3. **三类产物样本**：三类样本各 ≥5 组且断言全过——base 应红（样本不存在）；
4. **MS5 指标**：30 组样本加载 + 三指标字段出现于报告——base 应红（资产不存在）。

## 5. 验证矩阵

- `npm run test:ai`：新增用例全过，既有 244+ 不下降（以开工时 base 实跑为准；合入时若目标分支基线已涨，以合入时实跑不下降为准）
- `npm run test:modules`：不下降（base 746fb5e 口径 328）
- `npm run build:api`：零错误
- 结构断言两次运行结果一致（在 handoff 贴两次运行输出）
- `git diff 746fb5e --stat`：全部落 §3；`apps/api/package.json` diff 仅限 test 脚本行
- 裁判真实连通验证（用已配置密钥跑通一次评分）在 handoff 中标注是否执行、未执行原因

## 6. 分支 / Handoff / 验收

- worktree 内作业，先 `npm install`（根目录），打印 `Worktree Contract ACK` 后再动手；
- handoff 按 `skills/wes-qoder-worktree-protocol/references/protocol.md` 结构化回填，状态只能到「已回填 / 待 Codex 复核」；
- 验收：验证矩阵全绿 + 骨架零回归 + 降级路径测试通过 + 裁判选型文档随附；Codex 复核、用户对裁判选型拍板后决定是否合入 main。
