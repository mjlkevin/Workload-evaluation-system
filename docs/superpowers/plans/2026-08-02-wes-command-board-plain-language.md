# WES Agent Command Board Plain-Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变项目事实和技术证据的前提下，把 WES Agent 总看板 18 个页面改写成产品经理和业务用户可以快速理解的项目管理语言。

**Architecture:** 保持现有静态 HTML、共享 CSS、导航构建和事件数据结构不变，只调整用户可见文案。源 HTML 是正文事实源，`scripts/board-build.js` 是构建版导航文案事实源，`dist/` 只通过构建脚本生成；所有编号、状态、日期、链接、命令和技术标识均保留。

**Tech Stack:** 静态 HTML、Node.js 看板脚本、Python 标准库 HTML 解析器、Git 差异审查。

---

## 文件边界

**新增或更新治理记录：**

- `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`

**改写的源页面：**

- `index.html`, `roadmap.html`, `requirements.html`, `issues.html`, `defects.html`
- `design.html`, `design-architecture.html`, `runtime.html`
- `plan.html`, `testing.html`, `monitoring.html`, `risks.html`, `changes.html`
- `sources.html`, `collaboration-protocol.html`, `branches.html`, `code-audit.html`, `ops-health.html`

以上文件均位于 `03_技术设计/系统架构/WES-Agent-升级总看板/`。

**导航与构建：**

- `scripts/board-build.js`
- `scripts/branch-board-page.test.js`（仅在现有断言依赖旧标签时更新断言）
- `03_技术设计/系统架构/WES-Agent-升级总看板/dist/*.html`（自动生成）

**明确不修改：**

- `events/*.json`
- `data/*.js`
- `work-items/*.json`
- `phase-*-implementation-prompt.md`
- 页面 CSS、交互脚本、接口和业务代码

