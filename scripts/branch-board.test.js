const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  buildDuplicateTipGroups,
  buildSnapshot,
  parseRefOutput,
  parseWorktreePorcelain,
  serializeSnapshot,
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

function buildValidSnapshot(subject = 'mainline') {
  return buildSnapshot({
    generatedAt: '2026-08-02T03:00:00.000Z',
    repoRoot: '/repo',
    mainBranch: 'codex/role-driven-ai-home-workbench',
    localRefs: [{
      branchName: 'codex/role-driven-ai-home-workbench',
      headFull: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headShort: 'aaaaaaa',
      committerDate: '2026-08-02T11:00:00+08:00',
      author: 'kevin',
      subject,
      upstream: '',
      upstreamTrack: '',
    }],
    remoteRefs: [],
    worktrees: [],
    relations: new Map([[
      'codex/role-driven-ai-home-workbench',
      { gitRelation: 'current', ahead: 0, behind: 0 },
    ]]),
    dirtyByPath: new Map(),
    warnings: [],
  });
}

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

test('parseWorktreePorcelain supplies stable flags for attached and detached worktrees', () => {
  const worktrees = parseWorktreePorcelain([
    WORKTREE_OUTPUT,
    'worktree /repo/.claude/worktrees/detached',
    'HEAD dddddddddddddddddddddddddddddddddddddddd',
    'detached',
    'locked maintenance',
    'prunable stale metadata',
    '',
  ].join('\n'));

  assert.equal(worktrees[0].locked, false);
  assert.equal(worktrees[0].prunable, false);
  assert.equal(worktrees[2].branchName, '');
  assert.equal(worktrees[2].detached, true);
  assert.equal(worktrees[2].locked, 'maintenance');
  assert.equal(worktrees[2].prunable, 'stale metadata');
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

test('validateSnapshot requires the configured main branch to be current', () => {
  const errors = validateSnapshot({
    generatedAt: '2026-08-02T03:00:00.000Z',
    mainBranch: 'codex/role-driven-ai-home-workbench',
    branches: [{
      branchName: 'codex/role-driven-ai-home-workbench',
      gitRelation: 'non_ancestor',
    }],
  });

  assert.ok(errors.some((error) => /current main branch/i.test(error)));
});

test('validateSnapshot returns errors for malformed incomplete snapshots without throwing', () => {
  let errors;
  assert.doesNotThrow(() => {
    errors = validateSnapshot({
      schemaVersion: 2,
      generatedAt: '',
      repoRoot: 42,
      mainBranch: '',
      summary: null,
      branches: [null, { branchName: '', gitRelation: 'unknown' }],
      remoteRefs: null,
      worktrees: {},
      duplicateTipGroups: 'invalid',
      warnings: undefined,
    });
  });
  assert.ok(errors.some((error) => /schemaVersion/i.test(error)));
  assert.ok(errors.some((error) => /summary/i.test(error)));
  assert.ok(errors.some((error) => /remoteRefs/i.test(error)));
  assert.ok(errors.some((error) => /branch/i.test(error)));
});

test('validateSnapshot requires complete branch records and exactly one current branch', () => {
  const requiredNonEmptyStrings = [
    'branchName',
    'headFull',
    'headShort',
    'prefix',
    'governanceSuggestion',
  ];
  for (const field of requiredNonEmptyStrings) {
    const snapshot = buildValidSnapshot();
    snapshot.branches[0][field] = '';
    assert.ok(validateSnapshot(snapshot).some((error) => error.includes(field)));
  }

  const stringFields = [
    'committerDate',
    'author',
    'subject',
    'upstream',
    'upstreamTrack',
    'worktreePath',
    'worktreeDirty',
    'duplicateTipGroup',
  ];
  for (const field of stringFields) {
    const snapshot = buildValidSnapshot();
    snapshot.branches[0][field] = null;
    assert.ok(validateSnapshot(snapshot).some((error) => error.includes(field)));
  }

  const malformedCounts = buildValidSnapshot();
  malformedCounts.branches[0].ahead = -1;
  malformedCounts.branches[0].behind = Number.NaN;
  assert.ok(validateSnapshot(malformedCounts).some((error) => /ahead/.test(error)));
  assert.ok(validateSnapshot(malformedCounts).some((error) => /behind/.test(error)));

  const multipleCurrent = buildValidSnapshot();
  multipleCurrent.branches.push({
    ...multipleCurrent.branches[0],
    branchName: 'qoder/second-current',
    headFull: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    headShort: 'bbbbbbb',
  });
  multipleCurrent.summary.localBranchCount = 2;
  assert.ok(validateSnapshot(multipleCurrent).some((error) => /exactly one current/i.test(error)));
});

test('writeSnapshotAtomic does not replace a valid snapshot when validation fails', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'branch-snapshot.js');
  fs.writeFileSync(target, 'window.WES_BRANCH_SNAPSHOT = {"sentinel":true};\n');
  assert.throws(() => writeSnapshotAtomic(target, { branches: [] }), /invalid snapshot/i);
  assert.match(fs.readFileSync(target, 'utf8'), /sentinel/);
});

test('serializeSnapshot and writeSnapshotAtomic safely round-trip branch-owned script-like data', (t) => {
  const subject = '</script><script>window.injected = true</script>';
  const snapshot = buildValidSnapshot(subject);
  const source = serializeSnapshot(snapshot);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'branch-snapshot.js');
  fs.writeFileSync(target, 'window.WES_BRANCH_SNAPSHOT = {"sentinel":true};\n');

  assert.doesNotMatch(source, /<\/script/i);
  writeSnapshotAtomic(target, snapshot);
  const written = fs.readFileSync(target, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(written, sandbox);

  assert.doesNotMatch(written, /sentinel/);
  assert.equal(sandbox.window.WES_BRANCH_SNAPSHOT.branches[0].subject, subject);
  assert.equal(sandbox.window.injected, undefined);
  assert.deepEqual(
    fs.readdirSync(dir).filter((entry) => entry.startsWith(`${path.basename(target)}.tmp-`)),
    [],
  );
});
