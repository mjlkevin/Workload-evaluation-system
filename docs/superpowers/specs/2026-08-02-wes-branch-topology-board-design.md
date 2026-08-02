# WES 分支拓扑与 Worktree 看板设计

- 日期：2026-08-02
- 状态：用户已确认设计
- 来源 Issue：`ISS-2026-08-02-001`
- 派生需求：`RP-045`
目标看板：`03_技术设计/系统架构/WES-Agent-升级总看板/`

## 1. 背景与问题

WES 使用 Codex、Qoder 等多个执行者在独立 branch/worktree 中协作。当前分支事实分散在 Git 命令、handoff、审计文档和变更记录中，看板没有统一回答以下问题：

- 当前业务主线是哪一条分支、HEAD 是什么。
- 哪些子分支仍绑定活跃 worktree。
- 哪些分支已成为主线祖先，哪些仍未并入主线。
- 哪些分支共享相同提交指针，可能属于重复或历史残留。
- 分支状态是 Git 可证明事实，还是需要人工判断的治理建议。

2026-08-02 本地精确盘点为 36 个本地分支、20 个主线祖先分支、16 个非祖先分支和 4 个活跃 worktree。现有 `collaboration-protocol.html` 描述 branch/worktree/commit 协作规则，但没有完整、可自动刷新的分支拓扑与台账。

去重未命中同类需求。`RP-044` 已由 UI-07 评审列表优化占用，本项登记为 `ISS-2026-08-02-001 → RP-045`。

## 2. 目标与非目标

### 2.1 目标

1. 在 WES 总看板新增一级页面 `branches.html`，展示当前仓库的主线、子分支、远端跟踪引用和 worktree。
2. 提供自动生成命令，以本地 Git refs 和 worktree porcelain 为唯一运行事实源。
3. 用“运营拓扑 + 完整台账”同时满足快速决策和完整追溯。
4. 明确区分 Git 事实与治理建议，避免把“非祖先”误写为“未交付”或“应删除”。
5. 在生成失败时保留上一版有效快照，不用空数据覆盖看板。

### 2.2 非目标

- 不在浏览器内执行 Git 命令。
- 不自动执行 `git fetch`、`git pull`、merge、rebase、branch delete 或 worktree remove。
- 不把本地 remote-tracking ref 描述为远端实时状态。
- 不为 MiniCRM 或项目注册表中的其他独立仓库生成分支图。
- 不以分支名称推断需求已交付、Gate 已通过或可以删除；这些结论仍以看板事件和人工 Gate 为准。

## 3. 信息架构与页面布局

采用用户确认的 B 方案：运营拓扑 + 完整分支台账。

### 3.1 一级导航

在总看板所有一级页面的主导航中增加“分支拓扑”，链接到 `branches.html`。新页面沿用现有 `base.css`、`components.css` 和 `pages.css`，不引入第二套 UI 技术栈。

### 3.2 页面结构

页面从上到下包含四个区域：

1. **快照头部**
   - 主线分支和 HEAD。
   - 生成时间、仓库根目录、刷新命令。
   - remote 信息明确标注为“本地跟踪快照”。
2. **KPI 卡片**
   - 本地分支数。
   - 活跃 worktree 数。
   - 主线祖先分支数。
   - 非祖先分支数。
   - 重复提交指针组数。
3. **运营拓扑图**
   - 主线作为唯一根节点突出展示。
   - 活跃 worktree 对应分支逐一展开。
   - 非祖先分支按 `codex/`、`qoder/`、`feature/`、其他前缀分组，可展开查看。
   - 主线祖先、重复指针和历史分支默认折叠成摘要节点。
4. **完整分支台账**
   - 36/36 分支逐行保留，不因拓扑折叠而丢失。
   - 支持按 Git 关系、worktree、前缀和治理建议筛选，并支持分支名/提交信息搜索。

### 3.3 台账字段

每个本地分支至少展示：

- `branchName`
- `headShort` / `headFull`
- `subject`
- `author`
- `committerDate`
- `gitRelation`：`current | ancestor | non_ancestor`
- `ahead` / `behind`：相对配置主线的提交计数
- `worktreePath`
- `worktreeDirty`：`clean | dirty | unknown`
- `upstream`
- `upstreamTrack`
- `duplicateTipGroup`
- `governanceSuggestion`

远端跟踪引用独立列出，不混入本地分支总数；符号引用单独标记。

## 4. 生成架构

### 4.1 文件职责

- `scripts/generate-branch-board.js`
  - 读取 Git 和 worktree 事实。
  - 计算分类、统计、重复指针和警告。
  - 原子写入生成快照。
- `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-board.config.json`
  - 保存业务主线名称、默认远端名称和治理提示阈值。
  - 这是人工维护的治理配置，不由生成器覆盖。
- `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js`
  - 生成文件，设置 `window.WES_BRANCH_SNAPSHOT`。
  - 采用 JavaScript 数据文件而不是运行时 `fetch` JSON，保证看板通过 `file://` 直接打开时可用。
- `03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.js`
  - 只负责渲染、折叠、筛选、搜索和空状态。
  - 不执行系统命令，不修改快照。
- `03_技术设计/系统架构/WES-Agent-升级总看板/branches.html`
  - 稳定页面骨架、语义区域和无 JavaScript 降级说明。
- `scripts/branch-board.test.js`
  - 覆盖解析、分类、重复指针、渲染数据契约和失败保护。
- `package.json`
  - 新增 `board:branches` 和 `test:board:branches` 命令。

### 4.2 主线配置

生成器从 `data/branch-board.config.json` 读取显式主线 `codex/role-driven-ai-home-workbench`，而不是盲目采用运行命令时的当前分支。这样即使在功能分支或临时 worktree 中生成，也不会把执行分支误当业务主线。

