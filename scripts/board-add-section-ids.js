#!/usr/bin/env node
/**
 * 批量给看板页面 h2 标题添加 id 锚点，并更新 TOC 链接为可点击的锚点链接
 *
 * 用法: node scripts/board-add-section-ids.js
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');

const htmlFiles = fs.readdirSync(BOARD_DIR).filter(f => f.endsWith('.html') && !f.startsWith('dist'));

for (const file of htmlFiles) {
  const filePath = path.join(BOARD_DIR, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // 1. Add id="sec-NN" to h2 headings that follow .h-num divs
  // Pattern: <div class="h-num">Section NN</div>\n<h2>Title</h2>
  content = content.replace(
    /(<div class="h-num">Section (\d+)<\/div>\s*\n\s*)<h2>([^<]+)<\/h2>/g,
    (match, prefix, num, title) => {
      const id = `sec-${num.padStart(2, '0')}`;
      return `${prefix}<h2 id="${id}">${title}</h2>`;
    }
  );

  // 2. Update TOC links to use href="#sec-NN"
  // Pattern: <li><b>§N</b> Title</li>  →  <li><a href="#sec-NN"><b>§N</b> Title</a></li>
  content = content.replace(
    /<li><b>§(\d+)<\/b>\s*([^<]+)<\/li>/g,
    (match, num, title) => {
      const id = `sec-${num.padStart(2, '0')}`;
      return `<li><a href="#${id}"><b>§${num}</b> ${title.trim()}</a></li>`;
    }
  );

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`✅ ${file}`);
}

console.log('\n✅ 所有页面 h2 锚点和 TOC 链接已更新');
