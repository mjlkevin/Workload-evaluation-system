# WES Branch Topology Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WES 总看板新增自动生成的 Git 分支与 worktree 运营拓扑，完整展示当前仓库全部分支，同时把 Git 事实与治理建议分开。

**Architecture:** 以纯 Node.js Git 采集库为核心，通过只读 Git 命令构造稳定快照；CLI 原子生成 `branch-snapshot.js`，静态 `branches.html` 通过独立渲染脚本读取快照，确保 `file://` 可用。现有 dirty 看板 HTML 只通过幂等导航同步器和精确补丁追加内容，不重写、不格式化、不自动删除分支或 worktree。

**Tech Stack:** Node.js CommonJS、`node:test`、Git CLI、静态 HTML/CSS/JavaScript、WES 现有看板样式与 board-event/work-item 工具链。

---

## Scope And File Map

### New files

- `scripts/branch-board-lib.js` — 纯解析、分类、重复指针分组、治理建议和快照校验。
- `scripts/generate-branch-board.js` — 调用只读 Git 命令并原子写入快照的 CLI。
- `scripts/branch-board.test.js` — Git fixture、真实仓库集合、错误保护和幂等性测试。
- `scripts/branch-board-page.test.js` — 页面骨架、渲染模块、导航与安全输出契约测试。
- `scripts/sync-board-branch-nav.js` — 幂等地给现有看板页面插入“分支拓扑”导航，不改其他内容。
- `03_技术设计/系统架构/WES-Agent-升级总看板/branches.html` — 分支拓扑页面骨架。
- `03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.css` — 页面专属拓扑和窄屏样式。
- `03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.js` — DOM 渲染、筛选、搜索、折叠和状态播报。
- `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-board.config.json` — 主线、默认远端与治理阈值。
- `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js` — 自动生成快照。
- `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json` — 需求、实现与验证事件。

### Modified clean or generator-owned files

- `package.json:5-34` — 新增 `board:branches`、`board:branches:check`、`test:board:branches`。
- `scripts/board-build.js:17-32,88-116` — 导航配置增加 `branches.html`，构建时复制页面专属 assets 和 data。
- `scripts/board-sidebar-transform.js:17-36` — 导航配置增加“分支拓扑”。
- `scripts/board-consistency-check.js:18-34` — 把 `branches.html` 纳入一致性扫描。
- `scripts/board-work-items-lib.js:108-128` — 生成的问题池/缺陷池导航增加“分支拓扑”。
- `scripts/board-work-items.test.js` — 断言生成页面包含新导航。
- `03_技术设计/系统架构/WES-Agent-升级总看板/work-items/board-work-items.json` — 新增 `ISS-2026-08-02-001`，分流到 `RP-045`。

### Modified dirty board files — exact insertion only

- `03_技术设计/系统架构/WES-Agent-升级总看板/*.html` — 仅由幂等导航同步器添加 `branches.html` 链接。
- `issues.html` — 追加 `ISS-2026-08-02-001` 可视记录。
- `requirements.html` — 追加 `RP-045` 需求卡和验收口径。
- `index.html` — 增加分支治理入口与当前快照摘要。
- `plan.html` — 增加 RP-045 实施与完成定义。
- `monitoring.html` — 增加快照生成与验证记录。
- `changes.html` — 增加设计/实现/验证时间线记录。
- `sources.html` — 登记页面、生成脚本、规格和计划。

这些 HTML 在当前主 checkout 已有用户未提交修改。实施时不得执行整文件 checkout、restore、格式化或生成器覆盖；提交时只能暂存能够明确归属于 RP-045 的新文件和精确 hunk。

---

### Task 1: Establish Isolated Execution And Baseline

**Files:**
- Read: `AGENTS.md`
- Read: `codex-project-registry.md`
- Read: `docs/superpowers/specs/2026-08-02-wes-branch-topology-board-design.md`
- Read: `skills/maintain-wes-command-board/SKILL.md`
- Read: `skills/recording-wes-requirements/SKILL.md`

- [ ] **Step 1: Capture the current mainline and dirty paths**

Run from `/Users/kevin/AI/Workload-evaluation-system`:

```bash
git status --short --branch
git worktree list --porcelain
git rev-parse codex/role-driven-ai-home-workbench
git for-each-ref --format='%(refname:short)' refs/heads | sort
```

Expected: current branch is `codex/role-driven-ai-home-workbench`; existing dirty files remain visible; branch list is non-empty.

- [ ] **Step 2: Create an isolated implementation worktree**

Use `superpowers:using-git-worktrees`. Create:

```text
worktree: /Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/rp-045-branch-board
branch: codex/rp-045-branch-board
base: current codex/role-driven-ai-home-workbench HEAD
```

Expected: implementation worktree is clean and main checkout dirty files are unchanged.

- [ ] **Step 3: Record the real baseline counts without hard-coding them into production logic**

Run:

```bash
git for-each-ref --format='%(refname:short)' refs/heads | wc -l
git branch --merged codex/role-driven-ai-home-workbench | sed 's/^[*+ ]*//' | sed '/^$/d' | wc -l
git branch --no-merged codex/role-driven-ai-home-workbench | sed 's/^[*+ ]*//' | sed '/^$/d' | wc -l
git worktree list --porcelain | rg '^worktree ' | wc -l
```

Expected for the approved 2026-08-02 snapshot: `36`, `20`, `16`, `4`. If branches changed after approval, record the new factual counts and keep acceptance based on exact equality with Git, not the historical constants.

---

### Task 2: Build The Pure Git Snapshot Library With TDD

**Files:**
- Create: `scripts/branch-board.test.js`
- Create: `scripts/branch-board-lib.js`

- [ ] **Step 1: Write failing parser and classifier tests**

Create `scripts/branch-board.test.js` with this initial content:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildDuplicateTipGroups,
  buildSnapshot,
  parseRefOutput,
  parseWorktreePorcelain,
  validateSnapshot,
  writeSnapshotAtomic,
} = require('./branch-board-lib');

