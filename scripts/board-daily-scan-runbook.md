# WES 总看板 Daily Scan Runbook

> 看板治理 B4（2026-08-09）：把平台调度任务的流程落仓为可恢复文档。
> 调度任务丢失 / 换机 / 重建环境时，按本文档恢复即可。

## 1. 调度任务信息

- **平台**：Qoder 平台调度器（MCP schedule 工具管理）
- **任务 ID**：`62d5c287-7146-4025-bdc8-d3c0d5d949e0`
- **触发**：每日 04:30 本地时间，无人值守
- **日志留痕**：`logs/board-daily-scan.log`（追加写）
- **状态快照**：`data/board-daily-scan-state.json`（原子写入）

任务内容口径（重建任务时使用此 prompt 要点）：

1. 扫描仓库 HEAD 与 `data/board-daily-scan-state.json` 上次快照比对（commit、statusHash、关键文件）；
2. 无实质变化 → 记录 skip 并结束；有变化 → 继续；
3. 生成日报 `docs/PROJECT_STATUS_日报/project-status-YYYY-MM-DD.md`，实跑 `npm run build:api` + `npm run build:web` 取构建结论；
4. 向看板写入 `BE-YYYY-MM-DD-daily-scan` 事件（changes.html + events/ JSON），跑 `node scripts/board-build.js` 与 `node scripts/board-consistency-check.js`（0 错 0 警门禁）；
5. 原子写入新状态快照，追加 RUN_END 到日志。

## 2. 五步流程（与日志 STEP 标记对应）

| 步骤 | 日志标记 | 动作 | 产物 |
|---|---|---|---|
| 1 | STEP1 / SCAN | git HEAD + 快照比对，判定实质变化 | HEAD、文件数、行数摘要 |
| 2 | STEP2 | 无变化则 skip 结束；有变化继续 | — |
| 3 | STEP3 / BUILD | 生成日报 + 实跑双端构建 | `docs/PROJECT_STATUS_日报/project-status-*.md` |
| 4 | STEP4 / BOARD | 写 BE 事件 → board-build → consistency-check | changes.html、events/*.json、dist/ |
| 5 | STEP5 / SNAPSHOT | 原子写状态快照 + RUN_END | `data/board-daily-scan-state.json` |

## 3. 手动补跑（调度中断后）

```bash
# 1. 看板重建与门禁
npm run board:build
npm run board:check

# 2. changes 超期记录归档（超 30 天 BE 条目 → archive-md/changes-YYYY-MM.md）
node scripts/board-archive-changes.js --dry-run   # 先预览
npm run board:archive                              # 实跑
# 归档后必须重跑 board:build + board:check
```

手动补跑时，按第 2 节顺序逐步执行并把结论写入 changes.html（简明风格：结论 → 证据 → 下一步，单元格 ≤ 120 字，遵循 `skills/maintain-wes-command-board/references/board-readability-spec.md`）。

## 4. 恢复调度任务

若平台任务 ID 失效（换环境 / 任务被删）：

1. 用 schedule MCP `manage_scheduled_task` 新建每日 04:30 任务，prompt 按第 1 节口径；
2. 用新任务 ID 更新本文件第 1 节；
3. 手动补跑一次第 3 节流程，确认日志出现完整 RUN_START → RUN_END。

## 5. 已知约束

- daily-scan 只更新看板与日报，不实现需求、不合并分支（AGENTS.md NightOps 边界）。
- `events/` JSON 为审计留痕，不归档、不删除。
- 归档脚本只动 changes.html 超 30 天行；近期记录全量保留。
