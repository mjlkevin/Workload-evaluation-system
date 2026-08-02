const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  applyBoardEventToHtml,
  renderChangeRow,
  renderTestingRows,
  validateBoardEvent,
} = require('./board-event-lib');

const validEvent = {
  id: 'BE-2026-07-03-board-event-pipeline',
  date: '2026-07-03',
  type: 'process_change',
  scope: 'Board event pipeline MVP',
  summary: '新增结构化看板事件，减少手工维护 changes/testing HTML 的时间。',
  status: '已实施 / 自动化通过',
  pages: ['changes', 'testing'],
  evidence: [
    {
      kind: 'file',
      ref: 'scripts/board-event-apply.js',
      summary: '事件应用脚本',
    },
    {
      kind: 'command',
      ref: 'node --test scripts/board-event.test.js',
      result: 'pass',
      summary: 'board event 单测',
    },
  ],
  next: '后续扩展 requirements.html 多区域生成器。',
  board: {
    change: {
      stage: 'Board event pipeline',
      result: '已实施 / 可试运行',
    },
    testing: [
      {
        command: 'node --test scripts/board-event.test.js',
        result: 'pass',
        summary: '覆盖事件校验、changes/testing 渲染与幂等应用。',
      },
    ],
  },
};

test('validateBoardEvent accepts a complete board event', () => {
  const result = validateBoardEvent(validEvent);

  assert.deepEqual(result.errors, []);
  assert.equal(result.event.id, validEvent.id);
});

test('validateBoardEvent rejects missing required fields and secret-like content', () => {
  const result = validateBoardEvent({
    id: 'bad',
    date: '2026-07-03',
    type: 'process_change',
    scope: 'secret=sk-abcdefghijklmnopqrstuvwxyz',
    summary: 'missing status and pages',
  });

  assert.match(result.errors.join('\n'), /status/);
  assert.match(result.errors.join('\n'), /pages/);
  assert.match(result.errors.join('\n'), /sensitive/i);
});

test('renderChangeRow returns escaped, traceable HTML', () => {
  const row = renderChangeRow(validEvent);

  assert.match(row, /data-board-event-id="BE-2026-07-03-board-event-pipeline"/);
  assert.match(row, /Board event pipeline/);
  assert.match(row, /scripts\/board-event-apply\.js/);
  assert.doesNotMatch(row, /<script>/);
});

test('renderTestingRows returns one row per testing evidence item', () => {
  const rows = renderTestingRows(validEvent);

  assert.equal(rows.length, 1);
  assert.match(rows[0], /node --test scripts\/board-event\.test\.js/);
  assert.match(rows[0], /覆盖事件校验/);
});

test('applyBoardEventToHtml inserts changes row once after the timeline header', () => {
  const html = [
    '<table>',
    '<tr><th>阶段</th><th>工作内容</th><th>结果</th></tr>',
    '<tr><td class="mono">Existing</td><td>Old</td><td>Done</td></tr>',
    '</table>',
  ].join('\n');

  const once = applyBoardEventToHtml(html, validEvent, 'changes');
  const twice = applyBoardEventToHtml(once.html, validEvent, 'changes');

  assert.equal(once.changed, true);
  assert.equal(twice.changed, false);
  assert.equal((once.html.match(/data-board-event-id=/g) || []).length, 1);
  assert.ok(once.html.indexOf(validEvent.id) < once.html.indexOf('Existing'));
});

test('applyBoardEventToHtml inserts testing rows once in the automated baseline table', () => {
  const html = [
    '<h2 id="sec-08">自动化基线</h2>',
    '<table>',
    '<tr><th>命令</th><th>最近结果</th><th>覆盖范围</th></tr>',
    '<tr><td class="mono">Existing test</td><td>pass</td><td>Old</td></tr>',
    '</table>',
  ].join('\n');

  const once = applyBoardEventToHtml(html, validEvent, 'testing');
  const twice = applyBoardEventToHtml(once.html, validEvent, 'testing');

  assert.equal(once.changed, true);
  assert.equal(twice.changed, false);
  assert.equal((once.html.match(/data-board-event-id=/g) || []).length, 1);
  assert.ok(once.html.indexOf(validEvent.id) < once.html.indexOf('Existing test'));
});

test('RP-045 implementation event records verified automation without claiming integration or browser acceptance', () => {
  const eventPath = path.join(
    __dirname,
    '..',
    '03_技术设计',
    '系统架构',
    'WES-Agent-升级总看板',
    'events',
    '2026-08-02-rp-045-branch-topology.json',
  );
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const result = validateBoardEvent(event);
  const evidenceText = JSON.stringify(event.evidence);

  assert.deepEqual(result.errors, []);
  assert.equal(event.type, 'implementation');
  assert.equal(event.status, '核心实现完成 / 待主线集成与浏览器验证');
  assert.deepEqual(event.pages, [
    'index',
    'issues',
    'requirements',
    'plan',
    'testing',
    'monitoring',
    'changes',
    'sources',
  ]);
  assert.match(evidenceText, /npm run board:branches:check/);
  assert.match(evidenceText, /36\/36/);
  assert.match(event.next, /主线集成/);
  assert.match(event.next, /1440px/);
  assert.match(event.next, /760px/);
  assert.doesNotMatch(JSON.stringify(event), /用户已验收|已集成并验证|浏览器通过/);
});
