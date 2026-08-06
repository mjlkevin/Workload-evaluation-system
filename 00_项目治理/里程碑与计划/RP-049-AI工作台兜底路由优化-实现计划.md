# RP-049 AI 工作台兜底路由与静态回复策略优化 — 实现计划

> 来源问题：ISS-2026-08-06-001（会话 a4d3d9de-d793-48a2-ba87-e3606c165385）
> 状态：已纳入综合优化计划为 O10（P1，Sprint 2 排在 O4 之前，见 integrated-optimization-plan-2026-08-04.md §5.10）· Batch A 已交付关闭（e20e2c6，人工验收 6 样本冒烟通过 2026-08-06）· Batch B/C 待另行批准 · 实施走 Qoder worktree 协议 + Codex 复核
> 日期：2026-08-06

## 1. 根因回顾（三层叠加）

1. `routeWorkbenchIntent` 关键词规则覆盖窄：如"我需要发什么类型的文件给你"不命中任何规则，落入 `default_domain_qa`（`apps/api/src/services/ai/workbench-intent.service.ts` L146）。
2. RP-003 模型二次分类替换过激：`dispatchHomeWorkbenchTurn` 在兜底时调用 `classifyIntentWithModel`，置信度 ≥0.6 即**替换**意图为任意合法意图（`workbench-dispatch.service.ts` L940-955），包括 `capability_discovery` / `wes_data_query` / `write_action_request` 三个静态模板意图。
3. 静态模板不感知具体问题：`buildCapabilityResponse`（L326-362）恒返回全量 7 条能力清单（`model: "rule-static"`），不调用模型、不回答用户子问题，且夹带"当前角色：username（role）"内部口径。

证据：会话中 assistant 回复与模板逐字一致；trace 库 13 条中 9 条走 `model_classification_fallback`。

## 2. 目标与非目标

**目标**：常规提问默认获得模型自然回复；静态模板只保留在两类场景——问候语（额度保护）与超范围拦截。

**硬口径（零变更）**：
- `chat.service.ts` 的 `isExplicitReportRequest` 前端闸门不动；
- "文件是上下文、用户意图才触发工作流"行为不变；
- 附件路由（attachment_qa / attachment_summary）、报告生成、v2 提交路径不动；
- `unsupported_or_out_of_scope` 拦截行为保留（仅收紧采纳条件）。

## 3. Batch A：分类替换策略收紧（预计 0.5 天，可独立交付）

改动文件：`apps/api/src/services/ai/workbench-dispatch.service.ts`

将 L942-955 的采纳条件从"confidence ≥ 0.6 即替换任意意图"改为**白名单 + 高阈值**：

```ts
// RP-049: 分类兜底只采纳超范围拦截意图，且阈值提高到 0.85
const ADOPTABLE_INTENTS = new Set<WorkbenchIntent>(["unsupported_or_out_of_scope"]);
if (intent.routingRule === "default_domain_qa") {
  const classification = await classifyIntentWithModel(input.message, input.modelChat);
  if (classification) {
    modelClassification = classification; // 始终记录到 trace，保证可观测
    if (ADOPTABLE_INTENTS.has(classification.intent as WorkbenchIntent) && classification.confidence >= 0.85) {
      intent = { intent: classification.intent as WorkbenchIntent, confidence: classification.confidence, routingRule: "model_classification_fallback" };
    }
  }
}
```

要点：
- `modelClassification` 无论是否采纳都写入 trace（现状已有此分支，保留）；
- 不被采纳的分类结果（capability/wes_data/write/knowledge）一律保持 `domain_qa`，走 `answerWithModelAndContext` 模型自然回复（该路径已有反幻觉约束与 formBlock 解析）；
- 关键词规则命中的路由**不受影响**：显式问"我的项目"仍由 `WES_DATA_QUERY_PATTERNS` 路由到真实数据回复，显式"创建XX项目"仍走写动作确认卡片。

已知取舍：分类识别出的知识类问题不再自动转入 knowledge_query 工具路径，改由 domain_qa 模型回复（有反幻觉约束兜底）；若后续评测显示知识命中率下降，再单独评估是否把 `knowledge_query` 加入白名单。

## 4. Batch B：能力回复自然化 + 规则补全（预计 1 天，依赖 Batch A）

### 4.1 能力事实与回复生成拆分

改动文件：`apps/api/src/services/ai/workbench-dispatch.service.ts`

- 将 `buildCapabilityResponse` 中的能力清单抽为常量 `CAPABILITY_FACTS: string[]`（唯一事实源，静态与模型路径共用）；
- `buildCapabilityResponse` 改为 async，按 routingRule 分策略：

| routingRule | 策略 | 理由 |
|---|---|---|
| `greeting_keywords` | 保持静态模板（清理版） | 保留 L86 注释的额度保护设计 |
| `capability_keywords` / `model_classification_fallback` | 模型辅助自然回复 | 修复僵硬的核心场景 |