### Task 1: 保存脏工作区基线并完成问题分诊

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`

- [ ] **Step 1: 保存改写前源页面副本**

Run:

```bash
test ! -e /tmp/wes-board-copy-baseline-bb67875
mkdir /tmp/wes-board-copy-baseline-bb67875
cp 03_技术设计/系统架构/WES-Agent-升级总看板/*.html /tmp/wes-board-copy-baseline-bb67875/
```

Expected: 目录中有 18 个 HTML 文件；仓库文件不发生变化。

- [ ] **Step 2: 执行去重检索**

Run:

```bash
rg -n -i '总看板.{0,30}(文案|术语|可读|易懂|业务)|文案.{0,30}总看板|术语.{0,30}总看板|看板.{0,30}(晦涩|理解成本|认知成本)' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{issues,requirements,defects,changes,plan}.html
```

Expected: 没有同范围记录；“页面定位”类结果不构成重复项。

- [ ] **Step 3: 登记原始问题与派生需求**

使用以下固定信息增量更新现有页面：

```text
Issue: ISS-2026-08-02-002
Title: 总看板文案偏工程化，业务读者理解成本高
Source: user_request
Disposition: requirement
Linked requirement: RP-046
Priority: P1
Status: 实施中
Acceptance: 18 个源页面使用业务主表达；技术证据可追溯；业务读者能识别现状、影响、风险和下一步。
```

同时将统一需求口径从“37 项 / 13 项待处理”更新为“38 项 / 14 项待处理”，保持“22 项已交付 / 2 项暂缓”不变。只更新表达当前汇总的字段；历史快照中的旧数字不追溯改写。

- [ ] **Step 4: 解析治理页面**

Run:

```bash
for f in issues requirements plan changes index; do
  python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null
done
```

Expected: exit 0。

### Task 2: 统一导航和业务表达词典

**Files:**

- Modify: all 18 source HTML files
- Modify: `scripts/board-build.js`
- Test: `scripts/branch-board-page.test.js`

- [ ] **Step 1: 将高理解成本导航名称改为业务名称**

使用以下固定映射，其他导航名称保持不变：

```text
任务运行时 -> AI 任务执行
测试 -> 测试与验收
文档事实源 -> 信息来源
协作协议 -> 多 AI 协作
分支拓扑 -> 开发分支
```

在 18 个源页面导航和 `scripts/board-build.js` 的 `NAV_ITEMS` 中保持同一映射。页面文件名、链接和 active 行为不变。

- [ ] **Step 2: 运行导航聚焦测试**

Run:

```bash
node --test scripts/branch-board-page.test.js
```

Expected: 全部通过；若断言引用旧标签，只把断言期望值改为上述新标签，不改变行为测试。

- [ ] **Step 3: 检查导航一致性**

Run:

```bash
node scripts/board-consistency-check.js
```

Expected: 0 errors；允许既有 `branches.html` footer 日期警告继续存在，但本任务应补齐该日期并消除警告。

### Task 3: 改写总览、路标和计划入口

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/roadmap.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`

- [ ] **Step 1: 改写首屏结论**

每个页面首屏必须依次说明：页面用途、当前进展、主要风险、下一步。把 `Phase` 写成“阶段”，在阶段编号中保留原编号；把 `delivered/pending/deferred` 主显示改为“已交付/待处理/暂缓”。

- [ ] **Step 2: 改写路标和计划段落**

长段落使用“现状—影响—行动”顺序。保留 RP 编号、分支、提交、测试和 Gate 名称；`Gate` 首次出现写成“进入下一阶段的检查关口（Gate）”。

- [ ] **Step 3: 验证三个页面**

Run:

```bash
for f in index roadmap plan; do
  python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null
done
rg -n '36 requirements|37 项|13 项待|Phase 1H-C planning' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{index,roadmap,plan}.html
```

Expected: HTML 解析通过；当前汇总不再出现 36/37 或 13 项待处理；历史记录中的阶段名称可保留。

### Task 4: 改写问题池、需求池和缺陷池

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/defects.html`

- [ ] **Step 1: 改写页面用途和列名**

用业务语言解释三个页面的关系：问题池保留原始反馈，需求池记录需要新增或优化的能力，缺陷池记录未达到既定预期的行为。技术分类值保留为证据，不作为主要标题。

- [ ] **Step 2: 改写当前工作项**

对当前仍在处理或等待验收的项目，使用“问题—影响—处理方式—完成标准”顺序。已关闭历史项目只简化明显晦涩的英文状态和长技术句，不改变原始结论。

- [ ] **Step 3: 验证台账数字和来源关系**

Run:

```bash
rg -n 'ISS-2026-08-02-002|RP-046|38 条需求|14 项待' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{issues,requirements,plan,index,changes}.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/issues.html >/dev/null
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html >/dev/null
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/defects.html >/dev/null
```

Expected: issue 与 requirement 双向可追溯；需求总数和待处理数一致；解析通过。

### Task 5: 改写设计、架构和 AI 任务执行页面

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/design.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/design-architecture.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/runtime.html`

- [ ] **Step 1: 先解释业务作用**

每个技术模块先说明它保障的业务结果，再保留技术名称。统一采用：

```text
Harness -> AI 任务运行与审计底座（Harness）
Artifact -> 任务产物（Artifact）
Trace -> 过程记录（trace）
Provider -> 外部模型或服务提供方（Provider）
Runtime -> 任务执行过程
owner-scoped -> 按当前用户隔离
fallback -> 备用处理
```

- [ ] **Step 2: 明确范围和风险**

把架构边界改写为“可以做什么 / 不可以做什么 / 为什么”，保留 JWT、PostgreSQL、JSON Repository、API 路径和对象 ID。

- [ ] **Step 3: 解析并抽查术语解释**

Run:

```bash
for f in design design-architecture runtime; do
  python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null
done
rg -n 'AI 任务运行与审计底座|任务产物|过程记录|外部模型或服务提供方|按当前用户隔离|备用处理' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{design,design-architecture,runtime}.html
```

Expected: 解析通过；每个仍需保留的核心专有名词至少有一处中文解释。

### Task 6: 改写测试、监控、风险和运行健康页面

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/code-audit.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/ops-health.html`

- [ ] **Step 1: 区分验证状态**

所有用户可见状态优先使用“已通过 / 待执行 / 待回填 / 未通过 / 受阻”。命令原始输出中的 `pass/fail` 保留在代码样式证据中。

- [ ] **Step 2: 用业务影响描述风险和异常**

测试说明写清“验证什么”；监控项写清“异常会影响什么”；风险项写清“发生条件、影响、控制方式和是否需要决策”；代码审计与运行健康先给结论，再列技术证据。

- [ ] **Step 3: 验证状态没有被误升级**

Run:

```bash
rg -n '待执行|待回填|未通过|受阻|已通过' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{testing,monitoring,risks,code-audit,ops-health}.html
for f in testing monitoring risks code-audit ops-health; do
  python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null
done
```

Expected: 原“待执行/待回填”记录仍保持未完成状态；HTML 解析通过。

### Task 7: 改写协作、分支、信息来源和变更记录

**Files:**

- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/collaboration-protocol.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/branches.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

- [ ] **Step 1: 改写多 AI 协作规则**

以“角色负责什么、什么时候交接、谁检查、什么情况禁止继续”组织内容。`NightOps`、`Gate`、`handoff`、`Loop` 首次出现提供中文解释，协议名称和文件名保留。

- [ ] **Step 2: 改写开发分支页面**

用“当前开发主线 / 正在处理 / 等待合并或返工 / 可清理建议”解释分支关系。保留 branch、worktree、ancestor、SHA 等 Git 证据，并将 worktree 首次解释为“独立开发目录”。补齐 `branches.html` footer 日期为 `2026-08-02`。

- [ ] **Step 3: 改写信息来源和变更记录**

信息来源页解释“哪份资料回答什么问题、何时适用”；变更记录使用“为什么改、影响什么、如何验证、还剩什么”。登记设计说明和实施计划两个新文档，不修改历史文档总数，直到实际新增行数完成核对后再同步 KPI。

- [ ] **Step 4: 解析四个页面**

Run:

```bash
for f in collaboration-protocol branches sources changes; do
  python3 -m html.parser "03_技术设计/系统架构/WES-Agent-升级总看板/${f}.html" >/dev/null
done
```

Expected: exit 0。

### Task 8: 生成构建版并完成一致性验证

**Files:**

- Generate: `03_技术设计/系统架构/WES-Agent-升级总看板/dist/*.html`
- Generate: `03_技术设计/系统架构/WES-Agent-升级总看板/dist/assets/dashboard.css`

- [ ] **Step 1: 对比本轮改写与任务前基线**

Run:

```bash
diff -ru /tmp/wes-board-copy-baseline-bb67875 \
  03_技术设计/系统架构/WES-Agent-升级总看板 \
  --exclude=dist --exclude=assets --exclude=data --exclude=events --exclude=work-items
```

Expected: 只看到 18 个源 HTML 的用户可见文案与治理记录变化；无脚本、状态值、编号、链接或事件数据被意外删除。`diff` 因存在预期差异返回 1。

- [ ] **Step 2: 执行完整源页面解析**

Run:

```bash
for f in 03_技术设计/系统架构/WES-Agent-升级总看板/*.html; do
  python3 -m html.parser "$f" >/dev/null || exit 1
done
```

Expected: exit 0。

- [ ] **Step 3: 执行看板一致性和分支测试**

Run:

```bash
node scripts/board-consistency-check.js
npm run board:branches:check
```

Expected: 一致性检查 0 errors、0 warnings；分支看板 38 tests pass。

- [ ] **Step 4: 生成正式 `dist/`**

Run:

```bash
node scripts/board-build.js
```

Expected: 18 个 HTML 页面生成成功，字体与分支资源复制成功。

- [ ] **Step 5: 验证构建版文案和 HTML**

Run:

```bash
for f in 03_技术设计/系统架构/WES-Agent-升级总看板/dist/*.html; do
  python3 -m html.parser "$f" >/dev/null || exit 1
done
rg -n 'AI 任务执行|测试与验收|信息来源|多 AI 协作|开发分支' \
  03_技术设计/系统架构/WES-Agent-升级总看板/dist/*.html
```

Expected: 构建版解析通过，五个新导航名称均存在。

- [ ] **Step 6: 检查未完成模板和意外技术化回退**

Run:

```bash
rg -n 'T[B]D|T[O]DO|待定|占位文案' \
  03_技术设计/系统架构/WES-Agent-升级总看板/*.html
rg -n '36 requirements|37 条需求|13 pending|Phase 1H-C planning' \
  03_技术设计/系统架构/WES-Agent-升级总看板/{index,requirements,plan,changes}.html
```

Expected: 没有新引入的未完成模板；当前汇总口径不含旧值。历史项目正文中原有未完成标记只有在属于原始证据时才可保留，并需人工说明。

## 提交约束

当前 14 个看板源文件在任务开始前已有用户未提交改动。禁止把这些既有改动与本任务一起提交，也禁止使用 reset、checkout 或整页覆盖恢复。实施计划文档可以单独提交；看板正文完成后只报告差异和验证结果，由用户决定何时整理提交。