若配置主线不存在，命令必须失败并保留上一版快照。主线变更属于项目治理决策，需要同步更新配置和看板事件。

### 4.3 Git 数据采集

生成器只执行只读命令：

- `git for-each-ref`：读取本地和远端跟踪引用、HEAD、作者、时间、主题、upstream。
- `git worktree list --porcelain`：读取 worktree、branch、HEAD 和 locked/prunable 标记。
- `git merge-base --is-ancestor`：判定本地分支是否为主线祖先。
- `git rev-list --left-right --count`：计算相对主线 ahead/behind。
- `git status --porcelain`：仅对活跃 worktree 判定 clean/dirty。

生成器不得隐式联网，也不得改变 refs、索引或工作区。

## 5. 状态口径

### 5.1 Git 可证明事实

- `current`：配置主线当前指向。
- `ancestor`：分支 HEAD 是主线 HEAD 的祖先。
- `non_ancestor`：分支 HEAD 不是主线 HEAD 的祖先，可能领先、分叉或来自独立历史。
- `active_worktree`：分支被 `git worktree list` 中的有效 worktree 使用。
- `duplicate_tip`：两个或更多分支指向同一完整 commit SHA。
- `remote_tracking_snapshot`：本地保存的远端跟踪引用，不代表已执行最新 fetch。

### 5.2 治理建议

治理建议只能由确定性规则生成，并明确标注为建议：

- 当前主线：`保留主线`。
- 绑定 worktree：`活跃工作区，先复核任务状态`。
- 已是主线祖先且无 worktree：`可评估归档或清理`。
- 非祖先且无 worktree：`待确认集成、返工或归档`。
- 多分支同指针：`重复指针组，建议统一处置`。

生成器不得输出“已交付”“Gate 通过”“可以删除”等需要外部过程证据的结论。

## 6. 交互、响应式与可访问性

- 拓扑分组使用真实按钮控制展开/折叠，并维护 `aria-expanded`。
- 筛选按钮或选择框拥有可访问名称，当前筛选状态可被辅助技术识别。
- 统计和生成警告使用 `role="status"`；阻断性快照错误使用 `role="alert"`。
- 分支表格在窄屏使用局部横向滚动，不制造页面级水平溢出。
- 760px 下 KPI 卡片改为两列或单列，拓扑从横向连接切换为纵向层级。
- 颜色只辅助表达，Git 关系和治理建议必须同时有文字标签。
- 所有分支名、提交主题和作者字段在写入数据和 DOM 时安全转义。

## 7. 错误处理与快照保护

1. 先在内存中完成全部采集、校验和序列化，再写临时文件并原子替换正式快照。
2. 主线不存在、Git 命令失败、数据契约不完整或本地分支计数为零时退出非零，不能覆盖上一版有效快照。
3. 单个 worktree 的 dirty 状态读取失败时，将该字段记为 `unknown` 并记录 warning；其他分支仍可生成。
4. 页面检测不到快照时显示明确错误和刷新命令，不显示伪造的 0 分支空状态。
5. 页面显示 `generatedAt` 和 warning 数量，帮助用户判断快照是否过期或不完整。

## 8. 测试与验收

### 8.1 自动化测试

- Git 输出 fixture 能正确解析本地分支、远端引用和 worktree。
- 当前真实仓库生成结果包含全部本地分支，且分支名集合与 `git for-each-ref refs/heads` 完全一致。
- 主线和当前 HEAD 正确。
- 2026-08-02 基线下识别 36 个本地分支、20 个祖先、16 个非祖先和 4 个 worktree；未来分支变化后测试改为与实时 Git 集合比对，不硬编码历史数量。
- 相同 commit SHA 的分支能稳定分组。
- ahead/behind 和 ancestor 判定与 Git 原生命令一致。
- 主线缺失或关键命令失败时不覆盖已有快照。
- 分支名和提交主题中的 HTML 特殊字符不会形成可执行标记。
- 连续执行两次，在 Git 状态不变时生成的业务数据一致；仅允许生成时间变化。

### 8.2 页面验收

- 桌面端可在首屏识别主线、活跃 worktree、非祖先分支和可展开的历史摘要。
- 完整台账显示所有本地分支，没有被拓扑折叠遗漏。
- 筛选、搜索、展开/折叠支持鼠标和键盘操作。
- 1440px 和 760px 下均无页面级水平溢出，台账局部滚动可达。
- 通过 `file://` 打开时仍能读取生成快照并完成筛选。
- 页面不提供删除、合并、清理或远端同步按钮。

## 9. 看板治理同步

本需求进入实现时需要同步：

- `issues.html`：新增 `ISS-2026-08-02-001` 原始反馈与分诊结果。
- `requirements.html`：新增 `RP-045`，关联来源 Issue、范围和验收口径。
- `plan.html`：登记一次性实施任务和完成定义。
- `monitoring.html`：登记生成命令、快照时间、分支统计和验证结果。
- `changes.html`：登记设计、实现、验证和集成记录。
- `sources.html`：登记 `branches.html`、生成脚本和本规格。
- `index.html`：增加分支治理入口和当前快照摘要，但不把分支数量计入文档资产数量。

现有看板 HTML 处于 dirty 状态，实施时必须逐文件精确补丁，不得格式化、重写或覆盖用户在制修改。

## 10. 完成定义

只有同时满足以下条件，`RP-045` 才能标记为已实施验证：

1. `npm run board:branches` 成功生成当前仓库快照。
2. 自动化证明本地分支集合与 Git 完全一致。
3. `branches.html` 正确展示运营拓扑和完整台账。
4. 看板主导航和相关治理页面已同步。
5. 1440px、760px、键盘操作和 `file://` 场景完成验证。
6. 未执行或暗示任何自动 branch/worktree 删除操作。