const REF_OUTPUT = [
  ['codex/role-driven-ai-home-workbench', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-02T11:00:00+08:00', 'kevin', 'mainline', '', ''].join('\0'),
  ['qoder/ui-005-knowledge-base', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-07-27T11:51:20+08:00', 'kevin', 'knowledge base', '', ''].join('\0'),
  ['qoder/code-audit-fix-r2', 'cccccccccccccccccccccccccccccccccccccccc', '2026-06-30T10:59:43+08:00', 'kevin', 'audit', '', ''].join('\0'),
  ['qoder/code-audit-fix-r3', 'cccccccccccccccccccccccccccccccccccccccc', '2026-06-30T10:59:43+08:00', 'kevin', 'audit', '', ''].join('\0'),
].join('\n');

const WORKTREE_OUTPUT = [
  'worktree /repo',
  'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'branch refs/heads/codex/role-driven-ai-home-workbench',
  '',
  'worktree /repo/.claude/worktrees/ui-005',
  'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'branch refs/heads/qoder/ui-005-knowledge-base',
  '',
].join('\n');

test('parseRefOutput preserves ref facts and special text as data', () => {
  const refs = parseRefOutput(REF_OUTPUT);
  assert.equal(refs.length, 4);
  assert.deepEqual(refs[0], {
    branchName: 'codex/role-driven-ai-home-workbench',
    headFull: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headShort: 'aaaaaaa',
    committerDate: '2026-08-02T11:00:00+08:00',
    author: 'kevin',
    subject: 'mainline',
    upstream: '',
    upstreamTrack: '',
  });
});

test('parseWorktreePorcelain maps branch names to worktree paths', () => {
  const worktrees = parseWorktreePorcelain(WORKTREE_OUTPUT);
  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[1].branchName, 'qoder/ui-005-knowledge-base');
  assert.equal(worktrees[1].path, '/repo/.claude/worktrees/ui-005');
});

test('buildDuplicateTipGroups groups every branch sharing the same full SHA', () => {
  const groups = buildDuplicateTipGroups(parseRefOutput(REF_OUTPUT));
  assert.deepEqual(groups, [{
    id: 'duplicate-ccccccc',
    headFull: 'cccccccccccccccccccccccccccccccccccccccc',
    branches: ['qoder/code-audit-fix-r2', 'qoder/code-audit-fix-r3'],
  }]);
});

test('buildSnapshot keeps Git facts separate from governance suggestions', () => {
  const snapshot = buildSnapshot({
    generatedAt: '2026-08-02T03:00:00.000Z',
    repoRoot: '/repo',
    mainBranch: 'codex/role-driven-ai-home-workbench',
    localRefs: parseRefOutput(REF_OUTPUT),
    remoteRefs: [],
    worktrees: parseWorktreePorcelain(WORKTREE_OUTPUT),
    relations: new Map([
      ['codex/role-driven-ai-home-workbench', { gitRelation: 'current', ahead: 0, behind: 0 }],
      ['qoder/ui-005-knowledge-base', { gitRelation: 'non_ancestor', ahead: 1, behind: 4 }],
      ['qoder/code-audit-fix-r2', { gitRelation: 'ancestor', ahead: 0, behind: 12 }],
      ['qoder/code-audit-fix-r3', { gitRelation: 'ancestor', ahead: 0, behind: 12 }],
    ]),
    dirtyByPath: new Map([['/repo', 'dirty'], ['/repo/.claude/worktrees/ui-005', 'clean']]),
    warnings: [],
  });

  assert.equal(snapshot.summary.localBranchCount, 4);
  assert.equal(snapshot.summary.worktreeCount, 2);
  assert.equal(snapshot.branches[1].gitRelation, 'non_ancestor');
  assert.equal(snapshot.branches[1].governanceSuggestion, '活跃工作区，先复核任务状态');
  assert.equal(snapshot.branches[2].governanceSuggestion, '重复指针组，建议统一处置');
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test('writeSnapshotAtomic does not replace a valid snapshot when validation fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-'));
  const target = path.join(dir, 'branch-snapshot.js');
  fs.writeFileSync(target, 'window.WES_BRANCH_SNAPSHOT = {"sentinel":true};\n');
  assert.throws(() => writeSnapshotAtomic(target, { branches: [] }), /invalid snapshot/i);
  assert.match(fs.readFileSync(target, 'utf8'), /sentinel/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test scripts/branch-board.test.js
```

Expected: FAIL with `Cannot find module './branch-board-lib'`.

- [ ] **Step 3: Implement the minimal pure library**

Create `scripts/branch-board-lib.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

function parseRefOutput(output) {
  return String(output || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [branchName, headFull, committerDate, author, subject, upstream, upstreamTrack] = line.split('\0');
      return {
        branchName,
        headFull,
        headShort: headFull.slice(0, 7),
        committerDate,
        author,
        subject,
        upstream,
        upstreamTrack,
      };
    });
}

function parseWorktreePorcelain(output) {
  return String(output || '')
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const record = {};
      for (const line of block.split('\n')) {
        const space = line.indexOf(' ');
        const key = space === -1 ? line : line.slice(0, space);
        const value = space === -1 ? true : line.slice(space + 1);
        record[key] = value;
      }
      return {
        path: record.worktree,
        headFull: record.HEAD,
        branchName: String(record.branch || '').replace(/^refs\/heads\//, ''),
        detached: Boolean(record.detached),
        locked: record.locked || false,
        prunable: record.prunable || false,
      };
    });
}

function buildDuplicateTipGroups(refs) {
  const byHead = new Map();
  for (const ref of refs) {
    const branches = byHead.get(ref.headFull) || [];
    branches.push(ref.branchName);
    byHead.set(ref.headFull, branches);
  }
  return [...byHead.entries()]
    .filter(([, branches]) => branches.length > 1)
    .map(([headFull, branches]) => ({
      id: `duplicate-${headFull.slice(0, 7)}`,
      headFull,
      branches: branches.sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function branchPrefix(branchName) {
  const slash = branchName.indexOf('/');
  return slash === -1 ? 'other' : branchName.slice(0, slash);
}

function suggestionFor(branch, duplicateGroupId) {
  if (branch.gitRelation === 'current') return '保留主线';
  if (branch.worktreePath) return '活跃工作区，先复核任务状态';
  if (duplicateGroupId) return '重复指针组，建议统一处置';
  if (branch.gitRelation === 'ancestor') return '可评估归档或清理';
  return '待确认集成、返工或归档';
}

function validateSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') return ['snapshot must be an object'];
  if (!snapshot.generatedAt) errors.push('generatedAt is required');
  if (!snapshot.mainBranch) errors.push('mainBranch is required');
  if (!Array.isArray(snapshot.branches) || snapshot.branches.length === 0) errors.push('branches must be non-empty');
  if (!snapshot.branches?.some((branch) => branch.branchName === snapshot.mainBranch && branch.gitRelation === 'current')) {
    errors.push('main branch must exist with current relation');
  }
  const names = new Set();
  for (const branch of snapshot.branches || []) {
    if (names.has(branch.branchName)) errors.push(`duplicate branch name: ${branch.branchName}`);
    names.add(branch.branchName);
  }
  return errors;
}

function buildSnapshot(input) {
  const worktreeByBranch = new Map(input.worktrees.filter((item) => item.branchName).map((item) => [item.branchName, item]));
  const duplicateGroups = buildDuplicateTipGroups(input.localRefs);
  const duplicateByBranch = new Map();
  for (const group of duplicateGroups) {
    for (const branchName of group.branches) duplicateByBranch.set(branchName, group.id);
  }
  const branches = input.localRefs.map((ref) => {
    const relation = input.relations.get(ref.branchName);
    const worktree = worktreeByBranch.get(ref.branchName);
    const branch = {
      ...ref,
      prefix: branchPrefix(ref.branchName),
      gitRelation: relation.gitRelation,
      ahead: relation.ahead,
      behind: relation.behind,
      worktreePath: worktree?.path || '',
      worktreeDirty: worktree ? input.dirtyByPath.get(worktree.path) || 'unknown' : '',
      duplicateTipGroup: duplicateByBranch.get(ref.branchName) || '',
    };
    return { ...branch, governanceSuggestion: suggestionFor(branch, branch.duplicateTipGroup) };
  }).sort((a, b) => a.branchName.localeCompare(b.branchName));

  const snapshot = {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    repoRoot: input.repoRoot,
    mainBranch: input.mainBranch,
    summary: {
      localBranchCount: branches.length,
      remoteRefCount: input.remoteRefs.length,
      worktreeCount: input.worktrees.length,
      ancestorCount: branches.filter((branch) => branch.gitRelation === 'ancestor').length,
      nonAncestorCount: branches.filter((branch) => branch.gitRelation === 'non_ancestor').length,
      duplicateTipGroupCount: duplicateGroups.length,
      warningCount: input.warnings.length,
    },
    branches,
    remoteRefs: input.remoteRefs,
    worktrees: input.worktrees,
    duplicateTipGroups: duplicateGroups,
    warnings: input.warnings,
  };
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid snapshot: ${errors.join('; ')}`);
  return snapshot;
}

function serializeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2).replace(/<\//g, '<\\/');
  return `window.WES_BRANCH_SNAPSHOT = ${json};\n`;
}

function writeSnapshotAtomic(targetPath, snapshot) {
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid snapshot: ${errors.join('; ')}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, serializeSnapshot(snapshot), 'utf8');
  fs.renameSync(tempPath, targetPath);
}

module.exports = {
  branchPrefix,
  buildDuplicateTipGroups,
  buildSnapshot,
  parseRefOutput,
  parseWorktreePorcelain,
  serializeSnapshot,
  suggestionFor,
  validateSnapshot,
  writeSnapshotAtomic,
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test scripts/branch-board.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit the pure library**

```bash
git add scripts/branch-board-lib.js scripts/branch-board.test.js
git commit -m "feat(WES Board): RP-045 · 建立分支快照事实模型"
```

---

### Task 3: Implement The Read-Only Generator And Atomic Snapshot

**Files:**
- Modify: `scripts/branch-board.test.js`
- Create: `scripts/generate-branch-board.js`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-board.config.json`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js`
- Modify: `package.json:5-34`

- [ ] **Step 1: Add failing real-repository and failure-protection tests**

Append to `scripts/branch-board.test.js`:

```js
const { execFileSync } = require('node:child_process');
const { collectSnapshot } = require('./generate-branch-board');

test('collectSnapshot contains exactly every local branch in the repository', () => {
  const projectRoot = path.join(__dirname, '..');
  const expected = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean).sort();
  const snapshot = collectSnapshot({
    projectRoot,
    mainBranch: 'codex/role-driven-ai-home-workbench',
    now: '2026-08-02T03:00:00.000Z',
  });
  assert.deepEqual(snapshot.branches.map((branch) => branch.branchName).sort(), expected);
});

test('collectSnapshot rejects a missing configured mainline', () => {
  assert.throws(() => collectSnapshot({
    projectRoot: path.join(__dirname, '..'),
    mainBranch: 'missing/mainline',
    now: '2026-08-02T03:00:00.000Z',
  }), /configured main branch does not exist/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test scripts/branch-board.test.js
```

Expected: FAIL because `generate-branch-board.js` does not exist.

- [ ] **Step 3: Create the explicit config**

Create `03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-board.config.json`:

```json
{
  "schemaVersion": 1,
  "mainBranch": "codex/role-driven-ai-home-workbench",
  "defaultRemote": "origin",
  "staleAfterDays": 30
}
```

- [ ] **Step 4: Implement the generator**

Create `scripts/generate-branch-board.js`:

```js
#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildSnapshot,
  parseRefOutput,
  parseWorktreePorcelain,
  writeSnapshotAtomic,
} = require('./branch-board-lib');

const PROJECT_ROOT = path.join(__dirname, '..');
const BOARD_DIR = path.join(PROJECT_ROOT, '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const CONFIG_PATH = path.join(BOARD_DIR, 'data', 'branch-board.config.json');
const OUTPUT_PATH = path.join(BOARD_DIR, 'data', 'branch-snapshot.js');
const REF_FORMAT = '%(refname:short)%00%(objectname)%00%(committerdate:iso8601-strict)%00%(authorname)%00%(subject)%00%(upstream:short)%00%(upstream:trackshort)';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function relationFor(projectRoot, mainBranch, branchName) {
  let gitRelation = 'non_ancestor';
  if (branchName === mainBranch) {
    gitRelation = 'current';
  } else {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', branchName, mainBranch], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      gitRelation = 'ancestor';
    } catch (error) {
      if (error.status !== 1) throw error;
    }
  }
  const counts = git(['rev-list', '--left-right', '--count', `${mainBranch}...${branchName}`], projectRoot)
    .trim().split(/\s+/).map(Number);
  return { gitRelation, behind: counts[0], ahead: counts[1] };
}

function worktreeDirtyState(worktreePath, warnings) {
  try {
    return git(['status', '--porcelain'], worktreePath).trim() ? 'dirty' : 'clean';
  } catch (error) {
    warnings.push(`Unable to read worktree status: ${worktreePath}`);
    return 'unknown';
  }
}

function collectSnapshot({ projectRoot, mainBranch, now = new Date().toISOString() }) {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/heads/${mainBranch}`], projectRoot);
  } catch {
    throw new Error(`Configured main branch does not exist: ${mainBranch}`);
  }
  const localRefs = parseRefOutput(git(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads'], projectRoot));
  const remoteRefs = parseRefOutput(git(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/remotes'], projectRoot));
  const worktrees = parseWorktreePorcelain(git(['worktree', 'list', '--porcelain'], projectRoot));
  const warnings = [];
  const relations = new Map(localRefs.map((ref) => [ref.branchName, relationFor(projectRoot, mainBranch, ref.branchName)]));
  const dirtyByPath = new Map(worktrees.map((worktree) => [worktree.path, worktreeDirtyState(worktree.path, warnings)]));
  return buildSnapshot({
    generatedAt: now,
    repoRoot: projectRoot,
    mainBranch,
    localRefs,
    remoteRefs,
    worktrees,
    relations,
    dirtyByPath,
    warnings,
  });
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const snapshot = collectSnapshot({ projectRoot: PROJECT_ROOT, mainBranch: config.mainBranch });
  writeSnapshotAtomic(OUTPUT_PATH, snapshot);
  console.log(JSON.stringify({
    output: path.relative(PROJECT_ROOT, OUTPUT_PATH),
    generatedAt: snapshot.generatedAt,
    ...snapshot.summary,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Branch board generation failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { collectSnapshot, main, relationFor, worktreeDirtyState };
```

- [ ] **Step 5: Add package commands**

Add to the root `package.json` scripts object:

```json
"board:branches": "node scripts/generate-branch-board.js",
"board:branches:check": "node scripts/generate-branch-board.js && node --test scripts/branch-board.test.js scripts/branch-board-page.test.js",
"test:board:branches": "node --test scripts/branch-board.test.js scripts/branch-board-page.test.js"
```

- [ ] **Step 6: Generate the first snapshot and verify GREEN**

Run:

```bash
npm run board:branches
node --test scripts/branch-board.test.js
node -e "require('fs').accessSync('03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js')"
```

Expected: generator prints non-zero branch/worktree counts; all tests pass; snapshot file exists.

- [ ] **Step 7: Commit generator and snapshot**

```bash
git add package.json scripts/generate-branch-board.js scripts/branch-board.test.js 03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-board.config.json 03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js
git commit -m "feat(WES Board): RP-045 · 自动生成 Git 分支快照"
```

---

### Task 4: Build The Static Branch Page And Safe Renderer

**Files:**
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/branches.html`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.css`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.js`
- Create: `scripts/branch-board-page.test.js`

- [ ] **Step 1: Write failing page contract tests**

Create `scripts/branch-board-page.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const BOARD = path.join(ROOT, '03_技术设计', '系统架构', 'WES-Agent-升级总看板');

test('branches page exposes semantic status, filters, topology and ledger', () => {
  const html = fs.readFileSync(path.join(BOARD, 'branches.html'), 'utf8');
  assert.match(html, /href="branches\.html"[^>]*class="active"|class="active"[^>]*href="branches\.html"/);
  assert.match(html, /id="branch-board-status"[^>]*role="status"/);
  assert.match(html, /id="branch-topology"/);
  assert.match(html, /id="branch-ledger-body"/);
  assert.match(html, /aria-label="筛选 Git 关系"/);
  assert.match(html, /data\/branch-snapshot\.js/);
  assert.match(html, /assets\/branch-topology\.js/);
});

test('renderer uses textContent for branch-owned strings and exports pure filters', () => {
  const source = fs.readFileSync(path.join(BOARD, 'assets', 'branch-topology.js'), 'utf8');
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*branch/);
  const renderer = require(path.join(BOARD, 'assets', 'branch-topology.js'));
  const rows = [
    { branchName: '<unsafe>', gitRelation: 'ancestor', prefix: 'other', worktreePath: '', governanceSuggestion: '可评估归档或清理' },
    { branchName: 'qoder/active', gitRelation: 'non_ancestor', prefix: 'qoder', worktreePath: '/repo/wt', governanceSuggestion: '活跃工作区，先复核任务状态' },
  ];
  assert.deepEqual(renderer.filterBranches(rows, { relation: 'non_ancestor', worktree: 'active', prefix: '', search: '' }), [rows[1]]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test scripts/branch-board-page.test.js
```

Expected: FAIL because page and renderer files do not exist.

- [ ] **Step 3: Create the semantic page skeleton**

Create `branches.html` using the existing board header/sidebar pattern. The required body skeleton is:

```html
<main>
  <div class="doc-h">
    <div class="wrap">
      <div class="crumb">Git Governance / Local Snapshot</div>
      <h1>Git 分支与 Worktree 拓扑</h1>
      <div class="meta">
        <span><b>事实源</b> local Git refs + worktree porcelain</span>
        <span><b>刷新</b> npm run board:branches</span>
        <span><b>边界</b> 只读生成，不执行 fetch / merge / delete</span>
      </div>
    </div>
  </div>
  <section><div class="wrap">
    <div id="branch-board-status" role="status" aria-live="polite">正在读取分支快照…</div>
    <div id="branch-kpis" class="branch-kpis" aria-label="分支快照指标"></div>
  </div></section>
  <section><div class="wrap">
    <div class="sec-head"><div class="num">01 / Operational Topology</div><h2>运营拓扑</h2></div>
    <div id="branch-topology" class="branch-topology"></div>
  </div></section>
  <section><div class="wrap">
    <div class="sec-head"><div class="num">02 / Complete Ledger</div><h2>完整分支台账</h2></div>
    <div class="branch-filters">
      <input id="branch-search" type="search" aria-label="搜索分支" placeholder="搜索分支、提交或作者" />
      <select id="branch-relation" aria-label="筛选 Git 关系"><option value="">全部关系</option><option value="current">主线</option><option value="ancestor">主线祖先</option><option value="non_ancestor">非祖先</option></select>
      <select id="branch-worktree" aria-label="筛选 Worktree"><option value="">全部 Worktree</option><option value="active">活跃 Worktree</option><option value="none">无 Worktree</option></select>
      <select id="branch-prefix" aria-label="筛选分支前缀"><option value="">全部前缀</option></select>
    </div>
    <div class="branch-table-scroll"><table><thead><tr><th>分支</th><th>HEAD</th><th>Git 关系</th><th>A/B</th><th>Worktree</th><th>最后提交</th><th>治理建议</th></tr></thead><tbody id="branch-ledger-body"></tbody></table></div>
  </div></section>
</main>
<script src="data/branch-snapshot.js"></script>
<script src="assets/branch-topology.js"></script>
```

The page must include an active navigation link:

```html
<a class="active" href="branches.html">分支拓扑</a>
```

- [ ] **Step 4: Implement a CommonJS/browser-safe renderer**

Create `assets/branch-topology.js` with a UMD wrapper. The public contract must be complete:

```js
(function init(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.WesBranchBoard = api;
    root.addEventListener('DOMContentLoaded', () => api.mount(root.document, root.WES_BRANCH_SNAPSHOT));
  }
})(typeof globalThis === 'object' ? globalThis : this, function factory() {
  function filterBranches(branches, filters) {
    const search = String(filters.search || '').trim().toLowerCase();
    return branches.filter((branch) => {
      if (filters.relation && branch.gitRelation !== filters.relation) return false;
      if (filters.worktree === 'active' && !branch.worktreePath) return false;
      if (filters.worktree === 'none' && branch.worktreePath) return false;
      if (filters.prefix && branch.prefix !== filters.prefix) return false;
      if (search && !`${branch.branchName} ${branch.subject} ${branch.author} ${branch.headShort}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function el(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderKpis(document, target, snapshot) {
    const values = [
      ['主线', snapshot.mainBranch],
      ['本地分支', String(snapshot.summary.localBranchCount)],
      ['Worktree', String(snapshot.summary.worktreeCount)],
      ['非祖先', String(snapshot.summary.nonAncestorCount)],
      ['主线祖先', String(snapshot.summary.ancestorCount)],
    ];
    target.replaceChildren(...values.map(([label, value]) => {
      const card = el(document, 'div', 'branch-kpi');
      card.append(el(document, 'span', 'branch-kpi-label', label), el(document, 'strong', '', value));
      return card;
    }));
  }

  function renderTopology(document, target, snapshot) {
    const main = snapshot.branches.find((branch) => branch.gitRelation === 'current');
    const active = snapshot.branches.filter((branch) => branch.worktreePath && branch.gitRelation !== 'current');
    const nonAncestors = snapshot.branches.filter((branch) => branch.gitRelation === 'non_ancestor' && !branch.worktreePath);
    const ancestors = snapshot.branches.filter((branch) => branch.gitRelation === 'ancestor' && !branch.worktreePath);
    const root = el(document, 'div', 'branch-topology-grid');
    const mainNode = el(document, 'article', 'branch-node branch-node-main');
    mainNode.append(el(document, 'span', 'branch-node-label', 'MAINLINE'), el(document, 'strong', '', main.branchName), el(document, 'code', '', main.headShort));
    const groups = el(document, 'div', 'branch-groups');
    for (const [label, rows, kind] of [
      ['活跃 Worktree', active, 'active'],
      ['非祖先分支', nonAncestors, 'warning'],
      ['主线祖先 / 历史', ancestors, 'muted'],
    ]) {
      const details = document.createElement('details');
      details.className = `branch-group branch-group-${kind}`;
      if (kind === 'active') details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `${label} · ${rows.length}`;
      details.append(summary);
      for (const branch of rows) details.append(el(document, 'div', 'branch-group-row', `${branch.branchName} · ${branch.headShort}`));
      groups.append(details);
    }
    root.append(mainNode, el(document, 'div', 'branch-connector', '→'), groups);
    target.replaceChildren(root);
  }

  function renderLedger(document, target, branches) {
    target.replaceChildren(...branches.map((branch) => {
      const row = document.createElement('tr');
      const values = [
        branch.branchName,
        branch.headShort,
        branch.gitRelation,
        `${branch.ahead}/${branch.behind}`,
        branch.worktreePath || '—',
        `${branch.committerDate} · ${branch.subject}`,
        branch.governanceSuggestion,
      ];
      for (const value of values) row.append(el(document, 'td', '', value));
      return row;
    }));
  }

  function mount(document, snapshot) {
    const status = document.getElementById('branch-board-status');
    if (!snapshot || !Array.isArray(snapshot.branches) || snapshot.branches.length === 0) {
      status.setAttribute('role', 'alert');
      status.textContent = '分支快照不可用。请在项目根目录运行 npm run board:branches。';
      return;
    }
    const filters = { relation: '', worktree: '', prefix: '', search: '' };
    const ledger = document.getElementById('branch-ledger-body');
    const rerender = () => renderLedger(document, ledger, filterBranches(snapshot.branches, filters));
    renderKpis(document, document.getElementById('branch-kpis'), snapshot);
    renderTopology(document, document.getElementById('branch-topology'), snapshot);
    const prefix = document.getElementById('branch-prefix');
    for (const value of [...new Set(snapshot.branches.map((branch) => branch.prefix))].sort()) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; prefix.append(option);
    }
    for (const [id, key, event] of [['branch-search', 'search', 'input'], ['branch-relation', 'relation', 'change'], ['branch-worktree', 'worktree', 'change'], ['branch-prefix', 'prefix', 'change']]) {
      document.getElementById(id).addEventListener(event, (inputEvent) => { filters[key] = inputEvent.target.value; rerender(); });
    }
    rerender();
    status.textContent = `快照生成于 ${snapshot.generatedAt}；本地分支 ${snapshot.summary.localBranchCount} 条，警告 ${snapshot.summary.warningCount} 条。`;
  }

  return { filterBranches, mount, renderKpis, renderLedger, renderTopology };
});
```

- [ ] **Step 5: Add responsive CSS**

Create `assets/branch-topology.css`. It must include these behavior-defining rules:

```css
.branch-kpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
.branch-kpi { border:1px solid var(--line); background:var(--panel); padding:14px; min-width:0; }
.branch-kpi-label { display:block; color:var(--ink-3); font:700 10px var(--font-mono); text-transform:uppercase; }
.branch-kpi strong { display:block; margin-top:6px; overflow-wrap:anywhere; }
.branch-topology-grid { display:grid; grid-template-columns:minmax(240px,1fr) 48px minmax(0,2fr); align-items:center; gap:12px; }
.branch-node,.branch-group { border:1px solid var(--line); background:var(--panel); padding:14px; }
.branch-node-main { border-width:2px; border-color:var(--brand); }
.branch-groups { display:grid; gap:10px; }
.branch-group-row { border-top:1px solid var(--line); padding:8px 0; overflow-wrap:anywhere; }
.branch-filters { display:grid; grid-template-columns:2fr repeat(3,1fr); gap:10px; margin-bottom:12px; }
.branch-table-scroll { overflow:auto; border:1px solid var(--line); }
.branch-table-scroll table { min-width:1080px; margin:0; }
@media (max-width:760px) {
  .branch-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .branch-topology-grid { grid-template-columns:1fr; }
  .branch-connector { transform:rotate(90deg); justify-self:center; }
  .branch-filters { grid-template-columns:1fr; }
}
```

- [ ] **Step 6: Run page tests and verify GREEN**

Run:

```bash
node --test scripts/branch-board-page.test.js
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit the page**

```bash
git add scripts/branch-board-page.test.js 03_技术设计/系统架构/WES-Agent-升级总看板/branches.html 03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.css 03_技术设计/系统架构/WES-Agent-升级总看板/assets/branch-topology.js
git commit -m "feat(WES Board): RP-045 · 展示运营拓扑与完整分支台账"
```

---

### Task 5: Synchronize Navigation And Board Build Without Rewriting Dirty Pages

**Files:**
- Create: `scripts/sync-board-branch-nav.js`
- Modify: `scripts/board-build.js:17-32,88-116`
- Modify: `scripts/board-sidebar-transform.js:17-36`
- Modify: `scripts/board-consistency-check.js:18-34`
- Modify: `scripts/board-work-items-lib.js:108-128`
- Modify: `scripts/board-work-items.test.js`

- [ ] **Step 1: Write failing navigation assertions**

Add to `scripts/board-work-items.test.js`:

```js
test('generated work item pages link to the branch topology board', () => {
  assert.match(renderIssuesPage(sampleRegistry), /href="branches\.html">分支拓扑<\/a>/);
  assert.match(renderDefectsPage(sampleRegistry), /href="branches\.html">分支拓扑<\/a>/);
});
```

Add a test to `scripts/branch-board-page.test.js` that executes the nav synchronizer against a temporary fixture:

```js
const os = require('node:os');
const { syncDirectory } = require('./sync-board-branch-nav');

test('navigation synchronizer inserts one branch link and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-board-nav-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, '<nav class="navlinks"><a href="collaboration-protocol.html">协作协议</a><a href="requirements.html">需求池</a></nav>');
  syncDirectory(dir);
  syncDirectory(dir);
  const html = fs.readFileSync(file, 'utf8');
  assert.equal((html.match(/href="branches\.html"/g) || []).length, 1);
  assert.match(html, /协作协议<\/a><a href="branches\.html">分支拓扑<\/a>/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test scripts/board-work-items.test.js scripts/branch-board-page.test.js
```

Expected: FAIL because the generated nav lacks `branches.html` and the synchronizer does not exist.

- [ ] **Step 3: Implement the idempotent navigation synchronizer**

Create `scripts/sync-board-branch-nav.js`:

```js
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const BOARD_DIR = path.join(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const BRANCH_LINK = '<a href="branches.html">分支拓扑</a>';

function syncHtml(html, fileName) {
  if (fileName === 'branches.html' || html.includes('href="branches.html"')) return html;
  const anchor = '<a href="collaboration-protocol.html">协作协议</a>';
  const activeAnchor = '<a class="active" href="collaboration-protocol.html">协作协议</a>';
  if (html.includes(activeAnchor)) return html.replace(activeAnchor, `${activeAnchor}\n        ${BRANCH_LINK}`);
  if (html.includes(anchor)) return html.replace(anchor, `${anchor}\n        ${BRANCH_LINK}`);
  return html;
}

function syncDirectory(boardDir = BOARD_DIR) {
  const changed = [];
  for (const fileName of fs.readdirSync(boardDir).filter((name) => name.endsWith('.html'))) {
    const filePath = path.join(boardDir, fileName);
    const before = fs.readFileSync(filePath, 'utf8');
    const after = syncHtml(before, fileName);
    if (after !== before) {
      fs.writeFileSync(filePath, after, 'utf8');
      changed.push(filePath);
    }
  }
  return changed;
}

if (require.main === module) {
  const changed = syncDirectory();
  console.log(`Branch navigation synchronized in ${changed.length} files.`);
}

module.exports = { syncDirectory, syncHtml };
```

- [ ] **Step 4: Add `branches.html` to every central navigation owner**

Insert this item immediately after collaboration protocol in:

- `scripts/board-build.js` `NAV_ITEMS`
- `scripts/board-sidebar-transform.js` `NAV_ITEMS`
- `scripts/board-work-items-lib.js` `renderNav()` items

```js
{ label: '分支拓扑', href: 'branches.html' }
```

For `board-work-items-lib.js`, use its tuple format:

```js
['branches.html', '分支拓扑']
```

Add `branches.html` to `HTML_FILES` in `scripts/board-consistency-check.js`.

- [ ] **Step 5: Make board build copy branch assets and data**

After fonts are copied in `scripts/board-build.js`, copy these files while preserving subdirectories:

```js
const extraFiles = [
  ['assets/branch-topology.css', 'assets/branch-topology.css'],
  ['assets/branch-topology.js', 'assets/branch-topology.js'],
  ['data/branch-snapshot.js', 'data/branch-snapshot.js'],
];
for (const [source, target] of extraFiles) {
  const targetPath = path.join(DIST_DIR, target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(path.join(BOARD_DIR, source), targetPath);
}
```

- [ ] **Step 6: Run navigation tests and verify GREEN**

Run:

```bash
node --test scripts/board-work-items.test.js scripts/branch-board-page.test.js
node scripts/board-build.js
test -f '03_技术设计/系统架构/WES-Agent-升级总看板/dist/branches.html'
test -f '03_技术设计/系统架构/WES-Agent-升级总看板/dist/data/branch-snapshot.js'
```

Expected: tests pass; dist contains page, renderer, stylesheet and snapshot.

- [ ] **Step 7: Commit navigation owners and build support**

```bash
git add scripts/sync-board-branch-nav.js scripts/board-build.js scripts/board-sidebar-transform.js scripts/board-consistency-check.js scripts/board-work-items-lib.js scripts/board-work-items.test.js scripts/branch-board-page.test.js
git commit -m "feat(WES Board): RP-045 · 接入分支拓扑导航与构建"
```

Do not run the synchronizer against the dirty main checkout until Task 7.

---

### Task 6: Record Issue-First Governance And RP-045 Evidence

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/work-items/board-work-items.json`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json`
- Test: `scripts/board-work-items.test.js`
- Test: `scripts/board-event.test.js`

- [ ] **Step 1: Add the source issue to the registry**

Set registry `updatedAt` to `2026-08-02` and append:

```json
{
  "id": "ISS-2026-08-02-001",
  "date": "2026-08-02",
  "title": "项目看板缺少主分支与子分支拓扑",
  "source": "user_requirement",
  "rawFeedback": "把 WES 当前仓库所有分支情况反馈到项目看板，通过图形和分支形式表达主分支与其他子分支，并由脚本自动刷新。",
  "evidence": [
    "docs/superpowers/specs/2026-08-02-wes-branch-topology-board-design.md",
    "2026-08-02 user decision: scope=WES only, refresh=script, layout=operational topology + complete ledger"
  ],
  "triageStatus": "converted",
  "disposition": {
    "type": "requirement",
    "ref": "RP-045"
  },
  "priority": "P1",
  "next": "按已确认规格实施自动 Git 快照、branches.html、完整分支台账和双视口验收。"
}
```

- [ ] **Step 2: Create the structured board event**

Create `events/2026-08-02-rp-045-branch-topology.json` with valid board-event fields. Use this factual content:

```json
{
  "id": "BE-2026-08-02-rp-045-branch-topology",
  "date": "2026-08-02",
  "type": "implementation",
  "scope": "RP-045 WES 分支拓扑与 Worktree 看板",
  "summary": "新增只读 Git 分支快照生成器、运营拓扑、完整分支台账和分支导航；Git 事实与治理建议分离，不自动执行 fetch、merge、delete 或 worktree cleanup。",
  "status": "已实施 / 待验证回填",
  "pages": ["plan", "testing", "monitoring", "changes", "sources"],
  "evidence": [
    { "kind": "spec", "ref": "docs/superpowers/specs/2026-08-02-wes-branch-topology-board-design.md", "summary": "用户确认的 B 方案与自动刷新契约。" },
    { "kind": "file", "ref": "03_技术设计/系统架构/WES-Agent-升级总看板/branches.html", "summary": "分支拓扑和完整台账页面。" },
    { "kind": "command", "ref": "npm run board:branches:check", "result": "pending", "summary": "生成器、快照和页面契约验证。" }
  ],
  "next": "完成真实仓库集合验证、board build、一致性检查、1440px/760px和file://浏览器验收后更新结果。",
  "board": {
    "change": { "stage": "RP-045 Branch Topology Board", "result": "已实施 / 待验证回填" },
    "testing": [
      { "command": "npm run board:branches:check", "result": "pending", "summary": "待执行。" }
    ]
  }
}
```

- [ ] **Step 3: Validate issue registry and event**

Run:

```bash
node --test scripts/board-work-items.test.js scripts/board-event.test.js
node scripts/board-event-check.js '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json'
```

Expected: both test files pass; event checker exits 0.

- [ ] **Step 4: Commit governance source records**

```bash
git add 03_技术设计/系统架构/WES-Agent-升级总看板/work-items/board-work-items.json 03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json
git commit -m "docs(WES Board): RP-045 · 登记分支拓扑需求与证据"
```

---

### Task 7: Integrate Core Commit And Patch The Dirty Board Precisely

**Files:**
- Modify exactly: all current source board HTML navigation blocks
- Modify exactly: `issues.html`, `requirements.html`, `index.html`, `plan.html`, `monitoring.html`, `changes.html`, `sources.html`

- [ ] **Step 1: Verify the implementation worktree is clean and tests pass**

Run in the feature worktree:

```bash
git status --short --branch
npm run board:branches:check
node --test scripts/board-event.test.js scripts/board-work-items.test.js
node scripts/board-build.js
```

Expected: worktree clean; all tests pass; build exits 0.

- [ ] **Step 2: Integrate the clean core branch into the mainline**

Return to `/Users/kevin/AI/Workload-evaluation-system`. Reconfirm target paths do not overlap unrelated dirty files except the explicitly planned board HTML. Integrate using a strategy that preserves existing dirty changes; do not use reset, restore or checkout on dirty files.

Expected: core new files, scripts, config, snapshot, registry and event are on `codex/role-driven-ai-home-workbench`; user dirty changes remain.

- [ ] **Step 3: Run the idempotent nav synchronizer against the actual dirty checkout**

Run:

```bash
node scripts/sync-board-branch-nav.js
node scripts/sync-board-branch-nav.js
rg -L 'href="branches.html"' 03_技术设计/系统架构/WES-Agent-升级总看板/*.html
```

Expected: first run reports changed files; second run reports 0; `rg -L` prints nothing.

- [ ] **Step 4: Append visible Issue and Requirement records with exact patches**

Append this issue row to `issues.html` without regenerating the whole file:

```html
<tr>
  <td class="mono">ISS-2026-08-02-001</td><td>2026-08-02</td><td>项目看板缺少主分支与子分支拓扑</td><td>user_requirement</td>
  <td>把 WES 当前仓库所有分支情况反馈到项目看板，通过图形和分支形式表达主分支与其他子分支，并由脚本自动刷新。</td>
  <td><code class="inline">RP-045</code> <code class="inline">2026-08-02-wes-branch-topology-board-design.md</code></td>
  <td><span class="status run"><span class="dot"></span>converted</span></td><td>转需求 · RP-045</td><td>按已确认规格实施并验证。</td>
</tr>
```

Append a compact `RP-045` analysis section to `requirements.html` containing:

```html
<h2>RP-045 · WES 分支拓扑与 Worktree 看板</h2>
<p>来源 <code class="inline">ISS-2026-08-02-001</code>。范围仅覆盖当前 WES 仓库；以只读 Git refs/worktree 为事实源，自动生成运营拓扑和完整台账。</p>
<div class="callout"><div><b>验收口径</b>全部本地分支与 Git 集合一致；主线、ancestor/non-ancestor、worktree、重复指针正确；1440px/760px、键盘和 file:// 可用；不提供自动删除、合并或远端同步。</div></div>
```

- [ ] **Step 5: Add exact summary entries to the remaining board modules**

Use the existing card/row style in each dirty file and insert only the following RP-045-owned blocks. The copy deliberately avoids hard-coded live counts on pages that do not load `branch-snapshot.js`; the linked topology page is the single current-count owner.

`index.html` resource card:

```html
<a class="card" href="branches.html" data-board-event-id="BE-2026-08-02-rp-045-branch-topology:index">
  <span class="pill brand">Git Governance</span>
  <h3>分支拓扑与 Worktree</h3>
  <p>查看自动生成的主线、子分支关系、ahead/behind、活跃 worktree、重复指针组和完整分支台账。</p>
</a>
```

`plan.html` status row inside the existing RP table:

```html
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:plan">
  <td class="mono">RP-045</td>
  <td>WES 分支拓扑与 Worktree 看板</td>
  <td><span class="status run"><span class="dot"></span>实施验证中</span></td>
  <td>Git 集合精确一致；主线/ancestor/non-ancestor/worktree/重复指针正确；1440px、760px、键盘与 file:// 通过；不执行自动删除、合并或远端同步。</td>
</tr>
```

`monitoring.html` verification row; after Task 8, replace the status copy with the actual pass counts but retain the event id:

```html
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:monitoring">
  <td class="mono">npm run board:branches:check</td>
  <td><span class="status run"><span class="dot"></span>待最终验证</span></td>
  <td>验证本地分支集合、关系分类、worktree、重复指针、静态页面契约、构建复制和导航一致性；实时数量以 <a href="branches.html">分支拓扑</a> 自动快照为准。</td>
</tr>
```

`changes.html` timeline row:

```html
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:changes">
  <td>2026-08-02</td>
  <td class="mono">RP-045</td>
  <td>新增只读 Git 分支快照生成器、运营拓扑、完整台账、筛选搜索、worktree/重复指针提示与看板导航；最终命令证据和人工浏览器验收回填到 monitoring 与事件记录。</td>
</tr>
```

`sources.html` source rows:

```html
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:sources-page">
  <td>分支拓扑页面</td><td><a href="branches.html">branches.html</a></td><td>自动快照的可视化与完整分支台账。</td>
</tr>
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:sources-generator">
  <td>快照生成器</td><td><code class="inline">scripts/generate-branch-board.js</code></td><td>只读 Git 采集、校验和原子写入。</td>
</tr>
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:sources-spec">
  <td>设计规格</td><td><code class="inline">docs/superpowers/specs/2026-08-02-wes-branch-topology-board-design.md</code></td><td>范围、事实模型、交互与验收口径。</td>
</tr>
<tr data-board-event-id="BE-2026-08-02-rp-045-branch-topology:sources-plan">
  <td>实施计划</td><td><code class="inline">docs/superpowers/plans/2026-08-02-wes-branch-topology-board.md</code></td><td>TDD、集成保护与验证步骤。</td>
</tr>
```

Every block must include `data-board-event-id="BE-2026-08-02-rp-045-branch-topology:<page>"` where the surrounding element supports data attributes.

- [ ] **Step 6: Stage only RP-045 hunks**

Before staging, inspect:

```bash
git diff -- 03_技术设计/系统架构/WES-Agent-升级总看板
git diff --check
```

Stage new RP-045 files normally. For pre-existing dirty HTML, stage only the exact navigation and RP-045 hunks; do not stage unrelated changes. Confirm with:

```bash
git diff --cached --name-only
git diff --cached --check
git diff --cached -- 03_技术设计/系统架构/WES-Agent-升级总看板
```

Expected: cached diff contains only `branches.html`, branch assets/data, explicit branch nav additions and RP-045 records. Unrelated dirty hunks remain unstaged.

- [ ] **Step 7: Commit board integration**

```bash
git commit -m "feat(WES Board): RP-045 · 接入分支拓扑治理看板"
```

---

### Task 8: Full Verification, Browser Acceptance And Final Event Update

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json`
- Verify: all RP-045 implementation files

- [ ] **Step 1: Run the complete automated verification**

Run from the main checkout:

```bash
npm run board:branches
npm run test:board:branches
node --test scripts/board-event.test.js scripts/board-work-items.test.js
node scripts/board-build.js
node scripts/board-consistency-check.js
git diff --check
```

Expected:

- branch snapshot generation exits 0;
- branch and page tests pass;
- board event/work-item tests pass;
- board build exits 0 and copies `branches.html`, CSS, JS and data;
- consistency checker exits 0 or reports only explicitly documented pre-existing warnings;
- no RP-045 whitespace errors.

- [ ] **Step 2: Prove branch set equality and current classification**

Run:

```bash
node --test --test-name-pattern='collectSnapshot contains exactly every local branch' scripts/branch-board.test.js
node -e 'const fs=require("node:fs");const vm=require("node:vm");const sandbox={window:{}};vm.runInNewContext(fs.readFileSync("03_技术设计/系统架构/WES-Agent-升级总看板/data/branch-snapshot.js","utf8"),sandbox);console.log(JSON.stringify(sandbox.window.WES_BRANCH_SNAPSHOT.summary,null,2));'
```

Expected: exits 0 and prints live summary. Do not require historical `36/20/16/4` if the repository changed; require exact equality with current Git.

- [ ] **Step 3: Browser verify 1440px**

Open source `branches.html` in the current browser context. Verify:

- mainline name and HEAD visible;
- KPI counts match snapshot;
- active worktree group expanded;
- non-ancestor and ancestor/history groups toggle using mouse and Enter/Space;
- table shows every branch;
- search and each filter update the visible row count;
- browser console contains no errors.

- [ ] **Step 4: Browser verify 760px and file URL**

At 760px verify:

- no page-level horizontal overflow;
- KPI cards collapse to two/one columns;
- topology becomes vertical;
- table has local horizontal scrolling and its final column remains reachable;
- filters remain accessible by keyboard.

Open the page using `file://` and confirm the generated `branch-snapshot.js` loads without fetch/CORS errors.

- [ ] **Step 5: Update the event with real verification results**

Replace pending command evidence in `2026-08-02-rp-045-branch-topology.json` with the actual counts and results. Set status to `已实施验证 / 待用户验收` unless the user has personally accepted the page. Do not mark user acceptance from automated evidence.

- [ ] **Step 6: Validate and commit final evidence**

Run:

```bash
node scripts/board-event-check.js '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json'
git diff --check
git status --short --branch
```

Then commit only the event/evidence updates:

```bash
git add 03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-08-02-rp-045-branch-topology.json
git commit -m "docs(WES Board): RP-045 · 回填分支拓扑验证证据"
```

- [ ] **Step 7: Final handoff**

Report:

- current mainline HEAD;
- generated branch/worktree counts;
- automated command results;
- 1440px/760px/file:// evidence;
- exact dirty files intentionally preserved;
- whether the implementation worktree/branch was retained or cleaned;
- board modules updated and any user acceptance still pending.

Do not automatically start another UI or governance task.
