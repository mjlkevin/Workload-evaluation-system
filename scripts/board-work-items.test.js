const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  computeWorkItemSummary,
  renderDefectsPage,
  renderIssuesPage,
  validateWorkItemRegistry,
} = require('./board-work-items-lib');

const PROJECT_ROOT = path.join(__dirname, '..');

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, filePath), 'utf8');
}

const sampleRegistry = {
  updatedAt: '2026-07-03',
  issues: [
    {
      id: 'ISS-1',
      date: '2026-07-03',
      title: '原始反馈先进入问题池',
      source: 'user_feedback',
      rawFeedback: '用户建议原始反馈记录到问题，再分析进入缺陷或需求',
      evidence: ['conversation'],
      triageStatus: 'analyzed',
      disposition: { type: 'requirement', ref: 'RP-040' },
      priority: 'P1',
      next: '设计二级页面',
    },
    {
      id: 'ISS-2',
      date: '2026-07-03',
      title: '按钮点击后没有触发报告生成',
      source: 'user_screenshot',
      rawFeedback: '点击概览预览后仍按普通文本发送',
      evidence: ['session:18ecc6d7'],
      triageStatus: 'analyzed',
      disposition: { type: 'defect', ref: 'DEF-1' },
      priority: 'P1',
      next: '修复并回归',
    },
  ],
  defects: [
    {
      id: 'DEF-1',
      linkedIssueId: 'ISS-2',
      rpId: 'RP-039',
      title: '下一步选项动作闭环缺陷',
      severity: 'S2',
      status: 'fixed_manual_pending',
      affectedArea: 'AI 工作台附件问答',
      fix: '补 generate_requirement_report 动作推断',
      verification: 'HomeWorkspace 51/51',
      acceptance: '真实会话人工复核待回填',
    },
  ],
};

test('validateWorkItemRegistry accepts issue-first triage data', () => {
  const result = validateWorkItemRegistry(sampleRegistry);
  assert.deepEqual(result.errors, []);
});

test('validateWorkItemRegistry rejects defects without a linked issue', () => {
  const result = validateWorkItemRegistry({
    updatedAt: '2026-07-03',
    issues: [],
    defects: [{ id: 'DEF-orphan', linkedIssueId: 'missing', rpId: 'RP-999', title: 'orphan' }],
  });

  assert.match(result.errors.join('\n'), /unknown linkedIssueId/);
});

test('computeWorkItemSummary separates issue dispositions from defect records', () => {
  const summary = computeWorkItemSummary(sampleRegistry);

  assert.equal(summary.issueTotal, 2);
  assert.equal(summary.issueToRequirement, 1);
  assert.equal(summary.issueToDefect, 1);
  assert.equal(summary.defectTotal, 1);
  assert.equal(summary.defectOpen, 0);
  assert.equal(summary.defectManualPending, 1);
});

test('renderIssuesPage shows raw feedback and disposition links', () => {
  const html = renderIssuesPage(sampleRegistry);

  assert.match(html, /问题池/);
  assert.match(html, /<a class="active" href="issues\.html">问题池<\/a>/);
  assert.match(html, /<a href="defects\.html">缺陷池<\/a>/);
  assert.match(html, /<a href="requirements\.html">需求池<\/a>/);
  assert.match(html, /原始反馈/);
  assert.match(html, /RP-040/);
  assert.match(html, /DEF-1/);
});

test('renderDefectsPage shows linked issue and RP traceability', () => {
  const html = renderDefectsPage(sampleRegistry);

  assert.match(html, /缺陷池/);
  assert.match(html, /<a href="issues\.html">问题池<\/a>/);
  assert.match(html, /<a class="active" href="defects\.html">缺陷池<\/a>/);
  assert.match(html, /<a href="requirements\.html">需求池<\/a>/);
  assert.match(html, /ISS-2/);
  assert.match(html, /RP-039/);
  assert.match(html, /HomeWorkspace 51\/51/);
});

test('feedback governance instructions require issue-first Codex Loop triage', () => {
  const skill = readProjectFile('skills/recording-wes-requirements/SKILL.md');
  const agents = readProjectFile('AGENTS.md');
  const intake = readProjectFile('docs/codex-workflows/wes-feedback-intake.md');

  assert.doesNotMatch(skill, /project-level demand pool|写入需求池|直接进入需求池/);
  assert.doesNotMatch(agents, /直接进入需求池/);
  assert.match(skill, /原始反馈统一先进入问题池/);
  assert.match(skill, /Codex Intake\/Triage Loop/);
  assert.match(agents, /先进入问题池/);
  assert.match(agents, /Codex Intake\/Triage Loop/);
  assert.match(intake, /Codex Intake\/Triage Loop/);
});
