#!/usr/bin/env node
/**
 * WES Agent 升级总看板 — 构建脚本
 * 
 * 功能：
 * 1. 导航模板化：从统一配置生成各页面导航（active 类自动设置）
 * 2. CSS 合并：将 base.css + components.css + pages.css 合并为 dashboard.css（向后兼容）
 * 3. 输出到 dist/ 目录
 *
 * 用法: node scripts/board-build.js
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const DIST_DIR = path.join(BOARD_DIR, 'dist');

// ── Navigation Configuration ──
const NAV_ITEMS = [
  { label: '总览', href: 'index.html' },
  { label: '设计说明', href: 'design.html' },
  { label: 'AI 任务执行', href: 'runtime.html' },
  { label: '计划与进度', href: 'plan.html' },
  { label: '测试与验收', href: 'testing.html' },
  { label: '监控与审计', href: 'monitoring.html' },
  { label: '风险与决策', href: 'risks.html' },
  { label: '变更记录', href: 'changes.html' },
  { label: '信息来源', href: 'sources.html' },
  { label: '多 AI 协作', href: 'collaboration-protocol.html' },
  { label: '开发分支', href: 'branches.html' },
  { label: '需求池', href: 'requirements.html' },
];

const EXTRA_FILES = [
  'assets/branch-topology.css',
  'assets/branch-topology.js',
  'data/branch-snapshot.js',
];

function generateNavLinks(activePage) {
  return NAV_ITEMS.map(item => {
    const isActive = item.href === activePage ? ' class="active"' : '';
    return `        <a${isActive} href="${item.href}">${item.label}</a>`;
  }).join('\n');
}

function generateNav(activePage) {
  const links = generateNavLinks(activePage);
  return `<nav class="navlinks" aria-label="主导航">
${links}
      </nav>
      <button class="mobile-menu-btn" onclick="document.querySelector('.navlinks').classList.toggle('open')" aria-label="菜单">☰</button>`;
}

function classTokensForOpeningTag(openingTag) {
  const classAttribute = /(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/.exec(openingTag);
  return classAttribute ? classAttribute[2].trim().split(/\s+/).filter(Boolean) : [];
}

function replaceNavigationLinks(html, activePage) {
  return html.replace(/(<nav\b[^>]*>)([\s\S]*?)(<\/nav>)/g, (nav, openingTag, inner, closingTag) => {
    if (!classTokensForOpeningTag(openingTag).includes('navlinks')) return nav;
    const closingIndent = inner.match(/\n([ \t]*)$/)?.[1] || '';
    return `${openingTag}\n${generateNavLinks(activePage)}\n${closingIndent}${closingTag}`;
  });
}

// ─ CSS Merge ──
function mergeCSS(boardDir = BOARD_DIR) {
  const base = fs.readFileSync(path.join(boardDir, 'assets', 'base.css'), 'utf-8');
  const components = fs.readFileSync(path.join(boardDir, 'assets', 'components.css'), 'utf-8');
  const pages = fs.readFileSync(path.join(boardDir, 'assets', 'pages.css'), 'utf-8');

  const merged = [
    '/* ══════════════════════════════════════════════',
    '   WES Agent 升级总看板 — Merged CSS (auto-generated)',
    '   由 scripts/board-build.js 自动生成',
    '   源文件: base.css + components.css + pages.css',
    '   ═════════════════════════════════════════════ */\n',
    base.trim(),
    '\n\n',
    components.trim(),
    '\n\n',
    pages.trim(),
    '\n'
  ].join('');

  return merged;
}

// ── Process HTML Files ──
function processHTML(htmlContent, activePage) {
  let result = htmlContent;

  // Replace nav placeholder or existing nav block
  const navPlaceholder = '<!-- NAV_PLACEHOLDER -->';
  if (result.includes(navPlaceholder)) {
    result = result.replace(navPlaceholder, generateNav(activePage));
  } else {
    result = replaceNavigationLinks(result, activePage);
  }

  // Update CSS references: replace split CSS with merged dashboard.css
  result = result.replace(
    /<link rel="stylesheet" href="assets\/base\.css" \/>[\s\n]*<link rel="stylesheet" href="assets\/components\.css" \/>[\s\n]*<link rel="stylesheet" href="assets\/pages\.css" \/>/,
    '<link rel="stylesheet" href="assets/dashboard.css" />'
  );

  return result;
}

function copyExtraFiles(destinationDir = DIST_DIR, sourceBoardDir = BOARD_DIR) {
  const copiedFiles = [];
  for (const relativeFile of EXTRA_FILES) {
    const source = path.join(sourceBoardDir, relativeFile);
    const destination = path.join(destinationDir, relativeFile);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copiedFiles.push(destination);
  }
  return copiedFiles;
}

// ── Main ──
async function main({ boardDir = BOARD_DIR, distDir = path.join(boardDir, 'dist') } = {}) {
  console.log(' WES Agent 升级总看板 — 构建开始\n');
  const assetsDir = path.join(distDir, 'assets');

  // Create dist directories
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  // Merge CSS
  console.log(' 合并 CSS → assets/dashboard.css');
  const mergedCSS = mergeCSS(boardDir);
  fs.writeFileSync(path.join(assetsDir, 'dashboard.css'), mergedCSS, 'utf-8');
  console.log(`   ✅ ${(mergedCSS.length / 1024).toFixed(1)} KB\n`);

  // Copy fonts
  console.log(' 复制字体 → assets/fonts/');
  const fontsSrc = path.join(boardDir, 'assets', 'fonts');
  const fontsDest = path.join(assetsDir, 'fonts');
  if (!fs.existsSync(fontsDest)) fs.mkdirSync(fontsDest, { recursive: true });
  
  const fontFiles = fs.readdirSync(fontsSrc);
  for (const file of fontFiles) {
    const srcPath = path.join(fontsSrc, file);
    const destPath = path.join(fontsDest, file);
    fs.copyFileSync(srcPath, destPath);
  }
  console.log(`   ✅ ${fontFiles.length} 个字体文件\n`);

  // Copy branch topology runtime assets that remain separate from dashboard.css.
  const extraFiles = copyExtraFiles(distDir, boardDir);
  console.log(` 复制分支拓扑资源 → ${extraFiles.length} 个文件\n`);

  // Process HTML files
  console.log('📄 处理 HTML 页面...');
  const htmlFiles = fs.readdirSync(boardDir).filter(f => f.endsWith('.html'));
  
  for (const file of htmlFiles) {
    const srcPath = path.join(boardDir, file);
    const content = fs.readFileSync(srcPath, 'utf-8');
    const processed = processHTML(content, file);
    fs.writeFileSync(path.join(distDir, file), processed, 'utf-8');
    console.log(`   ✅ ${file}`);
  }

  console.log(`\n✅ 构建完成！输出目录: ${distDir}`);
  console.log(`   📁 ${htmlFiles.length} 个 HTML 页面`);
  console.log(`   📁 assets/dashboard.css (合并)`);
  console.log(`   📁 assets/fonts/ (${fontFiles.length} 文件)`);
  console.log('\n💡 用浏览器打开 dist/index.html 查看构建结果');

  return { assetsDir, boardDir, distDir, extraFiles, fontFiles, htmlFiles };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ 构建失败:', err.message);
    process.exit(1);
  });
}

module.exports = { NAV_ITEMS, copyExtraFiles, generateNav, generateNavLinks, main, mergeCSS, processHTML, replaceNavigationLinks };
