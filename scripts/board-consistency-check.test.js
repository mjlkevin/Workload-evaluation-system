const assert = require('node:assert/strict');
const test = require('node:test');

const { checkTagClosures, TAG_CLOSURE_TAGS } = require('./board-consistency-check');

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
