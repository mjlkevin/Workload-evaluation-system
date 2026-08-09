# Qoder Sprint 3B Work Order — O6 AI 输出质量回归基线（RP-048 骨架）

- Date: 2026-08-09
- Executor: Qoder 执行会话
- Sprint 3 批次 B（用户 2026-08-09 批准开工）
- Status: 已派单（用户批准 Sprint 3 开工）

## 1. 合同坐标

- worktree: `.claude/worktrees/sprint3-quality-baseline`
- branch: `qoder/sprint3-quality-baseline`
- baseCommit: `4c28116`（main 当前 HEAD）
- 预计: 15h（RP-048 骨架：基线用例 + 断言框架 + 失败归档，非全量体系）
- 与 Sprint 3A（O5+O8，另一 worktree）文件零交集，可并行

## 2. 范围（RP-048 骨架，15h）

目标：AI 输出质量可回归——固定样本集 + 确定性断言 + 失败案例归档，让「AI 回答变差了」能被测试抓住。

### B1 固定样本集（≥12 条）
- 新建 `apps/api/src/services/ai/eval/` 目录：
  - `samples.ts`：固定评测样本，覆盖 ≥6 类场景：能力问法（你会干什么/支持哪些操作）、问候语、显式报告请求、业务咨询（WES/ERP 口径类）、附件问答引导、超范围请求（应被 Batch A 拦截）
  - 每条样本定义：输入 message、期望意图分类、结构断言集

### B2 确定性断言框架（本批不接 LLM 裁判）
- `assertions.ts`：对 dispatch 结果做确定性断言——
  - 意图路由正确（intent 类型 + routingRule）
  - 回复非空且长度在合理区间（防空回复/失控长文）
  - capability 回复不得出现事实表之外的能力承诺（对照 CAPABILITY_FACTS 关键词校验）
  - 超范围样本必须命中 unsupported_or_out_of_scope
  - 报告请求样本必须命中 harness_report_generation
- **本批评分全部为确定性断言，不引入 LLM-as-judge**（保证测试零外部依赖、可 CI 稳定跑）；语义裁判作为 Sprint 4 升级项记录在 handoff 后续计划

### B3 测试命令与失败归档
- `runner.test.ts`：node:test 形式执行样本集，纳入 `npm run test:ai`（或新增 `npm run test:eval` 并挂入根 package.json scripts——允许修改根 package.json 的 scripts 字段，仅此一处）
- `failures/` 归档机制：断言失败时样本与失败原因结构化记录（测试输出即可，无需额外文件落盘）

### B4 文档
- `docs/agent-loop/testing/O6-质量基线说明.md`：样本清单、断言规则、如何新增样本、Sprint 4 语义裁判升级路径

## 3. 硬口径

- 只读消费既有实现（dispatch/intent/capability handler），**不得修改** services/ai 既有业务文件（capability.handler.ts、workbench-intent.service.ts、workbench-dispatch.service.ts 等）——质量基线是观测者，不改被观测对象
- CAPABILITY_FACTS 只读引用，不得改动
- 不新增依赖；不触碰 harness 模块、前端、总看板

## 4. Allowed Paths

- apps/api/src/services/ai/eval/（新建目录全部）
- package.json（仅 scripts 字段，若新增 test:eval）
- docs/agent-loop/testing/O6-质量基线说明.md（新建）
- docs/agent-loop/handoffs/2026-08-09-qoder-sprint3-B.md（回填）
- 禁止：services/ai 既有文件修改、modules/、ui/、总看板

## 5. 执行要求

- RED 先行：先写样本断言骨架再实现
- 验证命令（全部全绿方可回填）：`npm run test:ai`、`npm run test:modules`、`npm run build:api`（基线：ai 244 新增样本后总数上升、modules 265、build 0 错）
- 每项验证命令回填时**必须附实际输出摘要**（tests/pass/fail 计数），禁止只报部分命令
- 提交格式：`feat(ai): Sprint 3B · O6 AI 输出质量回归基线（RP-048 骨架）`；handoff 用 `docs(handoff): Sprint 3B 回填 · ...`
- 完成后状态停在「已回填 / 待主会话复审」

## 6. 初始化提示词（派单用）

```
你是 WES 项目的 Qoder 执行会话，负责执行 Sprint 3B（O6 AI 输出质量回归基线，RP-048 骨架）。先完整阅读 work order：docs/agent-loop/work-orders/2026-08-09-qoder-sprint3-B.md 与 AGENTS.md、QODER.md、skills/wes-qoder-worktree-protocol/SKILL.md。执行步骤：1) 完成 Worktree Contract ACK，初始化 worktree .claude/worktrees/sprint3-quality-baseline 与分支 qoder/sprint3-quality-baseline（baseCommit=4c28116）；2) 在 services/ai/eval/ 新建固定样本集（≥12 条覆盖 ≥6 类场景）+ 确定性断言框架 + 测试运行器，本批不接 LLM 裁判；3) 硬口径：只读消费既有 dispatch/intent/capability 实现，禁止修改 services/ai 既有业务文件；零新增依赖；4) 每项验证命令的实际输出摘要必须写入 handoff；5) 全部绿后回填 docs/agent-loop/handoffs/2026-08-09-qoder-sprint3-B.md，状态停在「已回填 / 待主会话复审」，不合并 main、不更新总看板。
```
