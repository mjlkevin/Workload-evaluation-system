# wes-qoder-worktree-protocol CHANGELOG

## v1.1.0 · 2026-08-09

- 修复 `references/protocol.md` 中 ACK 模板 projectRoot 指向已注销 `-agent` worktree 的过时引用（2026-07-25 已注销）。
- 纠正主目录被误标为 legacy 的问题：明确 `/Users/kevin/AI/Workload-evaluation-system` 为唯一活动交付目录。
- `ui/V0_SAAS` 口径更新为“2026-08-06 已删除，禁止恢复”。
- 验证命令统一使用根脚本别名 `npm run test:web`。
- Mandatory Start 补充 `skills/speak-plainly/SKILL.md` 引用。
- SKILL.md 补充版本页脚。

## v1.0.0 · 2026-06-26

- 初始发布 WES 专用 Qoder worktree 协议 Skill。
- 定义 Mandatory Start、Worktree Contract ACK、执行边界、验证矩阵与结构化 handoff。
- 新增 `references/protocol.md` 承载详细协议、模板与拒收条件。
- 配套新增项目根入口 `QODER.md`，便于 Qoder 安装 Skill 或手动读取协议。
