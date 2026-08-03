#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const BRANCH_LINK = '<a href="branches.html">开发分支</a>';
const NAV_BLOCK = /<nav\b[^>]*>[\s\S]*?<\/nav>/g;
const COLLABORATION_LINK = /<a\b[^>]*\bhref=(["'])collaboration-protocol\.html\1[^>]*>(?:协作协议|多 AI 协作)<\/a>/;
const BRANCH_HREF = /\bhref=(["'])branches\.html\1/;

function classTokensForNav(nav) {
  const openingTag = nav.slice(0, nav.indexOf('>') + 1);
  const classAttribute = /(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/.exec(openingTag);
  return classAttribute ? classAttribute[2].trim().split(/\s+/).filter(Boolean) : [];
}

function syncHtml(html, fileName) {
  if (fileName === 'branches.html') return html;

  return html.replace(NAV_BLOCK, (nav) => {
    const classTokens = classTokensForNav(nav);
    if (!classTokens.includes('navlinks') && !classTokens.includes('sidebar-nav') && !classTokens.includes('top-links')) return nav;
    if (BRANCH_HREF.test(nav)) return nav;
    const collaboration = nav.match(COLLABORATION_LINK);
    if (!collaboration) return nav;

    const offset = collaboration.index + collaboration[0].length;
    const following = nav.slice(offset);
    const newline = following.match(/^(\r?\n)([ \t]*)/);
    const insertion = newline ? `${newline[1]}${newline[2]}${BRANCH_LINK}` : ` ${BRANCH_LINK}`;
    return `${nav.slice(0, offset)}${insertion}${following}`;
  });
}

function syncDirectory(boardDir = BOARD_DIR) {
  const changedFiles = [];
  const files = fs.readdirSync(boardDir)
    .filter((file) => file.endsWith('.html'))
    .sort();

  for (const file of files) {
    const filePath = path.join(boardDir, file);
    const original = fs.readFileSync(filePath, 'utf8');
    const synced = syncHtml(original, file);
    if (synced !== original) {
      fs.writeFileSync(filePath, synced, 'utf8');
      changedFiles.push(filePath);
    }
  }
  return changedFiles;
}

if (require.main === module) {
  const changedFiles = syncDirectory();
  console.log(`同步完成：${changedFiles.length} 个页面已更新`);
}

module.exports = { BOARD_DIR, BRANCH_LINK, syncHtml, syncDirectory };
