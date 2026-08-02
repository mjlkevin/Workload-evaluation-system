const fs = require('node:fs');
const path = require('node:path');

function parseRefOutput(output) {
  if (!output) return [];

  return output.split('\n').filter(Boolean).map((line) => {
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
  if (!output) return [];

  return output.split('\n\n').filter(Boolean).map((block) => {
    const worktree = {
      branchName: '',
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const line of block.split('\n')) {
      const separator = line.indexOf(' ');
      const key = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1);

      if (key === 'worktree') worktree.path = value;
      if (key === 'HEAD') worktree.headFull = value;
      if (key === 'branch') worktree.branchName = value.replace(/^refs\/heads\//, '');
      if (key === 'detached') worktree.detached = true;
      if (key === 'locked') worktree.locked = value || true;
      if (key === 'prunable') worktree.prunable = value || true;
    }
    return worktree;
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
      branches: [...branches].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
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
  if (!isObject(snapshot)) return ['snapshot must be an object'];

  if (snapshot.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(snapshot.generatedAt)) errors.push('generatedAt is required');
  if (typeof snapshot.repoRoot !== 'string') errors.push('repoRoot must be a string');
  if (!isNonEmptyString(snapshot.mainBranch)) errors.push('mainBranch is required');

  const arrayFields = ['branches', 'remoteRefs', 'worktrees', 'duplicateTipGroups', 'warnings'];
  for (const field of arrayFields) {
    if (!Array.isArray(snapshot[field])) errors.push(`${field} must be an array`);
  }

  if (!Array.isArray(snapshot.branches) || snapshot.branches.length === 0) {
    errors.push('branches must be non-empty');
  }

  const summaryFields = [
    'localBranchCount',
    'remoteRefCount',
    'worktreeCount',
    'ancestorCount',
    'nonAncestorCount',
    'duplicateTipGroupCount',
    'warningCount',
  ];
  if (!isObject(snapshot.summary)) {
    errors.push('summary must be an object');
  } else {
    for (const field of summaryFields) {
      if (!Number.isFinite(snapshot.summary[field]) || snapshot.summary[field] < 0) {
        errors.push(`summary.${field} must be a finite non-negative number`);
      }
    }
  }

  const branchNames = new Set();
  let mainBranch;
  let currentCount = 0;
  let ancestorCount = 0;
  let nonAncestorCount = 0;
  const requiredBranchStrings = ['branchName', 'headFull', 'headShort', 'prefix', 'governanceSuggestion'];
  const branchStringFields = [
    'committerDate',
    'author',
    'subject',
    'upstream',
    'upstreamTrack',
    'worktreePath',
    'worktreeDirty',
    'duplicateTipGroup',
  ];
  if (Array.isArray(snapshot.branches)) {
    for (const [index, branch] of snapshot.branches.entries()) {
      if (!isObject(branch)) {
        errors.push(`branch ${index} must be an object`);
        continue;
      }
      for (const field of requiredBranchStrings) {
        if (!isNonEmptyString(branch[field])) errors.push(`branch ${index} must have a non-empty ${field}`);
      }
      for (const field of branchStringFields) {
        if (typeof branch[field] !== 'string') errors.push(`branch ${index} ${field} must be a string`);
      }
      if (isNonEmptyString(branch.branchName)) {
        if (branchNames.has(branch.branchName)) errors.push(`duplicate branchName: ${branch.branchName}`);
        branchNames.add(branch.branchName);
        if (branch.branchName === snapshot.mainBranch) mainBranch = branch;
      }
      if (!['current', 'ancestor', 'non_ancestor'].includes(branch.gitRelation)) {
        errors.push(`branch ${index} has an invalid gitRelation`);
      }
      if (!Number.isFinite(branch.ahead) || branch.ahead < 0) {
        errors.push(`branch ${index} ahead must be a finite non-negative number`);
      }
      if (!Number.isFinite(branch.behind) || branch.behind < 0) {
        errors.push(`branch ${index} behind must be a finite non-negative number`);
      }
      if (branch.gitRelation === 'current') currentCount += 1;
      if (branch.gitRelation === 'ancestor') ancestorCount += 1;
      if (branch.gitRelation === 'non_ancestor') nonAncestorCount += 1;
    }
  }
  if (currentCount !== 1) errors.push('snapshot must have exactly one current branch');
  if (!mainBranch || mainBranch.gitRelation !== 'current') errors.push('current main branch is missing');

  if (isObject(snapshot.summary)) {
    const countChecks = {
      localBranchCount: Array.isArray(snapshot.branches) ? snapshot.branches.length : undefined,
      remoteRefCount: Array.isArray(snapshot.remoteRefs) ? snapshot.remoteRefs.length : undefined,
      worktreeCount: Array.isArray(snapshot.worktrees) ? snapshot.worktrees.length : undefined,
      ancestorCount,
      nonAncestorCount,
      duplicateTipGroupCount: Array.isArray(snapshot.duplicateTipGroups) ? snapshot.duplicateTipGroups.length : undefined,
      warningCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : undefined,
    };
    for (const [field, value] of Object.entries(countChecks)) {
      if (value !== undefined && snapshot.summary[field] !== value) {
        errors.push(`summary.${field} does not match snapshot contents`);
      }
    }
  }
  return errors;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildSnapshot(input) {
  const localRefs = input.localRefs || [];
  const remoteRefs = input.remoteRefs || [];
  const worktrees = input.worktrees || [];
  const relations = input.relations || new Map();
  const dirtyByPath = input.dirtyByPath || new Map();
  const warnings = input.warnings || [];
  const duplicateTipGroups = buildDuplicateTipGroups(localRefs);
  const duplicateByBranch = new Map(
    duplicateTipGroups.flatMap((group) => group.branches.map((branchName) => [branchName, group.id])),
  );
  const worktreeByBranch = new Map(
    worktrees.filter((worktree) => worktree.branchName).map((worktree) => [worktree.branchName, worktree]),
  );

  const branches = localRefs.map((ref) => {
    const relation = relations.get(ref.branchName) || {};
    const worktree = worktreeByBranch.get(ref.branchName);
    const duplicateTipGroupId = duplicateByBranch.get(ref.branchName);
    const branch = {
      ...ref,
      prefix: branchPrefix(ref.branchName),
      gitRelation: relation.gitRelation || 'unknown',
      ahead: relation.ahead ?? 0,
      behind: relation.behind ?? 0,
      worktreePath: worktree ? worktree.path : '',
      worktreeDirty: worktree ? (dirtyByPath.get(worktree.path) || 'unknown') : '',
      duplicateTipGroup: duplicateTipGroupId || '',
      duplicateTipGroupId: duplicateTipGroupId || null,
    };
    return { ...branch, governanceSuggestion: suggestionFor(branch, duplicateTipGroupId) };
  });

  const snapshot = {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    repoRoot: input.repoRoot,
    mainBranch: input.mainBranch,
    summary: {
      localBranchCount: localRefs.length,
      remoteRefCount: remoteRefs.length,
      worktreeCount: worktrees.length,
      ancestorCount: branches.filter((branch) => branch.gitRelation === 'ancestor').length,
      nonAncestorCount: branches.filter((branch) => branch.gitRelation === 'non_ancestor').length,
      duplicateTipGroupCount: duplicateTipGroups.length,
      warningCount: warnings.length,
    },
    branches,
    remoteRefs,
    worktrees,
    duplicateTipGroups,
    warnings,
  };
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid snapshot: ${errors.join('; ')}`);
  return snapshot;
}

function serializeSnapshot(snapshot) {
  return `window.WES_BRANCH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2).replace(/<\//g, '<\\/')};\n`;
}

function writeSnapshotAtomic(targetPath, snapshot) {
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid snapshot: ${errors.join('; ')}`);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, serializeSnapshot(snapshot), 'utf8');
  fs.renameSync(temporaryPath, targetPath);
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
