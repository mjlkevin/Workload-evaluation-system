# WES Agent 工作树收敛设计

**日期：** 2026-07-25
**目标分支：** `codex/wes-dirty-triage-20260629`
**工作区：** `/Users/kevin/AI/Workload-evaluation-system-agent`

## 背景

`Workload-evaluation-system-agent` 是与主目录共享同一 Git 仓库的 linked worktree。它相对主目录当前分支已有 32 个提交，同时还保留了跨后端、前端、数据库迁移、项目治理和总看板的未提交成果。当前问题不是“找回代码”，而是把这些成果从混合工作态收敛为可测试、可审查、可集成的交付单元。

已知基线红灯：

- 结构化输出测试因缺少 `ajv-formats` 无法启动。
- 需求治理测试 12 项中 1 项失败，现有 Skill 仍允许反馈直接进入需求池，与 issue-first 规则冲突。
- Web 测试 117 项中 9 项失败，集中在流式 API 导出、代码规则动作参数和系统管理路由。
- PostgreSQL 迁移只完成代码与策略测试，尚无真实数据库迁移和人工验收证据。
- linked worktree 曾因目录搬迁遗留 `/Users/kevin/AI-Local/...` Git 指针，导致当前 `/Users/kevin/AI/...` 目录无法被 Git 识别。

## 设计原则

1. **先恢复可验证性，再整理提交。** 不在红灯状态下合并主目录，也不把“已有代码”误写成“已交付”。
2. **按失败簇修复。** 后端依赖、治理 Skill、流式 API、系统管理动作和路由分别验证，避免一次性大改。
3. **保护既有成果。** 不清理、不还原、不格式化与本次红灯无关的 dirty changes；恢复用 stash `89a428f2e19735777b8a95d07c52911651ae4b66` 保留。
4. **issue-first。** 原始反馈先进入问题池；只有完成分类、去重和确认后，才进入需求或缺陷对象。
5. **证据分级。** 自动化测试通过、构建通过、真实 PostgreSQL 验证和人工验收分别记录，互不替代。
6. **路径以当前 Git 事实为准。** 当前活动工作区统一为 `/Users/kevin/AI/Workload-evaluation-system-agent`；主目录用于分支集成和历史核对。目录搬迁后必须使用 `git worktree repair` 更新 Git 双向指针。

## 收敛工作流

### A. 后端结构化输出

确认 `Ajv` 版本和 `structured-output` 的导入方式，将 `ajv-formats` 声明在真正消费它的 workspace 中，并更新锁文件。先运行结构化输出定向测试，再运行模块测试与 API 构建。

### B. 需求治理 Skill

以现有失败的 `scripts/board-work-items.test.js` 为 RED 证据，仅修改 `skills/recording-wes-requirements/SKILL.md` 中与 issue-first 冲突的入口规则。反馈必须先记录为 issue；需求池和缺陷池只接收分诊后的结构化对象。

### C. Web 红灯

- 恢复或补齐 `streamHomeWorkbenchChat` 的稳定导出与 SSE 行为。
- 代码规则启停动作使用规则记录 ID，不再用展示代码代替主键。
- `/system` 和系统子模块路由统一由配置驱动，并保证页面标题与导航测试一致。

每一簇先复现失败、查到调用链根因，再做最小修复并运行对应测试文件。

### D. 项目入口治理

修正 `AGENTS.md`、`CLAUDE.md` 和 `codex-project-registry.md` 的绝对路径与主线说明。仅改变本机工作区事实，不改产品架构边界。

### E. 验证与总看板

完成定向测试后运行：

- `npm run test:modules`
- `npm run test:web`
- `npm run test:ai`
- `npm run build:api`
- `npm run build:web`
- `node --test scripts/board-event.test.js scripts/board-work-items.test.js`

总看板只记录实际证据：自动化或构建未通过时保持“修复中”；PostgreSQL 真实迁移和人工验收未执行时保持“待执行/待回填”。

## 提交边界

验证通过后按以下边界整理，不混入运行时账号或本地数据：

1. 后端结构化输出与迁移基础设施。
2. 上下文边界与运行时可靠性。
3. Web 系统管理与流式会话修复。
4. issue-first 看板治理、脚本和 Skill。
5. 审计、计划、总看板与路径治理文档。

`config/auth/users.json`、本地数据库、日志、导出物和密钥类文件不得因收敛而进入提交。

## 集成门禁

只有以下条件满足后，才进入与主目录分支的集成决策：

- 定向红灯全部关闭。
- 全量测试和构建有当前证据。
- 总看板未将未执行的 PostgreSQL/人工验收标记为通过。
- 主题提交边界可审查。
- 主目录自身未提交改动已单独保护，并明确采用 merge、rebase 或暂不集成。

真实 PostgreSQL 迁移或人工业务验收如缺少环境，不阻塞代码收敛，但会阻止“已上线/已交付”的结论。
