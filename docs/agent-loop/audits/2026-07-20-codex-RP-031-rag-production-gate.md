# Codex External Handoff Gate

taskId: RP-031
date: 2026-07-20
reviewer: codex
projectRoot: /Users/kevin/AI/Workload-evaluation-system-agent
auditedWorktree: /Users/kevin/AI/wes-rp031-rag
auditedBranch: feature/rp-031-rag-production
baseCommit: 6e88ff4
headCommit: 57f1205
verdict: REJECTED

## Gate Checks

- metadataComplete: false。用户回填提供 worktree、branch、commit 和汇总命令，但没有 baseCommit、逐文件意图、风险、未实现范围和人工验收项。
- scopeClean: false。候选范围为 63 文件、约 6026 行新增；`config/system/requirement-settings.json` 属于无关配置变更，并包含非空敏感凭证。
- verificationCurrent: partial。Codex fresh 复跑的既有构建/回归均通过，但本批没有新增任何测试文件，既有测试不覆盖新增 RAG 模块。
- securityBoundaryClean: false。候选提交触碰含敏感凭证的跟踪配置文件；不得把该文件纳入 RP-031 集成包，凭证需按 secret workflow 轮换。
- boardSyncReady: false。候选看板先于 Codex Gate 写成“完成/全量通过”，日期写为 2026-07-01，且记录 6 个 commit，与 2026-07-20 的 7 个实际提交不一致。

## Fresh Verification

- `npx tsc --noEmit -p apps/api/tsconfig.json`: pass
- `npm run build:api`: pass
- `npm run build:web`: pass，保留既有 chunk size warning
- `npm run test:modules`: 142/142 pass
- `npm run test:ai`: 190/190 pass
- `npm run test:web`: 96/96 pass
- `npm run test:integration`: 1/1 pass
- baseline CLI smoke: 可运行；但无配置样本仍可能给出 `Doc Recall Rate=100%` / `Recall@10=1.0`，不能作为质量门禁证据
- `git diff --name-only 6e88ff4..57f1205 | rg '\\.(test|spec)\\.'`: 无新增测试文件

## Blocking Findings

1. Provider、缓存、Chunk Pipeline、查询改写、路由 DSL、韧性和监控模块仅在各自目录内互相引用，没有接入 `queryZhipuKnowledgeBase`、intent 或 dispatch 生产链路。现有知识库主路径仍直接 `fetch`。
2. Prompt Registry 未被生成路径使用；`knowledge-tool.service.ts` 仍使用硬编码 system prompt。请求体仍未写入可信 `request_id`，request/trace/provider ID 只扩展了类型，没有贯穿运行链路。
3. 前端发送 `retrievalParams`，但 `updateKnowledgeBaseConfigDraft` 的 payload 和持久化合并忽略该字段；GET 公共配置也不返回该字段。界面看似可配置，实际无法保存/回读。
4. 激活门禁只检查 HTTPS 白名单和字段非空。使用明显无效的 apiKey、knowledgeId、model 仍返回 `valid=true`；没有 24 小时验证记录、配置 hash 绑定、知识库访问探针或配置审计日志。
5. 新增约 6000 行 RAG 代码没有配套单元、集成、故障注入、ACL/跨租户或前端配置测试。现有 142/190/96 仅证明旧基线未回归，不能证明新模块可用。
6. 多知识库 registry/租户路由、样本资产、Prompt 激活、逻辑 manifest 持久化、监控写入/看板下钻均未进入运行时；统计 CLI 也没有使用稳定的分级 qrels 数据集。
7. `config/system/requirement-settings.json` 的无关模型变更与敏感凭证不应出现在 RP-031 patch。

## Decision

allowNextTask: false
mustReworkFirst: true
nextOwner: branch executor + user-owner
manualAcceptanceNeeded: true

该分支不得直接合并或标记 RP-031 已交付。建议保留 Gate 0 合同作为参考，按 Phase 拆出最小可运行 patch；每一批必须接入生产调用链、先补失败测试再实现，并在 Codex Gate 后才能更新为完成。

## Required Rework

1. 立即从候选 patch 移除无关配置文件；按 `docs/codex-workflows/api-secret-handling.md` 轮换已跟踪凭证，不在对话或提交中回显。
2. 先修 Phase 0：可信 ID 传播、Prompt Registry 接线、retrievalParams 保存/回读/生效、版本化样本/qrels 和对应测试。
3. 再修 Phase 1：让生产知识库调用通过 Provider、Pipeline、缓存和韧性装饰器，并补取消、超时、429、singleflight、ACL、缓存隔离测试。
4. Phase 2/3 必须接入 intent/dispatch/metrics 路径；多知识库、统计和监控需有真实可执行验收，不接受只新增未引用模块。
5. 看板状态恢复为“已回填 / 返工中”，日期、提交数、验证覆盖范围与本 Gate 一致。
