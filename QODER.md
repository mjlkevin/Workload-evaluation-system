# WES Qoder Entry

> Qoder 在 WorkEvolutionSys 中执行需求池、Loop、实现、验证或回填任务时，必须先读本文件。

## Required Skills

Use these skills before editing files:

- `skills/speak-plainly/SKILL.md`（面向用户汇报、提问和交接时使用）
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-multi-agent-collaboration/SKILL.md`

If Qoder supports installing project skills, install or register:

```text
skills/speak-plainly
skills/wes-qoder-worktree-protocol
skills/wes-multi-agent-collaboration
```

If Qoder does not support skill installation, read and follow the same files manually:

- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-qoder-worktree-protocol/references/protocol.md`
- `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议，v0.4.0）

## Mandatory Reading Order

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `QODER.md`
4. `skills/speak-plainly/SKILL.md`
5. `skills/wes-qoder-worktree-protocol/SKILL.md`
6. `skills/wes-qoder-worktree-protocol/references/protocol.md`
7. `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议）

## Execution Contract

- One scoped task, one isolated worktree.
- Do not edit the main checkout directly unless the user explicitly orders it.
- Do not clean, reset, restore, format, merge, or rebase unrelated work.
- Do not revive `apps/web` or treat `ui/V0_SAAS` as current mainline.
- Do not expose API keys, tokens, cookies, or private keys.
- Print `Worktree Contract ACK` before the first file edit.
- Finish with the structured handoff template from `references/protocol.md`.

### 推送前安全扫描判定（2026-08-29 架构侧常设规则，后续批次一律照此执行）

判断轴不是「有没有新代码」，而是**改动有没有落在攻击面上**。按下表自行判断，不必每次询问架构侧。

- **直接推送，不用扫**：纯文档、注释、看板、计划文档；文件删除、重命名、移动（不含新增逻辑）；纯样式/布局/文案改动；测试文件的新增与修改；种子/固定数据的读取与装载（源为仓库内文件）；已被架构侧读过 diff 并明确批准的内容。
- **必须扫**：鉴权、会话、令牌、权限判定相关的任何改动；处理外部输入的路径（HTTP 入参、上传文件、第三方回调、模型返回值落库）；拼接 SQL、动态执行、反序列化、路径拼接；新增依赖或依赖版本升级；加密、签名、随机数、凭据读写；CORS / CSP / Cookie 属性 / 重定向目标；对外暴露新端点，或放宽既有端点的权限要求。
- **拿不准时按「必须扫」处理**——判断成本远低于漏扫成本。
- 额度不足且改动落在「必须扫」清单里：**停下报架构侧**，由架构侧代读 diff 或安排他法；不得以「额度不足」为由跳过必扫项。

Qoder may report `已回填 / 待 Codex 复核`; Codex/user decide whether a WES requirement is `已交付`.

## 历史说明（已下线）

【历史说明，已下线】原 NightOps Execution Contract（北京时间 00:00-09:30 无人值守执行窗口）已于 2026-08-09 随 NightOps 机制整体下线删除；Qoder 不再创建或参与无人值守 Loop，所有任务按上述普通 Execution Contract 执行。
