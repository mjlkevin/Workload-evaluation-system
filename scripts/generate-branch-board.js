const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
const REF_FORMAT = '%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(authorname)%00%(subject)%00%(upstream:short)%00%(upstream:trackshort)';
const REMOTE_REF_FORMAT = '%(refname:lstrip=2)%00%(objectname)%00%(committerdate:iso-strict)%00%(authorname)%00%(subject)%00%(upstream:short)%00%(upstream:trackshort)%00%(symref:short)';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseRemoteRefOutput(output) {
  if (!output) return [];

  return output.split('\n').filter(Boolean).map((line) => {
    const [ref] = parseRefOutput(line);
    const symbolicTarget = line.split('\0')[7] || '';
    return {
      ...ref,
      refKind: 'remote_tracking',
      symbolicTarget,
      isSymbolic: Boolean(symbolicTarget),
    };
  });
}

function separateActiveWorktrees(worktrees, warnings) {
  return worktrees.filter((worktree) => {
    if (!worktree.prunable) return true;
    warnings.push(`Prunable worktree metadata excluded from active state: ${worktree.path}`);
    return false;
  });
}

function relationFor(projectRoot, mainBranch, branchName) {
  if (branchName === mainBranch) {
    return { gitRelation: 'current', behind: 0, ahead: 0 };
  }

  let isAncestor;
  try {
    git(['merge-base', '--is-ancestor', branchName, mainBranch], projectRoot);
    isAncestor = true;
  } catch (error) {
    if (error.status !== 1) throw error;
    isAncestor = false;
  }
  const [behind, ahead] = git(
    ['rev-list', '--left-right', '--count', `${mainBranch}...${branchName}`],
    projectRoot,
  ).trim().split(/\s+/).map(Number);

  return {
    gitRelation: isAncestor ? 'ancestor' : 'non_ancestor',
    behind,
    ahead,
  };
}

function worktreeDirtyState(worktreePath, warnings) {
  try {
    return git(['status', '--porcelain'], worktreePath).trim() ? 'dirty' : 'clean';
  } catch (error) {
    warnings.push(`Unable to determine worktree state for ${worktreePath}: ${error.message}`);
    return 'unknown';
  }
}

function collectSnapshot({
  projectRoot,
  mainBranch,
  defaultRemote = 'origin',
  staleAfterDays = 30,
  now = new Date().toISOString(),
}) {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/heads/${mainBranch}`], projectRoot);
  } catch (error) {
    if (error.status === 1) {
      throw new Error(`Configured main branch does not exist: ${mainBranch}`);
    }
    throw error;
  }

  const localRefs = parseRefOutput(git(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads'], projectRoot));
  const remoteRefs = parseRemoteRefOutput(git(['for-each-ref', `--format=${REMOTE_REF_FORMAT}`, 'refs/remotes'], projectRoot));
  const worktrees = parseWorktreePorcelain(git(['worktree', 'list', '--porcelain'], projectRoot));
  const warnings = [];
  const activeWorktrees = separateActiveWorktrees(worktrees, warnings);
  const relations = new Map(localRefs.map((ref) => [
    ref.branchName,
    relationFor(projectRoot, mainBranch, ref.branchName),
  ]));
  const dirtyByPath = new Map(activeWorktrees.map((worktree) => [
    worktree.path,
    worktreeDirtyState(worktree.path, warnings),
  ]));

  const snapshot = buildSnapshot({
    generatedAt: typeof now === 'string' ? now : new Date(now).toISOString(),
    repoRoot: projectRoot,
    mainBranch,
    localRefs,
    remoteRefs,
    worktrees: activeWorktrees,
    relations,
    dirtyByPath,
    warnings,
  });
  snapshot.governance = { defaultRemote, staleAfterDays };
  snapshot.provenance = {
    semantics: 'as_of_generation',
    sourceCheckoutBranch: git(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot).trim(),
    sourceCheckoutHead: git(['rev-parse', 'HEAD'], projectRoot).trim(),
    configuredMainlineHead: git(['rev-parse', `refs/heads/${mainBranch}`], projectRoot).trim(),
    observationNote: 'This is an as-of-generation observation and can precede the commit containing it.',
  };
  return snapshot;
}

function loadConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('Invalid branch board config: schemaVersion must be 1');
  if (typeof config.mainBranch !== 'string' || !config.mainBranch.trim()) {
    throw new Error('Invalid branch board config: mainBranch must be non-empty');
  }
  if (typeof config.defaultRemote !== 'string' || !config.defaultRemote.trim()) {
    throw new Error('Invalid branch board config: defaultRemote must be non-empty');
  }
  if (!Number.isFinite(config.staleAfterDays) || config.staleAfterDays < 0) {
    throw new Error('Invalid branch board config: staleAfterDays must be a finite non-negative number');
  }
  return config;
}

function main({
  configPath = CONFIG_PATH,
  outputPath = OUTPUT_PATH,
  projectRoot = PROJECT_ROOT,
  checkOnly = false,
  print = (value) => process.stdout.write(value),
} = {}) {
  const config = loadConfig(configPath);
  const snapshot = collectSnapshot({
    projectRoot,
    mainBranch: config.mainBranch,
    defaultRemote: config.defaultRemote,
    staleAfterDays: config.staleAfterDays,
  });
  if (!checkOnly) writeSnapshotAtomic(outputPath, snapshot);
  print(`${JSON.stringify({
    mode: checkOnly ? 'check' : 'write',
    output: path.relative(projectRoot, outputPath),
    generatedAt: snapshot.generatedAt,
    summary: snapshot.summary,
  })}\n`);
  return snapshot;
}

if (require.main === module) {
  try {
    main({ checkOnly: process.argv.includes('--check') });
  } catch (error) {
    process.stderr.write(`Branch board generation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectSnapshot,
  loadConfig,
  main,
  parseRemoteRefOutput,
  relationFor,
  separateActiveWorktrees,
  worktreeDirtyState,
};