- 模型辅助路径：system prompt 注入 `CAPABILITY_FACTS` + 三条生成约束（① 直接回答用户具体问题，不要罗列全量清单；② 禁止输出"当前角色/用户名/角色名"等内部口径；③ 有附件时说明附件仅作上下文），优先复用 `streamingAdapter + modelChatStream` 流式路径，否则走 `modelChat`；
- 降级路径：模型调用失败或返回空 → 返回清理版静态模板，`model: "rule-static"` 如实标注，`trace.fallbackReason: "capability_model_unavailable"`（遵守 Harness 设计"不得把 fallback 伪装成模型输出"）；
- 模板清理：两种静态输出均删除"我是 WES AI 工作台，当前角色：xxx（role）。"一行，改为"我是 WES AI 工作台。"；`suggestedActions` 保持不变。

### 4.2 关键词规则补全

改动文件：`apps/api/src/services/ai/workbench-intent.service.ts`

`CAPABILITY_PATTERNS`（L33）追加自然问法：

```
发什么.*文件|什么类型.*文件|需要.*发.*文件|可以发什么|上传什么|支持什么.*格式|支持哪些.*文件|发哪些
```

说明：Batch A 已保证此类问法即使不命中规则也能获得模型自然回复；补规则的价值是让高频能力问法走确定性规则路径，省一次分类模型调用。依赖关系：必须在 4.1 完成后生效，否则会让更多问法进入（清理前的）静态模板。

## 5. Batch C：回归加固与验收回填（预计 0.5 天，依赖 A+B）

### 5.1 自动化用例

`apps/api/src/services/ai/workbench-dispatch.service.test.ts` 新增：

| # | 输入（mock 分类结果） | 断言 |
|---|---|---|
| 1 | "我需要发什么类型的文件给你"，分类=capability@0.9 | 不采纳，final intent=domain_qa；answer 来自 mock 模型（≠rule-static）；trace.modelClassification 存在 |
| 2 | "帮我写一首诗"，分类=unsupported@0.9 | 采纳，返回超范围静态拒绝 |
| 3 | 任意消息，分类=unsupported@0.7 | 不采纳（低于 0.85），走模型回复 |
| 4 | 分类=wes_data_query@0.9 / write_action_request@0.9 | 均不采纳，走模型回复 |
| 5 | "你能做什么"（规则命中）+ mock modelChat | answer 由模型生成、不含"当前角色"、非全量模板逐字 |
| 6 | 同 5 但 modelChat 抛错 | 降级静态模板：不含"当前角色"、model="rule-static"、trace.fallbackReason 存在 |
| 7 | "你好"（greeting） | 保持静态（额度保护），不含"当前角色" |

`apps/api/src/services/ai/workbench-intent.service.test.ts` 新增：
- "我需要发什么类型的文件给你" / "可以发什么文件" → capability_keywords；
- 回归保护："这个风险是什么意思" 仍落 default_domain_qa，不被新 pattern 误命中。

### 5.2 验证命令

```bash
npm run test:ai          # 覆盖 workbench-*.test.ts
npm run test:modules     # 全量模块回归
npm run build:api
```

### 5.3 人工验收样本（实施后回填总看板）

在工作台实际发送：① 我需要发什么类型的文件给你 ② 特朗普是谁 ③ 你能做什么 ④ 你好 ⑤ 帮我写一首诗 ⑥ 我之前创建过哪些项目。预期：①②为模型自然回复，③为自然能力说明，④为简洁静态回复，⑤为超范围拒绝，⑥为真实项目列表。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 收紧白名单后，分类识别出的知识问题不再进知识库工具路径 | 知识命中率可能下降 | domain_qa 已有反幻觉约束；上线后抽样 trace 评估，必要时单独把 knowledge_query 加入白名单 |
| 低置信超范围问题（<0.85）转由模型回复 | 少量额度消耗 | 与"僵硬回复"相比可接受；通过 trace 监控占比 |
| 能力回复引入一次模型调用 | 显式能力提问延迟增加 | 问候语仍走静态；流式路径可感知首字延迟 |
| 新 pattern 误命中正常业务问法 | 个别问题被路由到能力回复 | Batch C 的误命中回归用例兜底；pattern 均为"发/上传+文件/格式"组合，误伤面小 |

## 7. 执行与验收协议

- 实施走 `skills/wes-qoder-worktree-protocol`：独立 worktree、Worktree Contract ACK、结构化 handoff，状态上限"已回填 / 待 Codex 复核"；
- Batch A 可作为独立最小交付先行合并（只改 dispatch 一处 + 对应测试），B、C 随后；
- 完成后同步总看板：requirements.html（RP-049 状态）、changes.html（事件 + 验证证据）、testing.html（人工验收样本回填）；
- 次级观察项（13:26 消息无回复）不在本计划范围，另立 issue 追查。
