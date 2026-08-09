#!/usr/bin/env node
/**
 * WES 总看板三池表格增强标记脚本（一次性 + 幂等）
 *
 * 依据 open-design（shadcn 包）设计规范 + list.js 行为层需求：
 * - issues.html / defects.html（full 模式）：thead/tbody 规范化、td 列类（tc-N）、
 *   表格属性、.tbl-block > (.tbl-tools 工具条 + .table-scroll) 统一包裹；
 * - requirements.html（sort 模式）：主台账已有完整 ledger-filter-bar 筛选与
 *   用户级干预标识（localStorage），不重复注入工具条，仅补 data 属性启用
 *   list.js 表头排序，样式由 .tbl-* 统一升级。
 *
 * 两种模式均在 </body> 前注入 vendor/list.min.js 与 assets/board-table.js（渐进增强）。
 *
 * 用法: node scripts/board-table-mark.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const DRY = process.argv.includes('--dry');

const TARGETS = [
  { file: 'issues.html', key: 'issues', marker: '分析状态', filterCol: 6, mode: 'full' },
  { file: 'defects.html', key: 'defects', marker: '严重程度', filterCol: 5, mode: 'full' },
  { file: 'requirements.html', key: 'requirements', marker: '优先级', filterCol: 4, mode: 'sort' },
];

const SCRIPTS =
  '  <script src="assets/vendor/list.min.js" defer></script>\n' +
  '  <script src="assets/board-table.js" defer></script>\n';

function toolsHtml() {
  return [
    '        <div class="tbl-tools">',
    '          <input class="tbl-search" type="search" placeholder="搜索 ID / 标题 / 内容…" aria-label="搜索表格" />',
    '          <select class="tbl-filter" aria-label="按状态筛选"><option value="">全部状态</option></select>',
    '          <span class="tbl-count" aria-live="polite"></span>',
    '          <nav class="tbl-pager" aria-label="表格分页">',
    '            <button type="button" class="tbl-page-btn" data-pg="prev" aria-label="上一页">‹</button>',
    '            <span class="tbl-page-info">1 / 1</span>',
    '            <button type="button" class="tbl-page-btn" data-pg="next" aria-label="下一页">›</button>',
    '          </nav>',
    '        </div>',
  ].join('\n');
}

/** 给 tbody 内每个数据行的 td 按列序追加 tc-N 类（兼容带属性的 <tr ...>） */
function addCellClasses(tbodyHtml) {
  return tbodyHtml.replace(/<tr([^>]*)>([\s\S]*?)<\/tr>/g, (row, attrs, inner) => {
    if (/<th[\s>]/.test(inner)) return row; // 跳过表头行
    let i = 0;
    const patched = inner.replace(/<td([^>]*)>/g, (td, tdAttrs) => {
      const cls = i++;
      if (/class\s*=\s*(["'])/.test(tdAttrs)) {
        return td.replace(/class\s*=\s*(["'])([\s\S]*?)\1/, (m, q, v) => `class=${q}${v} tc-${cls}${q}`);
      }
      return `<td class="tc-${cls}"${tdAttrs}>`;
    });
    return `<tr${attrs}>${patched}</tr>`;
  });
}

function transformTable(tableHtml, cfg) {
  let t = tableHtml;
  const full = cfg.mode === 'full';

  // 1. thead/tbody 规范化（表头为单行多 th；requirements 已有 thead）
  if (full && !/<thead>/.test(t)) {
    t = t.replace(
      /<tr>\s*((?:<th[\s\S]*?<\/th>\s*)+)<\/tr>/,
      '<thead>\n            <tr>$1</tr>\n          </thead>\n          <tbody class="tbody">',
    );
    t = t.replace('</table>', '</tbody>\n        </table>');
    // 已有 <tbody>（无类）时补钩子类（list.js listClass 按 className 查找）
    t = t.replace(/<tbody>/g, '<tbody class="tbody">');
  }

  // 2. td 列类（仅 full 模式需要 valueNames 绑定；tbody 段）
  if (full) {
    t = t.replace(/<tbody>([\s\S]*?)<\/tbody>/, (m, body) => '<tbody>' + addCellClasses(body) + '</tbody>');
  }

  // 3. 表格属性
  t = t.replace(
    '<table>',
    `<table id="tbl-${cfg.key}" data-board-table data-mode="${cfg.mode}" data-page-size="10" data-filter-col="${cfg.filterCol}">`,
  );
  return t;
}

function markPage(cfg) {
  const filePath = path.join(BOARD_DIR, cfg.file);
  let html = fs.readFileSync(filePath, 'utf-8');
  if (html.includes(`id="tbl-${cfg.key}"`)) return false;

  // 定位含 marker 的首个表格（requirements 第二张拆解表不含「优先级」表头，天然排除）
  const tableRe = /<table>([\s\S]*?)<\/table>/g;
  let match;
  let target = null;
  while ((match = tableRe.exec(html)) !== null) {
    if (match[1].includes(cfg.marker)) { target = match; break; }
  }
  if (!target) return false;

  const tableHtml = transformTable(target[0], cfg);
  const before = html.slice(0, target.index);
  const after = html.slice(target.index + target[0].length);

  if (cfg.mode === 'full') {
    const hasScroll = /<div class="table-scroll">\s*$/.test(before);
    const head = hasScroll
      ? before.replace(/<div class="table-scroll">\s*$/, '<div class="tbl-block">\n' + toolsHtml() + '\n        <div class="table-scroll">\n        ')
      : before + '<div class="tbl-block">\n' + toolsHtml() + '\n        <div class="table-scroll">\n        ';
    // 补 .table-scroll 与 .tbl-block 闭合（after 起始即原 wrap 的 </div>，先闭内层两容器）
    const tail = '\n        </div>\n        </div>' + after;
    html = head + tableHtml + tail;
  } else {
    html = before + tableHtml + after;
  }

  if (!html.includes('assets/board-table.js')) {
    html = html.replace('</body>', SCRIPTS + '</body>');
  }

  if (!DRY) fs.writeFileSync(filePath, html, 'utf-8');
  return true;
}

function main() {
  console.log(`\n═══ 三池表格增强标记${DRY ? '（dry-run）' : ''} ═══\n`);
  for (const cfg of TARGETS) {
    console.log(`  ${markPage(cfg) ? '✅' : '──'} ${cfg.file} [${cfg.mode}]${DRY ? ' (dry-run)' : ''}`);
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { main, markPage, addCellClasses };
