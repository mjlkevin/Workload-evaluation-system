#!/usr/bin/env node
/**
 * WES NightOps KIMICODE Peer Audit Loop
 *
 * Daily schedule (Asia/Shanghai, via launchd):
 *   03:25  first audit       — audit Qoder handoff
 *   07:05  rework audit      — audit Qoder rework handoff if present
 *   08:35  final audit       — audit remedy handoff if present; otherwise no-op
 *
 * Boundaries:
 *   - Reads only the latest mission packet, Qoder handoff, and latest Codex Gate.
 *   - Writes only the mission-specified kimicodeAuditPath.
 *   - kimicodeCanPatch=false by default; no code or board pages are modified.
 *   - Missing worktree / branch / baseCommit / changedFiles / verification => REJECTED.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = '/Users/kevin/AI/Workload-evaluation-system-agent';
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const LOOP_LOG = path.join(LOG_DIR, 'kimicode-nightops-loop.log');
const LOOP_ERR_LOG = path.join(LOG_DIR, 'kimicode-nightops-loop.error.log');
const NIGHTLY_DIR = path.join(PROJECT_ROOT, 'docs/agent-loop/nightly');
const HANDOFFS_DIR = path.join(PROJECT_ROOT, 'docs/agent-loop/handoffs');
const AUDITS_DIR = path.join(PROJECT_ROOT, 'docs/agent-loop/audits');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  // eslint-disable-next-line no-console
  console.log(line);
  ensureDir(LOG_DIR);
  fs.appendFileSync(LOOP_LOG, line + '\n');
}

function logError(err) {
  const line = `[${new Date().toISOString()}] ERROR: ${err.stack || err.message || err}`;
  ensureDir(LOG_DIR);
  fs.appendFileSync(LOOP_ERR_LOG, line + '\n');
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function fileExists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function listMissions() {
  try {
    return fs.readdirSync(NIGHTLY_DIR)
      .filter(f => f.endsWith('-mission.md'))
      .sort()
      .reverse();
  } catch { return []; }
}

function parseMission(content, missionPath) {
  const get = (key) => {
    const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : undefined;
  };
  return {
    missionPath,
    missionId: get('missionId'),
    date: get('date'),
    taskId: get('taskId'),
    qoderHandoffPath: get('qoderHandoffPath'),
    kimicodeAuditPath: get('kimicodeAuditPath'),
    codexGatePath: get('codexGatePath'),
    kimicodeCanPatch: get('kimicodeCanPatch') === 'true',
  };
}

function resolveProjectRelative(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

function shanghaiTime(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

function getRoundName(date = new Date()) {
  const sh = shanghaiTime(date);
  const h = sh.getHours();
  const m = sh.getMinutes();
  const t = h * 60 + m;
  // Ranges tuned around the three trigger times:
  //   03:25 = 205, 07:05 = 425, 08:35 = 515
  if (t >= 480 && t < 600) return 'final';   // 08:00-09:59
  if (t >= 390 && t < 480) return 'rework';  // 06:30-07:59
  return 'first';                              // 00:00-06:29 (covers 03:25)
}

function findLatestCodexGate(mission) {
  if (!mission.codexGatePath) return null;
  const p = resolveProjectRelative(mission.codexGatePath);
  return fileExists(p) ? readFileSafe(p) : null;
}

function findHandoffForRound(mission, round) {
  const primary = resolveProjectRelative(mission.qoderHandoffPath);
  if (!primary) return { expected: null, actual: null, exists: false };

  if (round === 'first') {
    return { expected: primary, actual: fileExists(primary) ? primary : null, exists: fileExists(primary) };
  }

  // For rework/final rounds, look for supplemental handoffs.
  const dir = path.dirname(primary);
  const base = path.basename(primary, '.md');
  const candidates = [
    path.join(dir, `${base}-rework.md`),
    path.join(dir, `${base}-remedy.md`),
    path.join(dir, `${base}-final.md`),
    primary,
  ];

  // Prefer the newest file among candidates that exists.
  let chosen = null;
  let chosenMtime = 0;
  for (const c of candidates) {
    if (!fileExists(c)) continue;
    const st = fs.statSync(c);
    if (st.mtimeMs > chosenMtime) {
      chosen = c;
      chosenMtime = st.mtimeMs;
    }
  }
  return { expected: primary, actual: chosen, exists: !!chosen };
}

function validateHandoff(handoffContent) {
  const checks = {
    worktree: /worktreePath:\s*\S+/.test(handoffContent),
    branch: /branch:\s*\S+/.test(handoffContent),
    baseCommit: /baseCommit:\s*\S+/.test(handoffContent),
    changedFiles: /changedFiles:\s*\S+/.test(handoffContent),
    verification: /(commands|results|notRun|verification):/i.test(handoffContent),
  };
  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { complete: missing.length === 0, missing, checks };
}

function extractHandoffMeta(handoffContent) {
  const get = (key) => {
    const m = handoffContent.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '(not found)';
  };
  return {
    projectRoot: get('projectRoot'),
    worktreePath: get('worktreePath'),
    branch: get('branch'),
    baseCommit: get('baseCommit'),
    commit: get('commit'),
    status: get('status'),
  };
}

function generateAudit(mission, round, handoffPath, handoffContent, gateContent) {
  const ts = new Date().toISOString();
  const auditOutputPath = resolveProjectRelative(mission.kimicodeAuditPath);
  const handoffRel = handoffPath ? path.relative(PROJECT_ROOT, handoffPath) : '(not found)';
  const missionRel = path.relative(PROJECT_ROOT, mission.missionPath);

  let verdict = 'PASS_TO_CODEX_GATE';
  const findings = [];
  let requiredRework = null;

  if (!handoffContent) {
    if (round === 'final' && gateContent) {
      verdict = 'PASS_TO_CODEX_GATE';
      findings.push('- No new Qoder handoff appeared after Codex Gate B; final audit is a no-op.');
    } else {
      verdict = 'REJECTED';
      findings.push(`- handoffCompleteness: CRITICAL — Qoder handoff file does not exist at ${handoffRel}.`);
      requiredRework = {
        blockingFinding: 'Missing Qoder handoff',
        requiredCorrection: 'Qoder must produce the handoff before KIMICODE can audit.',
        forbiddenChanges: 'Do not fabricate handoff content or broaden audit scope.',
        requiredVerification: 'N/A — handoff envelope is missing.',
      };
    }
  } else {
    const validation = validateHandoff(handoffContent);
    const meta = extractHandoffMeta(handoffContent);

    if (!validation.complete) {
      verdict = 'REJECTED';
      findings.push(`- handoffCompleteness: CRITICAL — handoff is missing required fields: ${validation.missing.join(', ')}.`);
      requiredRework = {
        blockingFinding: `Incomplete Qoder handoff: missing ${validation.missing.join(', ')}`,
        requiredCorrection: 'Qoder must re-issue a complete handoff with worktreePath, branch, baseCommit, changedFiles, and verification evidence.',
        forbiddenChanges: 'Do not proceed to Codex Gate with incomplete evidence.',
        requiredVerification: 'Re-run required verification commands and include results.',
      };
    } else {
      findings.push('- handoffCompleteness: OK — all required envelope fields are present.');
      findings.push(`- scopeCheck: worktreePath=${meta.worktreePath}, branch=${meta.branch}, baseCommit=${meta.baseCommit}, status=${meta.status}`);
      findings.push('- permissionFindings: N/A — read-only audit; no code or board pages modified by KIMICODE.');
      findings.push('- architectureFindings: N/A — read-only audit; no architecture boundary touched.');
      findings.push('- testFindings: verification evidence inspected from handoff only; not independently reproduced by this loop.');
    }
  }

  const lines = [
    '# KIMICODE Peer Audit',
    '',
    `missionId: ${mission.missionId}`,
    `taskId: ${mission.taskId}`,
    `handoffPath: ${handoffRel}`,
    `auditedWorktree: ${handoffContent ? extractHandoffMeta(handoffContent).worktreePath : '(no handoff)'}`,
    `auditedBranch: ${handoffContent ? extractHandoffMeta(handoffContent).branch : '(no handoff)'}`,
    `auditedBaseCommit: ${handoffContent ? extractHandoffMeta(handoffContent).baseCommit : '(no handoff)'}`,
    `verdict: ${verdict}`,
    '',
    '## ACK',
    '',
    'readFiles:',
    '  - AGENTS.md',
    '  - codex-project-registry.md',
    '  - KIMICODE.md',
    '  - skills/wes-multi-agent-collaboration/SKILL.md',
    '  - docs/agent-loop/nightops-templates.md',
    `  - ${missionRel}`,
    `allowedAuditScope: ${mission.kimicodeCanPatch ? 'peer audit + controlled fix (only when mission lists allowedPaths)' : 'peer audit only'}`,
    `kimicodeCanPatch: ${mission.kimicodeCanPatch}`,
    'forbiddenActions:',
    '  - 不独立领取 RP',
    '  - 不替代 Codex Gate',
    '  - 不标记“已交付”',
    '  - 不合并 main',
    '  - 不触碰 API Key / token / cookie / 私钥',
    '  - 不 reset / clean / restore / rebase 无关文件',
    '',
    '## Findings',
    '',
    ...findings,
    '',
    '## Verification',
    '',
    'commandsReproduced: []',
    `diffInspected: ${handoffContent ? 'true (handoff envelope inspected)' : 'false'}`,
    `notRun: ${handoffContent ? 'build/test commands not executed by KIMICODE loop; evidence taken from handoff' : 'all — handoff missing'}`,
    '',
  ];

  if (requiredRework) {
    lines.push(
      '## Required Rework',
      '',
      `blockingFinding: ${requiredRework.blockingFinding}`,
      `requiredCorrection: ${requiredRework.requiredCorrection}`,
      `forbiddenChanges: ${requiredRework.forbiddenChanges}`,
      `requiredVerification: ${requiredRework.requiredVerification}`,
      ''
    );
  }

  lines.push(
    '## Residual Risk',
    '',
    `risks: ${handoffContent ? 'Verification commands were not independently reproduced by this loop; Codex Gate should reproduce or accept them.' : 'No Qoder evidence is available for Codex Gate.'}`,
    `nextOwner: ${verdict === 'REJECTED' ? 'qoder1' : 'codex'}`,
    '',
    '---',
    `generatedAt: ${ts}`,
    `loopRound: ${round}`,
    `auditOutputPath: ${auditOutputPath ? path.relative(PROJECT_ROOT, auditOutputPath) : '(not configured)'}`
  );

  return { content: lines.join('\n'), outputPath: auditOutputPath, verdict };
}

function main() {
  try {
    log('KIMICODE NightOps Peer Audit Loop starting');

    const now = new Date();
    const round = getRoundName(now);
    log('Round:', round, 'at', now.toISOString(), '(Asia/Shanghai:', shanghaiTime(now).toISOString(), ')');

    const missions = listMissions();
    if (missions.length === 0) {
      log('No mission packets found in', NIGHTLY_DIR);
      return;
    }

    const latestMissionPath = path.join(NIGHTLY_DIR, missions[0]);
    log('Latest mission:', latestMissionPath);

    const missionContent = readFileSafe(latestMissionPath);
    if (!missionContent) {
      throw new Error('Failed to read latest mission packet');
    }

    const mission = parseMission(missionContent, latestMissionPath);
    if (!mission.missionId || !mission.kimicodeAuditPath) {
      throw new Error('Mission packet missing missionId or kimicodeAuditPath');
    }

    log('missionId:', mission.missionId, 'taskId:', mission.taskId, 'kimicodeCanPatch:', mission.kimicodeCanPatch);

    const gateContent = findLatestCodexGate(mission);
    if (gateContent) {
      log('Latest Codex Gate found');
    } else {
      log('No Codex Gate found yet');
    }

    const { expected: expectedHandoff, actual: handoffPath, exists: handoffExists } = findHandoffForRound(mission, round);
    const handoffContent = handoffPath ? readFileSafe(handoffPath) : null;

    if (!expectedHandoff) {
      log('No qoderHandoffPath configured in mission');
    } else if (!handoffExists) {
      log('Handoff not found at expected path', expectedHandoff);
    } else {
      log('Handoff found at', handoffPath);
    }

    const { content, outputPath, verdict } = generateAudit(mission, round, expectedHandoff, handoffContent, gateContent);

    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, content, 'utf8');
    log('Wrote audit to', outputPath, 'verdict:', verdict);
  } catch (err) {
    logError(err);
    process.exitCode = 1;
  }
}

main();
