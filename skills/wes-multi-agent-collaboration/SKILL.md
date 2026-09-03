---
name: wes-multi-agent-collaboration
description: Use when coordinating WES tasks across multiple architecture-side sessions, Qoder IDE sessions, Qoder CLI direct invocation, or future agents; assigning requirements, reviewing external AI handoffs, enforcing session identity lines, registering cross-line shared facts (ISS/DEF numbering, command board rows, baselines), onboarding agents, resolving cross-workline conflicts, or syncing collaboration facts to the WES command board.
---

# WES 多 Agent 协作

## Overview

Use this skill to organize WES work across multiple AI coding agents without relying on a platform-level A2A runtime.

Core principle: **local protocol beats platform magic**. Git worktree/branch/commit carries state, structured handoff carries delivery evidence, the WES command board carries shared facts, and replayable verification commands carry acceptance.

Treat the current agent registry as a snapshot, not a fixed roster. Add, pause, or retire agents by updating their registry entry and board facts.

**2026-09-02 口径更新**：本 Skill 早期描述的是"一个 Codex 指挥 + 一个 Qoder 执行 + 同行审计"的单指挥模型。三周实际运行后，拓扑已变成**多架构侧会话 × 多执行方**（见下文 Collaboration Topology）。角色槽位、assign 门禁、handoff 信封、验收/返工/拒绝规则全部仍然有效；变掉的只有两件事——**谁在指挥**，以及**跨线共享事实由谁拥有**。引用本 Skill 时以拓扑节为准，不要再假设全项目只有一个指挥方、也不要假设指挥方天然看得到所有线。

## Required Project Context

Before assigning or reviewing WES work, read these files from the project root:

- `AGENTS.md`
- `codex-project-registry.md`
- `skills/maintain-wes-command-board/SKILL.md`
- `docs/codex-workflows/external-ai-handoff-template.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/collaboration-protocol.html`

When the work is a Qoder worktree task, also read:

- `QODER.md`
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-qoder-worktree-protocol/references/protocol.md`

When acting as the architecture side (reviewing a delivery, writing the next prompt, or driving Qoder CLI directly), also read:

- `skills/wes-architect-review/SKILL.md` — 复核命令清单、反复出现的失效形态、交接文档骨架，以及直驱 CLI 的完整协议。本 Skill 只写协作层的规则，"怎么核实"的细节在那一份里。

【历史说明，已下线】NightOps 无人值守机制（nightops-templates.md、mission/gate/brief 产物）与 KIMICODE（KIMICODE.md）已于 2026-08-09 整体下线/退出，不再作为本 Skill 的必读上下文。

## Collaboration Topology（协作拓扑）

Actual topology as of 2026-09-02 — a status report, not a design proposal:

```
用户（唯一验收权）
 ├─ 架构侧会话 ×N —— 每条工作线一个，各自指挥自己的执行方
 └─ 执行方 ×N     —— Qoder IDE 会话 + Qoder CLI 直驱
