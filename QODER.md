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

### 提交身份与 Session 尾行（2026-09-03 架构侧裁决 B，长期生效）

所有提交**必须**包含 `Session: <会话ID>` 尾行（commit message trailer），用于在共享 git 身份下区分提交来源。格式示例：

```
feat(scope): 描述

Session: s3-supplemental-20260903
```

- **committer.name 一致性**：不得使用与 `git config user.name` 不同的 committer.name。`pre-commit` hook 拒绝不匹配的提交。
- **commit-msg hook**：拒绝缺少 `Session:` 尾行的提交（merge / revert 自动提交豁免）。
- **安装**：`sh scripts/hooks/install.sh`（hooks 写入 common `.git/hooks/`，worktree 共享）。
- **git identity 全局配置**：待定（仅登记，不实施），需用户确认后统一设置。

### CI 基线自取规则（2026-09-03 架构侧裁决 A，长期生效）

执行方在开工时**必须自行从 `origin/main` 实取 CI 基线数字**，不得使用派单中给出的基线值。流程：

1. `git fetch origin` 确保本地 `origin/main` 是最新。
2. `gh run list --branch main --limit 1` 拿到最近一次成功的 CI run ID。
3. `gh run view <run-id> --log` 逐套件实取测试数字（test:rules / agent / AI / modules / serial-store / integration / harness / security / scripts / web），记录为开工基线。
4. 收工时用同一方式取收工基线，差值归因到本批改动。

派单中的基线数字仅供**交叉验证**（实取与派单不符时登记差异，不直接采用派单值）。理由：派单到开工之间可能有其他线合入 main，基线已前进。

Qoder may report `已回填 / 待 Codex 复核`; Codex/user decide whether a WES requirement is `已交付`.

## 历史说明（已下线）

【历史说明，已下线】原 NightOps Execution Contract（北京时间 00:00-09:30 无人值守执行窗口）已于 2026-08-09 随 NightOps 机制整体下线删除；Qoder 不再创建或参与无人值守 Loop，所有任务按上述普通 Execution Contract 执行。
