# Speak Plainly Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建并验证可跨项目复用的 `speak-plainly` Skill，并让 WES 的模型入口在面向用户进行任务沟通时稳定触发它。

**Architecture:** Skill 本体保持通用、自包含，只负责用户可见任务沟通；WES 入口文件只增加触发引用，不复制规则。项目级测试检查 Skill 结构、通用性、关键行为约束和入口覆盖，总看板记录 WES 采用该 Skill 的过程事实。

**Tech Stack:** Markdown、YAML、Node.js 内置测试、Skill Creator 校验脚本、静态 HTML 总看板。

---

## 文件边界

**新增：**

- `skills/speak-plainly/SKILL.md`
- `skills/speak-plainly/agents/openai.yaml`
- `scripts/speak-plainly-skill.test.js`
- `docs/superpowers/evaluations/2026-08-02-speak-plainly-scenarios.md`
- `docs/superpowers/specs/2026-08-02-speak-plainly-skill-design.md`
- `docs/superpowers/plans/2026-08-02-speak-plainly-skill.md`

**修改：**

- `AGENTS.md`
- `CLAUDE.md`
- `QODER.md`
- `KIMICODE.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`
- 当前汇总数字所在的 `index.html`、`plan.html`、`roadmap.html`

**不修改：** 产品代码、接口、配置数据、UI、其他 Skill 正文及无关未提交修改。

### Task 1: 建立失败基线和需求来源记录

- [x] **Step 1: 新增结构与行为约束测试**

创建 `scripts/speak-plainly-skill.test.js`，检查 Skill 名称、触发描述、核心沟通规则、状态准确性、技术证据保留、自然表达、项目无关性和四个 WES 模型入口。

- [x] **Step 2: 验证测试先失败**

Run: `node --test scripts/speak-plainly-skill.test.js`

Expected: 因 `skills/speak-plainly/SKILL.md` 尚不存在而失败。

- [x] **Step 3: 完成需求去重与编号**

确认 RP-046 只覆盖总看板页面文案；新增来源问题 `ISS-2026-08-02-004`，派生需求 `RP-048`，并建立二者与 RP-046 的关联。

### Task 2: 初始化并编写通用 Skill

- [x] **Step 1: 使用官方初始化脚本生成目录**

Run:

```bash
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/init_skill.py speak-plainly --path skills --interface 'display_name=Speak Plainly' --interface 'short_description=Turn technical task updates into clear, natural language' --interface 'default_prompt=Use $speak-plainly to rewrite this task update for a business audience while preserving technical evidence.'
```

Expected: 生成 `SKILL.md` 和 `agents/openai.yaml`。

- [x] **Step 2: 写入最小通用规则**

Skill 必须包含：结论先行、读者视角、术语解释、准确状态、技术证据保留、自然表达、技术深度例外、一个前后对照示例、常见错误和发送前自检；不得包含 WES 专属术语或路径。

- [x] **Step 3: 运行项目测试和 Skill 格式校验**

Run:

```bash
node --test --test-name-pattern='^skill:' scripts/speak-plainly-skill.test.js
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/speak-plainly
```

Expected: 全部通过。

### Task 3: 接入 WES 模型入口

- [x] **Step 1: 增加统一触发规则**

在 `AGENTS.md` 中规定所有面向用户的任务沟通必须读取 `skills/speak-plainly/SKILL.md`；在 `CLAUDE.md`、`QODER.md`、`KIMICODE.md` 的必读或 Required Skills 中增加同一引用。入口只引用，不复制正文。

- [x] **Step 2: 复跑入口覆盖测试**

Run: `node --test scripts/speak-plainly-skill.test.js`

Expected: 所有入口均命中并通过。

### Task 4: 同步 WES 需求池和总看板

- [x] **Step 1: 更新问题、需求和变更记录**

记录 `ISS-2026-08-02-004`、`RP-048`、去重结论、实施范围、验证方式和“自动化通过 / 待用户体验确认”状态。

- [x] **Step 2: 更新当前汇总与信息来源**

当前需求数由 39 调整为 40，待处理由 15 调整为 16。台账复核发现问题池原有汇总少计 1 条，因此以实际 24 条问题、9 条转需求为准，不沿用旧的 22/7 汇总。只改当前快照，不改历史记录。登记设计稿、实施计划和 Skill 资产。

- [x] **Step 3: 验证 HTML 和看板一致性**

Run:

```bash
for f in issues requirements changes sources index plan roadmap; do python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null || exit 1; done
node scripts/board-consistency-check.js
```

Expected: HTML 解析通过；看板一致性 0 errors。

### Task 5: 最终验证

- [x] **Step 1: 检查通用性和未完成占位符**

Run: `rg -n 'WES|Harness|NightOps|TODO|TBD' skills/speak-plainly`

Expected: 无输出。

- [x] **Step 2: 执行全部聚焦验证**

Run:

```bash
node --test scripts/speak-plainly-skill.test.js
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/speak-plainly
node scripts/board-consistency-check.js
```

Expected: 全部 exit 0，无失败。

- [x] **Step 3: 审查差异边界**

Run:

```bash
git status --short
git diff --check
```

Expected: 只新增或修改计划内文件；无空白错误。本任务不提交或推送，避免把工作区中其他用户修改混入提交。
