#!/usr/bin/env node
/**
 * WES Agent 升级总看板 — changes.html 月度归档脚本
 *
 * 规则（看板治理 B4，用户批准口径）：
 * - 将 data-board-event-id="BE-YYYY-MM-DD-..." 中日期早于 30 天的 <tr> 行
 *   从 changes.html 移出，转换为 Markdown 追加到 archive-md/changes-YYYY-MM.md；
 * - 不开独立 HTML 页；events/ JSON 审计留痕不受影响；
 * - 在 changes 表格顶部维护一条归档索引行（colspan=3）。
 *
 * 用法: node scripts/board-archive-changes.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const CHANGES = path.join(BOARD_DIR, 'changes.html');
const ARCHIVE_DIR = path.join(BOARD_DIR, 'archive-md');
const DRY = process.argv.includes('--dry-run');

const CUT = new Date();
CUT.setDate(CUT.getDate() - 30);

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .trim();
}

const src = fs.readFileSync(CHANGES, 'utf-8');
const rowRe = / *<tr data-board-event-id="(BE-(\d{4})-(\d{2})-(\d{2})-[^"]+)">.*?<\/tr>\n/g;

const toArchive = [];
let m;
while ((m = rowRe.exec(src)) !== null) {
  const [full, id, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}`);
  if (date < CUT) toArchive.push({ id, y, mo, full, date });
}

if (toArchive.length === 0) {
  console.log('无可归档记录（无早于 30 天的 BE 事件行）。');
  process.exit(0);
}

// 按月份分组转 md
const byMonth = new Map();
for (const item of toArchive) {
  const key = `${item.y}-${item.mo}`;
  if (!byMonth.has(key)) byMonth.set(key, []);
  const cells = item.full.match(/<td[^>]*>.*?<\/td>/g) || [];
  const title = cells[0] ? stripTags(cells[0]) : item.id;
  const detail = cells[1] ? stripTags(cells[1]) : '';
  const status = cells[2] ? stripTags(cells[2]) : '';
  byMonth.get(key).push(`## ${item.id} · ${title}\n\n${detail}\n\n状态：${status}\n`);
}

if (!DRY) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const [month, blocks] of byMonth) {
    const file = path.join(ARCHIVE_DIR, `changes-${month}.md`);
    const head = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : `# 看板变更记录归档 · ${month}\n\n> 由 scripts/board-archive-changes.js 自动归档（超 1 个月记录），事实留痕不删除。\n`;
    fs.writeFileSync(file, head + '\n' + blocks.join('\n'), 'utf-8');
  }

  // 从 changes.html 移除已归档行
  const ids = new Set(toArchive.map((t) => t.full));
  let out = src;
  for (const full of ids) out = out.replace(full, '');

  // 维护归档索引行
  const months = [...byMonth.keys()].sort().reverse();
  const links = months.map((mo) => `<a href="archive-md/changes-${mo}.md">${mo}</a>`).join(' · ');
  const noteRe = / *<tr class="archive-note">.*?<\/tr>\n/;
  const note = `          <tr class="archive-note"><td colspan="3">超 1 个月记录已归档为 Markdown：${links}（脚本：scripts/board-archive-changes.js）</td></tr>\n`;
  if (noteRe.test(out)) out = out.replace(noteRe, note);
  else out = out.replace(/(<table>\n *<tr><th>阶段<\/th><th>工作内容<\/th><th>结果<\/th><\/tr>\n)/, `$1${note}`);

  fs.writeFileSync(CHANGES, out, 'utf-8');
}

for (const [month, blocks] of byMonth) {
  console.log(`归档 ${month}：${blocks.length} 条 → archive-md/changes-${month}.md`);
}
console.log(`合计归档 ${toArchive.length} 条${DRY ? '（dry-run，未写盘）' : ''}。`);