```

**为什么会长成这样**：一条工作线跟久了上下文会满，满了只能分裂成新会话继续。这是上下文窗口逼出来的结果，不是任何人规划的架构。所以读下面这些代价时，不要理解成"多架构侧这个决定做错了"——它是这个约束下的固有属性，只能靠纪律兜住，靠回到单指挥模型兜不住（单会话的上下文装不下所有线）。

**必须点名的后果：跨线共享事实没有单一 owner。** 测试基线数字、ISS/DEF 编号池、看板文件这三样被多条线同时读写，而拓扑里没有任何一个角色对它们整体负责。已经实际造成的事故：

- 同一个 ISS 编号被两条线同时占用，指向两件不同的事项——台账里出现了自相矛盾的行。
- 看板文件并发写入，后写的把先写的整段覆盖掉。
- 分支清理之后，台账里引用的分支名失效，按名字已经查不到当时那次改动。

这三件事在单指挥模型下不会发生，因为所有写都要过同一个指挥方。多架构侧之后，**所有权必须靠下文《Shared-Fact Registration》显式补回来**，不会自动存在。

## Agent Registry

Represent every collaborator as a registry entry. Do not infer authority from the tool brand alone.

| Field | Meaning |
|------|---------|
| `agentId` | Stable local identifier, for example `codex`, `qoder1`, `kimicode`, `claude-code`. |
| `platform` | Tool or platform name. |
| `status` | `active`, `candidate`, `paused`, or `retired`. Candidate agents cannot receive production tasks. |
| `roleSlots` | Capabilities such as `owner`, `planner`, `executor`, `reviewer`, `integrator`, `board-steward`. |
| `allowedScopes` | Paths or task classes the agent may touch. |
| `forbiddenScopes` | Paths, actions, or decisions the agent may not touch. |
| `branchPrefix` | Default branch namespace, for example `qoder/` or `codex/`. |
| `handoffProfile` | Required delivery envelope and evidence fields. |
| `verificationProfile` | Commands or test class required before review. |
| `boardSync` | Which command board pages must be updated or recommended for update. |
| `onboardingAck` | Whether the agent has acknowledged project rules and current protocol. |

### Current Snapshot

| Agent | Status | Default role slots | Current use |
|------|--------|--------------------|-------------|
| `user-owner` | active | `owner`, `acceptor`, `priority-setter` | Defines goals, priorities, user intervention flags, and final acceptance. **唯一验收权**：任何线的"已交付"只能由这一方判定。 |
| `codex` | active | `planner`, `commander`, `reviewer`, `fixer`, `integrator`, `audit-gate`, `board-steward` | Reviews handoffs, runs verification, makes scoped repairs, and updates the command board. Codex does not create or run WES demand-pool implementation Loop automations. 这些槽位现由**多条架构侧会话分别持有**，每条只管自己那条线。 |
| `qoder1` | active | `executor`, `loop-runner` | Qoder IDE 会话（两条执行通道之一）。Executes WES demand-pool Loop tasks in isolated worktrees and returns structured handoffs for Codex review. |
| `qoder-cli` | active | `executor` | Qoder CLI 直驱通道，由架构侧会话当场调用，替代"写提示词—用户粘贴—贴回结果"这条长链。只承接能自动验证对错的低风险任务。见下文 Qoder CLI 直驱通道。 |
| `kimicode` | retired（2026-08-09） | 原 `peer-auditor`, `controlled-fixer` | 已整体退出本项目开发；历史 NightOps peer audit pilot 记录仅供追溯，不得再分派任务。 |

**架构侧身份说明（2026-09-02）**：一个 `codex` 条目对应多条架构侧会话。这带来一个单指挥模型没有的缺口：**全项目没有跨线仲裁者**。两条工作线的 scope 相交、编号撞车、看板争用时，没有任何一个架构侧会话有权判定谁优先——必须升级到 `user-owner` 裁决。架构侧会话自行判定"我这条线优先，你让一让"是越权，且正是并发写入事故的源头。

【历史说明，已下线】Claude Code 候选槽位已于 2026-08-09 移除：该 Agent 不再参与本项目开发，后续如需接入须重新走 onboarding 流程。

Add future agents by adding rows; do not rewrite the protocol around a fixed two-agent team.

## Task Classification

Classify the work before assigning it.

| Task class | Default owner | Required evidence |
|------------|---------------|-------------------|
| Demand-pool Loop execution | `qoder1` | One RP per worktree, ACK, handoff, targeted tests, board-sync recommendation. |
| One-off implementation requested for Codex | `codex` | Scoped diff, relevant tests/builds, board update or no-update reason. |
| Qoder CLI 直驱（低风险、可自动验证对错） | 该工作线的架构侧会话 | 简报（做什么/在哪儿/最坏情况/要用户定的）→ 用户确认 → 执行 → **独立核实**，不转述 CLI 自评。 |
| 跨线共享事实登记（编号 / 看板行 / 基线数字） | 引发该事实变化的那条线 | 写前 `git pull --rebase`、只写自己拥有的行、写完立即 push、编号有占位提交。 |
| External handoff review | `codex` or active `reviewer` | Diff scope inspection, reproduced commands where practical, accept/rework decision. |
| Minimal repair after review | `codex` or assigned `fixer` | Failing evidence, minimal patch, focused regression test. |
| Integration queue | `codex` or active `integrator` | One verified patch at a time, no unrelated dirty changes, post-integration verification. |
| Board-only governance | `codex` or `board-steward` | Updated board pages and source map, no code-delivery claims. |
| Candidate-agent onboarding | `codex` + `user-owner` | Registry entry, ACK, non-critical trial, Codex review, board/source sync. |

If a task fits multiple classes, choose the class with the strictest verification and scope controls.

直驱 CLI **不改变验收归属**：CLI 只是执行通道，任务是否"已交付"仍由 `user-owner` 判定，架构侧会话仍要独立核实，不得把 CLI 的自述当成复核结论。

## Collaboration Workflow

1. **Intake**: Identify RP/task, source of truth, priority, scope, forbidden paths, and acceptance evidence.
2. **Assign**: Match the work to an active agent with compatible `roleSlots`, `allowedScopes`, and `verificationProfile`.
3. **ACK**: Require the assignee to report project root, worktree path, branch, base commit, task id, allowed paths, and read rules before editing. 开工 HEAD 即 base commit，报告首行的会话身份标识在此时就要建立（见 Handoff Envelope）。
4. **Execute**: Keep one task per branch/worktree. Do not clean, reset, restore, or merge unrelated dirty work.
5. **Handoff**: Return a structured handoff with goal, changed files, validation commands/results, risk, board-sync recommendation, and next step. 首行必须是会话身份标识（`[会话ID] worktree=… 开工HEAD=… 收工HEAD=…`），缺行退回。
6. **Review**: Codex or the assigned reviewer inspects diff scope, reruns relevant commands, checks security/ownership/API boundaries, and records gaps.
7. **Integrate**: Integrate only the minimum verified patch. Reject broad branch merges when the diff contains unrelated files.
8. **Synchronize**: Update `requirements.html`, `plan.html`, `testing.html`, `monitoring.html`, `risks.html`, `changes.html`, and `sources.html` as required by the change. 涉及跨线共享事实（编号、看板行、基线数字）时按 Shared-Fact Registration 执行，不得整段重写共享文件。

## Assignment Gate

Pass every gate before work begins:

| Gate | Pass condition |
|------|----------------|
| Authority | Assignee status is `active`, or the task is explicitly an onboarding trial for a `candidate`. |
| Scope | `allowedScopes` cover the files/task class; `forbiddenScopes` are not touched. |
| Isolation | 一条工作线 = 一个 worktree = 一个会话；one task per branch/worktree, shared-file work has an explicit sequencing plan. |
| Session identity | 报告首行为 `[会话ID] worktree=<路径> 开工HEAD=<sha> 收工HEAD=<sha>`；缺行不予受理（见 Handoff Envelope）。 |
| ACK | Assignee reports project root, worktree path, branch, base commit, task id, allowed paths, forbidden actions, and read rules. |
| Verification | Required commands are known before editing; `not run` must be justified in handoff. |
| Board | The owning board pages are identified before delivery. |

Rules:

- Assign demand-pool Loop execution to Qoder unless the user explicitly directs a one-off Codex task.
- Assign review, minimal repair, integration advice, and board synchronization to Codex unless another active reviewer is registered.
- Do not assign production work to candidate agents except explicitly bounded onboarding trials.
- Do not let an execution agent mark a task as `已交付`; only Codex/user acceptance can close it.
- Do not allow any agent to bypass JWT, owner isolation, human confirmation, secrets policy, dispatch boundaries, or repository boundaries.
- Do not let two worklines share one worktree. 共用一棵树等于让两个会话互相覆盖对方的未提交工作，本项目已因此出过四次事故。
- 执行方发现工作区有非本会话所写的改动，**立即停下上报**，不提交、不修改、不回退。回退别人的未提交改动是销毁证据，比继续干活严重得多。

## Collaboration Modes

| Mode | Use when | Required control |
|------|----------|------------------|
| Sequential handoff | One agent finishes before another reviews or integrates. | Complete handoff before review starts. |
| Parallel worktrees | Multiple independent RPs can proceed safely. | One worktree/branch per task, no shared files unless explicitly coordinated. |
| 多架构侧并行 | 多条工作线同时推进，各有自己的架构侧会话。 | 跨线共享事实按 Shared-Fact Registration 登记；scope 相交时升级到 `user-owner` 裁决，任一线不得自行判定优先。 |
| 架构侧直驱 CLI | 任务能自动验证对错，且不需要架构侧判断。 | 简报 → 用户确认 → 执行 → 独立核实；见 Qoder CLI 直驱通道。 |
| Review escalation | Handoff has risk, missing tests, or scope ambiguity. | Reviewer records blocker and returns a rework prompt. |
| Integration queue | Several verified patches are waiting for mainline. | Integrate one scoped patch at a time and rerun matching verification. |
| Board-only governance | The task changes process facts but not code. | Update board/sources/skills without pretending code was delivered. |

这些模式现在会在同一条线上叠加（例如"多架构侧并行 + 直驱 CLI"），不是互斥选项。叠加时的约束取两者中更严的那个。

## Qoder CLI 直驱通道（2026-09-02 启用）

架构侧会话可直接调用 `qodercli` 执行低风险任务，替代"写提示词 → 用户粘贴到 IDE 会话 → 等结果 → 用户贴回"这条长链。

**协作层的变化**：人工检查点从"粘贴提示词"这一动作，变成了**简报 → 用户确认 → 执行 → 独立核实**。粘贴提示词是个物理屏障，用户不看也得看；直驱把这个屏障去掉了，所以必须用"简报 + 事后核实"把它补回来，否则这条通道就只是把出错速度提上去了。

### 适用边界

| 任务性质 | 走哪条路 | 为什么 |
|----------|----------|--------|
| 能自动验证对错的（台账回填、看板登记、批量核对、查数） | 直驱 CLI | 错了当场就能看出来，核实成本低于来回沟通的成本 |
| 需要判断的（出方案、定优先级） | 架构侧自己做 | 判断没有可执行的验证命令，交出去等于交出唯一没有兜底的环节 |
| **改代码** | **直驱 CLI，四项条件缺一不可**：独立 worktree + 独立分支 / 执行前简报并等用户确认 / CI 绿 / 架构侧逐条实取复核后才准合入 | 2026-08-31 用户授权。分支隔离使错误不落主干，CI 与实取复核在合入前拦住它。**最不能省的是最后一项**——批次 0 的实测证明 CI 绿不等于对（详见 `wes-architect-review` 第八节） |
| 不可逆 / 动鉴权 | 仍需用户逐项过目，不进批量简报 | 这两类的代价在分支上也回不来（已发出的消息、已改的权限），外部机制兜不住 |

### 实操要点

- **`cd` 到目标 worktree 后再调用**，CLI 即在该分支上工作。在别的目录调用就会改到别的树上——多线并行时这个错误的代价是覆盖另一条线的工作。
- **凭据与模型两条硬性前置**：凭据走 `qodercli login`（**完全不用 token**，也不要存在文件里——环境变量优先级高于登录态，设了就把登录盖掉），机械任务显式指定已配好的自定义模型（费用走项目方自己的供应商账户，Qoder credit 为 0；漏写 `-m` 会落回吃 credit 的默认模型）。两条都属于"漏了不会报错、只会事后付账"的类型——凭据漏了是明文落盘且出网，模型漏了是同一批活贵数倍。具体取用方式与核实办法见本节末尾指向的第七节，此处不复述，避免两份规则各自漂移。
- **多条 CLI 会话并行以「一棵树一个会话」为上限**：会话按工作目录隔离落盘，不同 worktree 天然安全；同一棵树上开两个就是本项目发生过四次的并发写入事故形状。判活看会话文件的修改时间，不要看输出文件大小（JSON 只在结束时落盘，跑到一半恒为 0 字节），也不要用 `--list-sessions`（非交互调用下返回空）。
- **写文件必须 `--permission-mode acceptEdits`**，只给 `--allowed-tools` 不够：工具被允许但写入被拦时，任务会静默停在"什么都没改"的状态，看起来像成功了。
- **长任务（>10 分钟）输出会丢，且末尾步骤可能不执行。** 因此耗时的机械步骤（`npm install`、commit、push）由架构侧自己做，CLI 只承担判断性部分。
- **禁令必须写死**：严禁 `git add -A`、列明哪些文件不许碰、明确许不许 push。模糊禁令等于没有禁令——执行方会朝对自己最省事的方向解释。
- **CLI 的结果一律独立核实，不转述。** 转述等于把一次没有兜底的自述当成证据。
- 不可逆动作单独确认，不混进批量简报——混进去用户就会一并点头。

**与 NightOps 禁令的边界（重要）**：直驱**不是**无人值守 Loop。每次调用都发生在当前会话内、前面有用户确认、后面有独立核实，三项缺一就退化成 2026-08-09 已下线的 NightOps 机制，属于禁止事项。不得给直驱加定时器、后台队列或"跑完自动接下一个"的编排。

详细协议（调用参数、输出解析、权限拦截的实际表现）见 `skills/wes-architect-review/SKILL.md` 第七、八节。

## NightOps（已下线）

【历史说明，已下线】NightOps 无人值守三 AI 协作机制（Codex mission packet + Qoder 执行 + KIMICODE peer audit + Codex Gate，北京时间 00:00-09:30 窗口）已于 2026-08-09 整体下线。相关模板 `docs/agent-loop/nightops-templates.md`、mission/brief/TRIAL 产物与 KIMICODE peer audit Loop 脚本均已删除。禁止重新创建无人值守实现或审计 Loop；如未来需恢复夜间自动化，须经用户重新授权并重建协议。

**本节为什么保留而不删**：NightOps 不是没试过的方案，是试过并主动停掉的机制。章节一旦删掉，后来读到"夜间没人干活"这个空白的人就会把它当新想法重新提议一遍——而停掉它的理由不在任何人的上下文里。保留本节就是让"已经否过"这个事实本身可被读到。

**不要把它和 Qoder CLI 直驱混为一谈**：直驱在架构侧会话内、前有用户确认、后有独立核实；NightOps 的定义性特征是**无人值守**（定时触发 + 自动接力 + 没有人在环中）。后者禁止，前者不受本节约束。

## Parallel Work Rules

Run agents in parallel only when all conditions are true:

- Distinct RP/task ids.
- Disjoint write scopes, or one agent is read-only.
- Separate worktree/branch per execution task — and **各条工作线的架构侧会话不共用 worktree**（一条线 = 一个 worktree = 一个会话）。
- Independent verification commands.
- A named integrator owns final ordering.
- 跨线共享事实（编号池、看板行、基线数字）有明确的登记归属，见下文 Shared-Fact Registration。

多架构侧之后，第 5 条不再自动成立：**每条线都有自己的 integrator，跨线的先后顺序没有任何一方拥有**。两条线的补丁都要进 main 而顺序有争议时，升级到 `user-owner` 定序；由任一线自行定序就是并发写入的源头。

If two agents need the same file, switch to sequential handoff. If a conflict appears after work starts, freeze the newer patch, inspect both diffs, and ask the integrator to choose one minimum patch or create a new rework prompt.

## Shared-Fact Registration（跨线共享事实登记纪律）

这四条是给上文"跨线共享事实没有单一 owner"打的补丁。共同前提：**在多条线并发的环境里，"我先记下来再说"等于"我等会儿一定会忘"**——所有登记动作只有在立刻落到 origin 上之后才算完成。

### 编号分配（ISS / DEF / RP）

- 领号前先 `git pull --rebase`，确认最新占用情况。
- 领到号后**立即提交一行占位**把编号占死，再回去补内容。
- 不要"先把完整内容写完再一起提交"。

**为什么**：编号池是一个没有 owner 的共享计数器。两个会话各自 `pull` 之后开始写，谁先 push 谁的编号就有效——后者写了一整篇内容才发现编号已被占，只能整篇重编号，而引用过这个编号的地方全部要跟着改。占位提交把冲突窗口从"写完一整篇"压缩到"几秒"，代价是一行空记录，收益是编号不可能双占。

### 看板写入

- 写前 `git pull --rebase`。
- **只写自己拥有的行**（本线创建或本线负责的事项）。
- **不整段重写**共享文件——重写会把别人的行连同自己 `pull` 之前不存在的改动一起覆盖掉。
- 写完立即 push。

**为什么**：看板是单文件多写方，Git 只在行级合并上表现良好。整段重写等于把自己看到的旧版本当作唯一真相提交回去，别人的行就静默消失了——而且这种丢失不报错、不冲突，事后很难归因。

### 基线数字（测试基线、CI 计数等）

- **谁的改动引起基线变化，谁负责登记新基线。**
- 不追登别人引起的变化，不沿用未复核的旧基线当现值。

**为什么**：多线并发下去追登别人的数字，两条线会在同一个数字上互相覆盖，越追越乱；而沿用旧基线会让下一任把偏离当成正常。责任绑在成因上，才是唯一不重复也不遗漏的分法。引用基线时注明它来自哪次 CI 运行，不要写成没有出处的常数。

### 清理类操作（删分支 / 删 worktree）

- 删除之后，台账里引用该分支名的行会失效——按名字已查不到那次改动。
- **必须在同一批清理里同步标注**：`分支名自此为历史标识，回退以 tag 与 commit 号为准`。

**为什么**：分支名是台账里唯一的指针，而它的生命周期比台账短得多。清理时不改台账是为了省事，代价是后来复核的人拿着一个空指针去查历史，只能重做一遍调查。合入前打 tag，是这条规则能成立的前提。

## Handoff Envelope

Every non-user agent handoff must include:

- **首行会话身份标识**（格式见下节，硬性）。
- Goal and task id.
- `projectRoot`, `worktreePath`, `branch`, `baseCommit`, and commit id when available.
- Changed file list with intent per file.
- Verification commands and result: `pass`, `fail`, or `not run`.
- Known risks, unimplemented scope, and manual acceptance needs.
- Board synchronization recommendation.
- Next recommended owner: same agent, reviewer, integrator, or user.
- Reporting rule: handoff 与所有面向 user-owner 的任务汇报禁止只出任务代号（O1、Sprint 3B、RP-048、Batch E、SP-… 等），代号首次出现必须附带主题括号注释，例：「Sprint 3B（AI 回答质量考卷：固定考题 + 自动判卷）」；执行方不遵守时，复审方应在返工提示中要求补注释。

### 会话身份标识（报告首行 · 硬性）

每份交付报告的**第一行**必须是：

```
[会话ID] worktree=<路径> 开工HEAD=<sha> 收工HEAD=<sha>
```

**为什么是硬性要求**：本项目发生过四次多个会话同时修改同一棵 worktree 的事故，每一次都是**事后**才发现的——等发现时，被覆盖的改动已经找不回来了。这一行的作用是让复核方在开始读内容之前，先判断这段时间里工作区有没有第三方写入：开工 HEAD 与收工 HEAD 之间若出现了本会话未提交的 commit，或 `git status` 与收工 HEAD 对不上，就说明有别的会话动过这棵树。它不能防止并发写入，但能把"事后才发现"变成"复核时就发现"。

规则：

- **缺这一行的报告不予受理**，直接退回补齐。不要"先看看内容再决定"——内容读完就已经按缺这一行的版本被接受了，这道门禁就此失效。
- **一条工作线 = 一个 worktree = 一个会话。** 不共用。
- 执行方发现工作区存在非本会话所写的改动：**立即停下上报，不提交、不修改、不回退。** 提交会把别人的改动混进自己的补丁；回退会销毁唯一还能看出别人干了什么的证据。

Note: Qoder 的 handoff 格式是 `external-ai-handoff-template.md` 的扩展（增加 worktree 元数据与 `not run` 验证状态），见 `skills/wes-qoder-worktree-protocol/references/protocol.md`；复核时以扩展格式为准。直驱 CLI 的输出同样适用本节——CLI 不因为是被程序调用就豁免首行要求。

## Acceptance, Rework, And Reject Rules

### 完成的定义

**完成 = commit + push + CI 绿 + 回填 CI 号。** 四件缺一件就不算完成。

- 写进文件但没提交：**一律报"已写入工作区，待提交"**，不得报"已完成"。文件在本地工作区里存在，复核方在 origin 上看不见，等于没交付。
- 凡声称已提交/已推送，**必须已 push 到 origin**。未推送的本地提交对复核方不可验证——复核方只能在 origin 上查，查不到就只能退回重报，来回一次白耗一轮。
- **曾发生过一次：交付报告里给出的 commit SHA 完全不存在**，是工具在沙箱里模拟出来的"成功"输出，格式合法到肉眼看不出来。结论：SHA 必须在 origin 上被实际查到才算数（`git fetch origin && git log --oneline -1 origin/<branch>`）。这不是怀疑执行方，是因为报告文本本身已经无法区分"真提交"和"被模拟出来的提交"，只有 origin 上的查询能区分。

### 报告纪律

- **只登记实取值，不登记预测值。** 基线、计数、耗时这类数字必须来自一次真实运行的输出。
- **推导值不得填进实测格式。** 表格出现"实测 / 前后 / 差值"这类列时，每一格都必须来自真实运行；推导出来的必须单独标注为推导并说明推导方法。

**为什么**：推导值一旦混进实测列，下一任会把它当基线继续往上加，误差就此变成事实，而且再也拆不回去。列名本身就是证据声明——"实测"两个字的责任，推导值担不起。

### 验收与返工

Accept only when the handoff has correct metadata, scoped diff, relevant verification, visible risks, and board-sync guidance. 元数据里含首行会话身份标识；"已提交"必须在 origin 上查得到。

Return for rework when the change is directionally valid but has a bounded gap: missing focused test, incomplete edge case, stale board status, narrow scope drift, or manual acceptance not called out.

Reject when any hard boundary is broken:

- Missing worktree/branch/base commit/task id.
- 缺首行会话身份标识（`[会话ID] worktree=… 开工HEAD=… 收工HEAD=…`）。
- 声称已提交/已推送，但 origin 上查不到对应 commit。
- 推导值冒充实测值（出现在"实测/前后/差值"格式的表格里且无法追溯到真实运行）。
- Unrelated dirty changes, runtime data, generated clutter, or deleted user work.
- Verification evidence absent while claiming completion.
- Production task assigned to a candidate agent.
- Bypasses JWT, owner isolation, human confirmation, secrets policy, dispatch boundary, or repository boundary.
- Introduces banned architecture paths such as a second frontend/backend mainline.
- Leaks API keys, tokens, cookies, private keys, or raw sensitive logs.

Rework prompts must include: task id, blocking finding, evidence path/command, required correction, forbidden changes, required verification, and board-sync expectation.

## Verification Profiles

Use the narrowest command set that proves the touched boundary.

| Boundary | Typical verification |
|----------|----------------------|
| V2 frontend | Focused component/page test, `npm run test:web`, `npm run build:web` when build surface changes. |
| API module/routes | Focused module test, `npm run build:api`, `npm run test:modules` when shared contracts change. |
| AI/provider/dispatch | Focused AI tests plus `npm run test:ai`; include stream/trace tests when touching SSE or dispatch. |
| Harness | Focused Harness tests plus `npm run test:harness -w apps/api` when Harness state/audit changes. |
| Board/docs/skills | Targeted `rg` for stale facts, skill validation for Skill changes, and source-map updates when artifacts change. |
| 跨线共享事实（编号 / 看板行 / 基线） | 在 origin 上实取：`git pull --rebase` 后核对编号未被占用、本行未被覆盖；基线数字以当次 CI 运行输出为准。 |
| 直驱 CLI 产出 | 不采信 CLI 自述，按被改动的表面重跑对应命令（改看板 → `rg` 复核；改代码 → 对应 test/build）。 |
| External API behavior | Local mocked tests first; real API acceptance only with secret-handling workflow and no secret disclosure. |

Do not mark CI or manual acceptance as passed unless there is current evidence. Use `not run` or `待回填` explicitly.

基线类数字必须实取并注明来自哪次 CI 运行。多架构侧下**不沿用别条线留下的旧值**：你无法从那一个数字判断它是哪条线、在哪次运行、针对哪个 tree 取出来的。具体实取命令见 `skills/wes-architect-review/SKILL.md` 第五节。

## Conflict And Authority Rules

- Newer user instruction overrides older plans.
- `user-owner` owns priorities, user-level intervention flags, and final acceptance — **across all worklines, without exception**.
- Current runtime code and routes beat stale historical documents for implementation facts.
- The WES command board is the shared process ledger; stale board facts must be corrected, not silently ignored.
- 每条工作线的复核/集成判断权归**该线的架构侧会话**；它对别的线没有管辖权。
- **跨线争议没有仲裁者**：scope 相交、编号撞车、看板争用、合入定序，任一线架构侧都无权自行判定，必须升级 `user-owner`。自行判定即越权，不论判断内容看起来多显然。
- 共享事实的归属**按成因，不按发现者**：谁的改动让基线变了谁登记，谁领的编号谁占位。发现别人的漏子可以提醒，不能代登——代登会制造第二轮并发写。
- **复核是双向的**：机制不是"听架构侧的"，是"谁拿得出实取证据谁说了算"。执行方拿实取纠正架构侧是正常路径；架构侧被纠正时应直接认，不要为错误找补——找补一次，下一任就不敢纠正你了，双向通道会单向堵死。
- Execution agents own their branch/worktree only; they do not clean, reset, restore, or merge unrelated work.
- If project rules conflict with an agent handoff, project rules win.

## Onboarding Checklist For New Agents

Before enabling any future agent:

1. Add a registry entry with `agentId`, status `candidate`, role slots, allowed scopes, forbidden scopes, branch prefix, and handoff profile.
2. Provide the agent with `AGENTS.md`, `codex-project-registry.md`, this skill, and any platform-specific entry file.
3. Require an ACK containing read files, project root, allowed branch prefix, forbidden actions, and handoff format.
4. Run one non-critical trial task or review task.
5. Have Codex review the trial output and update `collaboration-protocol.html` plus `sources.html`.
6. Change status from `candidate` to `active` only after the ACK and trial pass.

### Candidate Trial Rules

- Use non-critical tasks first: read-only review, documentation consistency check, small test audit, or isolated refactor.
- Require a structured handoff even for trial tasks.
- Keep status as `candidate` if the agent misses ACK fields, broadens scope, omits verification, or updates formal status without acceptance.

### 新开工作线不算新增 Agent

分裂出一条新工作线（新的架构侧会话、或同一执行方的新会话）**不重走候选试用流程**——onboarding 试的是"这个工具能不能守协议"，换个会话不改变答案。但它必须：过 Assignment Gate（含 Session identity 门禁）、独占一个 worktree、首行建立会话身份标识。`qoder-cli` 通道沿用调用方架构侧会话的权限与 scope，不单独 onboarding；它的边界由《Qoder CLI 直驱通道》的适用表约束。

## Board Sync Rules

- Use `collaboration-protocol.html` for team status, role slots, workflow rules, collaboration state, **and the current workline topology**（哪几条线在跑、各自的 worktree 与执行通道）。
- Use `changes.html` for collaboration process changes and handoff review events.
- Use `sources.html` when adding or changing workflow docs, skills, entry files, or protocol pages.
- Use `requirements.html` and `plan.html` only when the collaboration change affects a concrete RP or phase.
- **看板写入遵循《Shared-Fact Registration》的并发协议**：写前 `git pull --rebase`、只写自己拥有的行、不整段重写共享文件、写完立即 push。看板是多条线共用单个文件的典型场景，因此也是并发写入事故的主要受害面——覆盖别人的行不报错、不冲突，事后极难归因。
- 拓扑变化（开线、收线、启用新执行通道）必须落 `collaboration-protocol.html`。**为什么**：拓扑靠会话记忆传不下去——新架构侧会话只能读到文档，读到的是过时模型就会按过时模型行事，这正是"多架构侧"这个变化本身最大的隐性代价。
- 看板事件行与汇报文案中的任务代号（O×、Sprint ×、RP-×、Batch ×、SP-×等）必须伴随主题括号注释，面向 user-owner 的输出禁止只出编号（见 `skills/speak-plainly/SKILL.md`）。
- Do not store API keys, tokens, cookies, private keys, raw production logs, or temporary command output in the board.

## System Prompt Summary

Use `wes-multi-agent-collaboration` to coordinate WES tasks across active and future coding agents. Read the current topology first: **multiple architecture-side sessions each command their own executors** (Qoder IDE sessions plus Qoder CLI direct invocation), under a single `user-owner` who holds all acceptance. Classify the task, choose an active role slot, pass the assignment gate — including the mandatory session-identity first line (`[会话ID] worktree=… 开工HEAD=… 收工HEAD=…`) — keep one workline to one worktree, and hand off in the structured envelope. Review against acceptance/rework/reject rules, where **done = commit + push + green CI + CI run id backfilled**, and treat only independently-sourced (实取) numbers as registrable facts. Register cross-line shared facts (numbering, board rows, baselines) per the shared-fact discipline, integrate only verified minimal patches, escalate every cross-line dispute to `user-owner` because no architecture-side session arbitrates another's line, and synchronize durable facts — including the topology itself — to the WES command board.

---

*本 Skill 版本：v0.6.3*
*对应系统版本：WES Agent 升级总看板 · 本地 A2A 协作协议*
*最后更新：2026-09-03*

变更摘要（v0.6.3）：CLI 改用自定义模型后更正选型依据。2026-09-03 起 CLI 直驱统一走 `-m bailian/qwen3.8-flash-tp`（阿里云百炼 Qwen3.8-Flash，token plan，上下文 100 万），实测 Qoder credit = 0——费用结算到项目方自己的供应商 API 账户。**选型标准因此从「省 Qoder credit」变成「够用就好」，但显式写 `-m` 的纪律不变**（漏写会落回吃 credit 的默认模型）。同时记入一种会吃掉整份交付的失效形态：批次 0.5 那次直驱跑到第 414 轮、2 小时 44 分后因信用额度打满被掐断（error_code 118），is_error=true 且 result 为 null，无汇报无提交、19 个文件悬在工作树里——而活其实基本干完（构建双绿、套件全过），架构侧评估自洽后代为提交才没丢。**故遇 is_error=true 必须先查 git 与工作树再下结论，不得直接判为失败**。自定义模型消除了「额度」这一侧的成因，但「长任务尾部丢失」本身仍在，耗时的机械步骤仍由架构侧收口。v0.6.2：三处按实测更正，全部有当日实取证据。① **凭据规则整条推翻重写**——v0.6.1 写的「token 存 `~/.qoder-env` 并 source 取用」当晚即被推翻，两个实测原因：环境变量 `QODER_PERSONAL_ACCESS_TOKEN` 优先级高于已保存登录（设了就把登录盖掉，报错 `it overrides any saved login`），且账户可同时持有多个 PAT、吊销时极易点错导致整条通道断。现改为 `qodercli login` 交互登录、根本不用 token，调用时显式 `env -u QODER_PERSONAL_ACCESS_TOKEN` 摘掉残留变量；「凭据不进对话」这条底线不变，变的是达成方式——不是换个地方存 token，是不要 token。② **「改代码不许直驱」这条边界作废**，改为可直驱但四项条件缺一不可（独立 worktree + 独立分支 / 执行前简报确认 / CI 绿 / 架构侧逐条实取复核后才准合入）。2026-08-31 用户授权，2026-09-03 批次 0 （合入 a0e5b7c）提供实测支撑：CLI 在独立 worktree 交付 17 文件 1884 行、分支 CI 绿，而架构侧实取复核**在合入前拦下一处它自己 83 条测试全绿也测不出来的缺陷**（同一工具调用被执行两次）——所以四项里最不能省的是最后一项，CI 绿不等于对。③ **补 CLI 会话的可观测与并行纪律**：会话按 cwd 落盘在 `~/.qoder/projects/<目录编码>/<UUID>.jsonl`，判活看该文件修改时间（输出 JSON 只在结束时落盘、跑到一半恒为 0 字节；`--list-sessions` 在非交互调用下返回空，都不可作判据）；并行上限为一棵树一个会话。v0.6.1：补入 CLI 直驱的两条前置硬性要求——**凭据不得进对话**（token 存 `~/.qoder-env` 并 `source` 取用；起因是原 PAT 被贴进对话后以明文落进两个会话记录文件，且作为对话内容出网，而"只换 token 不改给法"会让新 token 二十分钟后落到同一位置）与**机械任务显式指定廉价模型**（漏写会落到默认模型、同一批活贵数倍，且 CLI 烧的是 Qoder 账户 credit，"派给 CLI 更省"这句只在选对模型时成立）。两条的具体取用与核实办法只写在 `wes-architect-review` 第七节，本 Skill 只留指路不复述，避免两份规则各自漂移。另有两处已知过期**本次刻意未改**：① 适用边界表仍写"改代码走分支+CI+用户过目、不走直驱"，而 2026-08-31 起用户已授权代码改动可直驱（前提是独立分支 + 简报确认 + CI + 用户过目）；② CLI 会话缺少与 IDE 会话对等的身份标识条款（会话按 cwd 落在 `~/.qoder/projects/<目录编码>/<UUID>.jsonl`，可取但未规定必须登记），并缺同树禁止双开的并行上限。两条待批次 0 落地后按实测证据补写，不按推测先写。v0.6.0：按三周实际演化更新协作模型，补入四块内容。① **多架构侧拓扑**（Collaboration Topology + Shared-Fact Registration）：拓扑已是"多条架构侧会话 × 多条执行通道"，这是上下文窗口逼出来的结果而非设计；代价是跨线共享事实没有单一 owner，已实际造成 ISS 编号双占、看板并发写入、分支清理使台账引用的分支名失效，故补入编号占位提交、看板行级写入、基线按成因登记、清理后标注分支名为历史标识四条纪律，并规定跨线争议一律升级 `user-owner`（不存在跨线仲裁者）。② **会话身份标识**：所有交付报告首行强制带 worktree + 开工/收工 HEAD，缺行不予受理——本项目发生过四次多会话同改一棵树、每次都是事后才发现。③ **Qoder CLI 直驱通道**（2026-09-02 启用）：人工检查点由"粘贴提示词"变为"简报 → 用户确认 → 执行 → 独立核实"，只用于能自动验证对错的任务；明确与 NightOps 禁令的边界（直驱有人在手环中，无人值守 Loop 仍然禁止）。④ **完成的定义与报告纪律**：完成 = commit+push+CI 绿+回填 CI 号，未提交只能报"已写入工作区，待提交"，声称已提交必须在 origin 上查得到（曾有一次报告给出的 commit SHA 是工具在沙箱模拟出来的、压根不存在），只登记实取值、推导值不得混进"实测/前后/差值"格式。NightOps 章节**刻意保留不删**：它是试过又主动停掉的机制，删掉后后来人会当成新想法重新提议。v0.5.0：新增汇报表达约定——handoff、看板事件行与所有面向 user-owner 的任务汇报中，任务代号（O×/Sprint×/RP-×/Batch×/SP-×等）必须附带主题括号注释，禁止只出编号（与 speak-plainly Skill 同步）。v0.4.0：删除已下线的 NightOps 三 AI 循环章节与相关必读/分级/门禁条目；KIMICODE 标记 retired，Claude Code 候选槽位移除；验证命令统一 `npm run test:web`；明确 Qoder handoff 与外部回填模板的扩展关系。
