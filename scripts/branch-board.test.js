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

const { execFileSync } = require('node:child_process');
const {
  collectSnapshot,
  loadConfig,
  main,
  parseRemoteRefOutput,
  relationFor,
  separateActiveWorktrees,
  worktreeDirtyState,
} = require('./generate-branch-board');

test('collectSnapshot contains exactly every local branch in the repository', () => {
  const projectRoot = path.join(__dirname, '..');
  const expected = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean).sort();
  const currentMain = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  const snapshot = collectSnapshot({
    projectRoot,
    mainBranch: currentMain,
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

function gitIn(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createGitFixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-git-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  gitIn(projectRoot, ['init', '--initial-branch=main']);
  gitIn(projectRoot, ['config', 'user.email', 'test@example.com']);
  gitIn(projectRoot, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(projectRoot, 'initial.txt'), 'initial\n');
  gitIn(projectRoot, ['add', 'initial.txt']);
  gitIn(projectRoot, ['commit', '-m', 'initial']);
  return projectRoot;
}

test('parseRemoteRefOutput preserves symbolic remote HEAD identity and target', () => {
  const refs = parseRemoteRefOutput([
    ['origin/HEAD', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-02T11:00:00+08:00', 'kevin', 'mainline', '', '', 'origin/main'].join('\0'),
  ].join('\n'));

  assert.deepEqual(refs[0], {
    branchName: 'origin/HEAD',
    headFull: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headShort: 'aaaaaaa',
    committerDate: '2026-08-02T11:00:00+08:00',
    author: 'kevin',
    subject: 'mainline',
    upstream: '',
    upstreamTrack: '',
    refKind: 'remote_tracking',
    symbolicTarget: 'origin/main',
    isSymbolic: true,
  });
});

test('separateActiveWorktrees excludes prunable metadata and records its path as a warning', () => {
  const warnings = [];
  const active = separateActiveWorktrees([
    { path: '/repo/active', branchName: 'main', prunable: false },
    { path: '/repo/prunable', branchName: 'old', prunable: 'stale metadata' },
  ], warnings);

  assert.deepEqual(active, [{ path: '/repo/active', branchName: 'main', prunable: false }]);
  assert.deepEqual(warnings, ['Prunable worktree metadata excluded from active state: /repo/prunable']);
});

test('relationFor reports ancestor and non-ancestor ahead/behind directions and rethrows invalid refs', (t) => {
  const projectRoot = createGitFixture(t);
  gitIn(projectRoot, ['branch', 'ancestor']);
  fs.writeFileSync(path.join(projectRoot, 'main.txt'), 'main\n');
  gitIn(projectRoot, ['add', 'main.txt']);
  gitIn(projectRoot, ['commit', '-m', 'main advance']);
  gitIn(projectRoot, ['branch', 'feature']);
  gitIn(projectRoot, ['checkout', 'feature']);
  fs.writeFileSync(path.join(projectRoot, 'feature.txt'), 'feature\n');
  gitIn(projectRoot, ['add', 'feature.txt']);
  gitIn(projectRoot, ['commit', '-m', 'feature advance']);
  gitIn(projectRoot, ['checkout', 'main']);

  assert.deepEqual(relationFor(projectRoot, 'main', 'ancestor'), {
    gitRelation: 'ancestor', behind: 1, ahead: 0,
  });
  assert.deepEqual(relationFor(projectRoot, 'main', 'feature'), {
    gitRelation: 'non_ancestor', behind: 0, ahead: 1,
  });
  assert.throws(() => relationFor(projectRoot, 'main', 'missing/ref'), /not a valid object name|unknown revision|ambiguous argument/i);
});

test('worktreeDirtyState records an unknown missing worktree path', () => {
  const warnings = [];
  assert.equal(worktreeDirtyState('/definitely/missing/wes-worktree', warnings), 'unknown');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Unable to determine worktree state/);
});

test('collectSnapshot is stable for a fixed observation time and carries provenance', (t) => {
  const projectRoot = createGitFixture(t);
  const options = {
    projectRoot,
    mainBranch: 'main',
    defaultRemote: 'origin',
    staleAfterDays: 30,
    now: '2026-08-02T03:00:00.000Z',
  };
  const first = collectSnapshot(options);
  const second = collectSnapshot(options);

  assert.deepEqual(second, first);
  assert.deepEqual(first.governance, { defaultRemote: 'origin', staleAfterDays: 30 });
  assert.equal(first.provenance.semantics, 'as_of_generation');
  assert.equal(typeof first.provenance.sourceCheckoutBranch, 'string');
  assert.match(first.provenance.sourceCheckoutHead, /^[0-9a-f]{40}$/);
  assert.match(first.provenance.configuredMainlineHead, /^[0-9a-f]{40}$/);
  assert.match(first.provenance.observationNote, /precede the commit/i);
});

test('collectSnapshot retains a symbolic remote HEAD and excludes prunable worktree metadata', (t) => {
  const projectRoot = createGitFixture(t);
  gitIn(projectRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  gitIn(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  const snapshot = collectSnapshot({ projectRoot, mainBranch: 'main', now: '2026-08-02T03:00:00.000Z' });
  const symbolic = snapshot.remoteRefs.find((ref) => ref.branchName === 'origin/HEAD');

  assert.equal(symbolic.symbolicTarget, 'origin/main');
  assert.equal(symbolic.isSymbolic, true);
});

test('loadConfig validates every required branch board setting', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'branch-board.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1, mainBranch: 'main', defaultRemote: 'origin', staleAfterDays: 30,
  }));
  assert.deepEqual(loadConfig(configPath), {
    schemaVersion: 1, mainBranch: 'main', defaultRemote: 'origin', staleAfterDays: 30,
  });

  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 2, mainBranch: 'main', defaultRemote: 'origin', staleAfterDays: 30 }));
  assert.throws(() => loadConfig(configPath), /schemaVersion/i);
  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, mainBranch: '', defaultRemote: 'origin', staleAfterDays: 30 }));
  assert.throws(() => loadConfig(configPath), /mainBranch/i);
  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, mainBranch: 'main', defaultRemote: '', staleAfterDays: 30 }));
  assert.throws(() => loadConfig(configPath), /defaultRemote/i);
  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, mainBranch: 'main', defaultRemote: 'origin', staleAfterDays: -1 }));
  assert.throws(() => loadConfig(configPath), /staleAfterDays/i);
});

test('main check-only validates without replacing an existing snapshot', (t) => {
  const projectRoot = createGitFixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-output-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'branch-board.config.json');
  const outputPath = path.join(dir, 'branch-snapshot.js');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1, mainBranch: 'main', defaultRemote: 'origin', staleAfterDays: 30,
  }));
  fs.writeFileSync(outputPath, 'window.WES_BRANCH_SNAPSHOT = {"sentinel":true};\n');
  const before = fs.readFileSync(outputPath);
  const beforeMtime = fs.statSync(outputPath).mtimeMs;

  const snapshot = main({ projectRoot, configPath, outputPath, checkOnly: true, print: () => {} });

  assert.equal(snapshot.provenance.semantics, 'as_of_generation');
  assert.deepEqual(fs.readFileSync(outputPath), before);
  assert.equal(fs.statSync(outputPath).mtimeMs, beforeMtime);
});
