const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { BOARD_DIR, checkTagClosures, TAG_CLOSURE_TAGS, listBoardHtmlFiles } = require('./board-consistency-check');

test('checkTagClosures: balanced HTML returns no issues', () => {
  const html = `
    <table>
      <tr><td>a</td><td>b</td></tr>
      <tr><td>c</td><td>d</td></tr>
    </table>
    <details><summary>s</summary>body</details>
  `;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 0);
});

test('checkTagClosures: detects unclosed td', () => {
  const html = `<tr><td class="mono">x</td><td>y</td><td>z</tr>`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].tag, 'td');
  assert.equal(issues[0].opens, 3);
  assert.equal(issues[0].closes, 2);
  assert.equal(issues[0].file, 'test.html');
});

test('checkTagClosures: detects unclosed tr', () => {
  const html = `<table><tr><td>x</td></tr><tr><td>y</td></table>`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].tag, 'tr');
  assert.equal(issues[0].opens, 2);
  assert.equal(issues[0].closes, 1);
});

test('checkTagClosures: detects unclosed table', () => {
  const html = `<table><tr><td>x</td></tr>`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].tag, 'table');
});

test('checkTagClosures: detects unclosed details', () => {
  const html = `<details><summary>s</summary>body`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].tag, 'details');
});

test('checkTagClosures: self-closing td does not miscount', () => {
  // Self-closing tags subtract from opens; closes = 0; balance = 0
  const html = `<td /><td />`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 0);
});

test('checkTagClosures: td with attributes counted', () => {
  const html = `<tr><td class="mono" colspan="2">x</td></tr>`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 0);
});

test('checkTagClosures: multiple mismatches reported', () => {
  const html = `<table><tr><td>x</td><td>y</tr>`; // missing </td> (2nd) and </table>
  const issues = checkTagClosures(html, 'test.html');
  const tags = issues.map(i => i.tag).sort();
  assert.deepEqual(tags, ['table', 'td']);
});

test('checkTagClosures: case insensitive tag match', () => {
  const html = `<TR><TD>x</TD></TR>`;
  const issues = checkTagClosures(html, 'test.html');
  assert.equal(issues.length, 0);
});

test('TAG_CLOSURE_TAGS includes the 4 expected tags', () => {
  assert.deepEqual([...TAG_CLOSURE_TAGS].sort(), ['details', 'table', 'td', 'tr']);
});

test('闭合校验扫描面 = 看板目录全部 *.html(覆盖名单外 issues/defects 等页)', () => {
  const files = listBoardHtmlFiles(BOARD_DIR);
  assert.ok(files.length >= 21, `看板应有 21+ 页,实得 ${files.length}`);
  assert.ok(files.includes('issues.html'), 'issues.html 必须在扫描面内(曾是名单外页面)');
  assert.ok(files.includes('defects.html'), 'defects.html 必须在扫描面内(曾是名单外页面)');
});

test('任务 2.4 注入复现:名单外 issues.html 未闭合 <td> → 门禁报错且非零退出', () => {
  const src = path.join(BOARD_DIR, 'issues.html');
  assert.ok(fs.existsSync(src), '前置:issues.html 必须存在于看板目录');
  const original = fs.readFileSync(src, 'utf8');
  // 架构侧同款注入:向 </table> 前注入一个未闭合 <td> 的行
  const injected = original.replace('</table>', '<tr><td>ARCH-INJECT-UNCLOSED</tr></table>');
  assert.notEqual(injected, original, '注入必须落地');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-board-inject-'));
  try {
    fs.writeFileSync(path.join(tmp, 'issues.html'), injected);
    const res = spawnSync(
      process.execPath,
      [path.join(__dirname, 'board-consistency-check.js'), '--board-dir', tmp],
      { encoding: 'utf8' }
    );
    assert.equal(res.status, 1, `门禁必须报错并非零退出;stdout:\n${res.stdout}`);
    assert.match(res.stdout, /issues\.html <td> 不闭合/);
    assert.match(res.stdout, /显式排除 0 页/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('真实看板目录门禁不误伤(扩面后 exit 0 且扫描面声明可见)', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'board-consistency-check.js')], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `真实目录门禁应 exit 0;stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.match(res.stdout, /共扫描 \d+ 页 \/ 显式排除 0 页/);
});
