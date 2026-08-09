# Qoder Sprint 3B Handoff — O6 AI 输出质量回归基线（RP-048 骨架）

> Date: 2026-08-09  
> Executor: Qoder 执行会话  
> Status: 已回填 / 待主会话复审

---

## 目标

为 WES AI 工作台建立可回归的 AI 输出质量基线：固定样本集 + 确定性断言框架 + 测试运行器，让「AI 回答变差了」能被测试抓住。

范围：RP-048 骨架（15h 预算），不含 LLM-as-judge 语义裁判（Sprint 4 升级项）。

## Worktree

- projectRoot: `/Users/kevin/AI/Workload-evaluation-system`
- worktreePath: `/Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/sprint3-quality-baseline`
- branch: `qoder/sprint3-quality-baseline`
- baseCommit: `4c28116`
- taskId: RP-048 / Sprint 3B

## 变更文件

| 文件 | 操作 | 内容摘要 |
|---|---|---|
| `apps/api/src/services/ai/eval/samples.ts` | 新增 | 固定评测样本集：14 条样本，覆盖 8 类场景（能力问法、问候语、显式报告请求、业务咨询、附件问答引导、超范围请求、知识库查询、WES 数据查询） |
| `apps/api/src/services/ai/eval/assertions.ts` | 新增 | 确定性断言框架：6 类断言（intent_routing、routing_rule、answer_length、capability_facts_bound、out_of_scope_intercepted、report_request_routed） |
| `apps/api/src/services/ai/eval/runner.test.ts` | 新增 | 测试运行器（node:test）：12 个测试用例，含 intent 路由层基线（零模型调用）+ dispatch 端到端基线（含模型 mock）+ 3 组专项断言 |
| `apps/api/package.json` | 修改 | `test:ai` scripts 追加 `src/services/ai/eval/runner.test.ts` |
| `docs/agent-loop/testing/O6-质量基线说明.md` | 新增 | 样本清单、断言规则、新增样本指南、Sprint 4 语义裁判升级路径 |

## 验证命令与结果

### 1. `npm run test:ai`（全量 AI 测试）

- **结果：PASS**
- 测试总数：**256**（基线 244 + 新增 12）
- 通过：256 / 失败：0
- 新增 RP-048 测试：12 个全部通过
- 样本断言：14 样本 / 84 断言全部通过

关键输出摘要：
```
[RP-048 基线结果] 样本: 14/14 通过, 断言: 84/84 通过
✔ RP-048: sample set meets minimum requirements
✔ RP-048: intent routing baseline — capability discovery
✔ RP-048: intent routing baseline — greeting
✔ RP-048: intent routing baseline — explicit report request
✔ RP-048: intent routing baseline — business consultation
✔ RP-048: intent routing baseline — attachment qa guidance
✔ RP-048: intent routing baseline — knowledge query
✔ RP-048: intent routing baseline — wes data query
✔ RP-048: dispatch end-to-end baseline — all samples pass assertions
✔ RP-048: out-of-scope samples are intercepted with unsupported_or_out_of_scope
✔ RP-048: report request samples route to harness_report_generation
✔ RP-048: capability discovery replies stay within CAPABILITY_FACTS bounds
```

### 2. `npm run test:modules`（模块测试）

- **结果：基线既有失败，与本次变更无关**
- 测试总数：208
- 通过：207 / 失败：1
- 失败项：`src/modules/modules.handlers.test.ts`（基线既有问题，与 Sprint 3B 零文件交集）

### 3. `npm run build:api`（API 构建）

- **结果：基线既有错误，与本次变更无关**
- 错误数：3（全部来自 `src/ai/contracts/structured-output.ts`，ajv 类型版本冲突）
- 本次新增文件 `eval/*` 经 `tsc -p tsconfig.json --noEmit` 验证：**零错误**
- 根因：worktree 基于 `4c28116`，与当前 main checkout 共享 node_modules；main 在 `4c28116` 之后有依赖更新，导致基线代码与当前 node_modules 类型不匹配

## 风险

| 风险项 | 说明 | 缓解 |
|---|---|---|
| capability_facts_bound 为启发式校验 | 仅检测关键词越界，非语义级事实表对齐 | Sprint 4 升级为 LLM-as-judge |
| 超范围样本依赖模型分类兜底 | oos-001/002 需 mock 模型返回 unsupported 分类 | 实际运行需真实模型配合；规则路由本身不覆盖这些样本 |
| test:modules / build:api 基线既有失败 | 与 Sprint 3B 零文件交集，不影响交付 | 已在主会话记录 |

## 是否建议看板同步

**否。** 本次为 RP-048 骨架基础设施，不产生新的用户可见功能或需求状态变更。Sprint 4 语义裁判升级时再同步看板。

## 下一步建议

- **待 Codex 复核**：验证 worktree 内文件完整性、测试覆盖、提交信息
- **建议后续**：Sprint 4 接入 LLM-as-judge 语义裁判，扩展动态样本集
- **不合并 main**：本 worktree 基于 `4c28116`，需等待主会话确认基线依赖修复后再决定合并策略
