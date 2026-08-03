# Codex Integration Record · RP-047-A2

date: 2026-08-03
taskId: RP-047-A2-MAINLINE
requirement: RP-047
integrator: codex
mainBranch: `codex/role-driven-ai-home-workbench`
mainBefore: `b5cc942736049a0d3f212862e5abbc75dc38234d`
a2IntegratedHead: `88054d53f67a7dad6a61276ab5b73323b5df8835`
sourceCandidate: `qoder/rp-047-a2-integration @ 35fee259380a46220a1677b11a94b7c5f3d19f22`
status: `INTEGRATED_VERIFIED`

## 1. 业务结果

RP-047 的 Batch A2 已进入业务主线。主线现在具备持久 Run、lease/heartbeat、事件、检查点、
输出版本和 outbox 的 PostgreSQL 数据结构与 repository 原语，为后续后台 Worker、恢复协调、
异步 API、SSE 回放和多会话前端提供可验证的数据底座。

本次只完成 Batch A2，不代表 RP-047 已交付。用户当前还不能在界面上使用完整的多会话后台运行能力；
Batch B-E 尚未实施，本次也没有自动发布或领取下一批任务。

## 2. 集成方式与范围

- 从已通过 Codex Gate 的 Qoder 候选中，按原顺序移植 8 个 A2 来源提交和 1 个集成 handoff 提交；
- 在基于当前主线 `b5cc942` 的隔离 worktree 中完成组合验证；
- 验证通过后，以 `--ff-only` 将业务主线快进到 `88054d5`；
- 集成范围精确为 17 个文件：A2 16 个实现/过程文件与 1 个集成 handoff；
- 两个 lockfile、运行态 JSON、密钥和无关页面均未进入 A2 集成提交。

## 3. 主线前最终验证

| 验证 | 结果 |
|---|---|
| Testcontainers Harness | 95/95 pass，0 fail，0 skip；历史迁移与随机 PostgreSQL 容器通过，容器已停止 |
| modules | 227/227 pass |
| AI | 190/190 pass |
| integration | 1/1 pass |
| Web | 29 files / 206 tests pass |
| API / Web build | pass / pass；Web 仅既有 chunk-size warning |
| security | secret scan 与知识库 URL policy 通过；tracked secret = 0 |
| 范围与清洁度 | diff check 通过；两个 lockfile 无变化；0014 destructive SQL 扫描无命中 |

## 4. 保留边界

主 checkout 原有总看板草稿、架构分析文档和 `config/auth/users.json`、
`config/versions/records.json` 运行态修改均已保留，没有 reset、restore 或覆盖。

## 5. 下一步门禁

- Batch A2：`INTEGRATED_VERIFIED`；
- RP-047：仍为实施中，不能标记“已交付”；
- Batch B：未启动，需单独发布明确工单后再由 Qoder 施工；
- Batch E：仍需真实目标环境迁移演练，当前 Testcontainers 结果不能替代生产迁移验收。
