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
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

// ── Navigation Configuration ──
const NAV_ITEMS = [
  { label: '总览', href: 'index.html' },
  { label: '设计说明', href: 'design.html' },
  { label: '任务运行时', href: 'runtime.html' },
  { label: '计划与进度', href: 'plan.html' },
  { label: '测试', href: 'testing.html' },
  { label: '监控与审计', href: 'monitoring.html' },
  { label: '风险与决策', href: 'risks.html' },
  { label: '变更记录', href: 'changes.html' },
  { label: '文档事实源', href: 'sources.html' },
  { label: '协作协议', href: 'collaboration-protocol.html' },
  { label: '需求池', href: 'requirements.html' },
];

function generateNav(activePage) {
  const links = NAV_ITEMS.map(item => {
    const isActive = item.href === activePage ? ' class="active"' : '';
    return `        <a${isActive} href="${item.href}">${item.label}</a>`;
  }).join('\n');

  return `<nav class="navlinks" aria-label="主导航">
${links}
      </nav>
      <button class="mobile-menu-btn" onclick="document.querySelector('.navlinks').classList.toggle('open')" aria-label="菜单">☰</button>`;
}

// ─ CSS Merge ──
function mergeCSS() {
  const base = fs.readFileSync(path.join(BOARD_DIR, 'assets', 'base.css'), 'utf-8');
  const components = fs.readFileSync(path.join(BOARD_DIR, 'assets', 'components.css'), 'utf-8');
  const pages = fs.readFileSync(path.join(BOARD_DIR, 'assets', 'pages.css'), 'utf-8');

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
    // Replace existing <nav class="navlinks">...</nav> + button block
    const navRegex = /<nav class="navlinks"[^>]*>[\s\S]*?<\/nav>\s*<button class="mobile-menu-btn"[^>]*>[^<]*<\/button>/;
    result = result.replace(navRegex, generateNav(activePage));
  }

  // Update CSS references: replace split CSS with merged dashboard.css
  result = result.replace(
    /<link rel="stylesheet" href="assets\/base\.css" \/>[\s\n]*<link rel="stylesheet" href="assets\/components\.css" \/>[\s\n]*<link rel="stylesheet" href="assets\/pages\.css" \/>/,
    '<link rel="stylesheet" href="assets/dashboard.css" />'
  );

  return result;
}

// ── Main ──
async function main() {
  console.log(' WES Agent 升级总看板 — 构建开始\n');

  // Create dist directories
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // Merge CSS
  console.log(' 合并 CSS → assets/dashboard.css');
  const mergedCSS = mergeCSS();
  fs.writeFileSync(path.join(ASSETS_DIR, 'dashboard.css'), mergedCSS, 'utf-8');
  console.log(`   ✅ ${(mergedCSS.length / 1024).toFixed(1)} KB\n`);

  // Copy fonts
  console.log(' 复制字体 → assets/fonts/');
  const fontsSrc = path.join(BOARD_DIR, 'assets', 'fonts');
  const fontsDest = path.join(ASSETS_DIR, 'fonts');
  if (!fs.existsSync(fontsDest)) fs.mkdirSync(fontsDest, { recursive: true });
  
  const fontFiles = fs.readdirSync(fontsSrc);
  for (const file of fontFiles) {
    const srcPath = path.join(fontsSrc, file);
    const destPath = path.join(fontsDest, file);
    fs.copyFileSync(srcPath, destPath);
  }
  console.log(`   ✅ ${fontFiles.length} 个字体文件\n`);

  // Process HTML files
  console.log('📄 处理 HTML 页面...');
  const htmlFiles = fs.readdirSync(BOARD_DIR).filter(f => f.endsWith('.html'));
  
  for (const file of htmlFiles) {
    const srcPath = path.join(BOARD_DIR, file);
    const content = fs.readFileSync(srcPath, 'utf-8');
    const processed = processHTML(content, file);
    fs.writeFileSync(path.join(DIST_DIR, file), processed, 'utf-8');
    console.log(`   ✅ ${file}`);
  }

  console.log(`\n✅ 构建完成！输出目录: ${DIST_DIR}`);
  console.log(`   📁 ${htmlFiles.length} 个 HTML 页面`);
  console.log(`   📁 assets/dashboard.css (合并)`);
  console.log(`   📁 assets/fonts/ (${fontFiles.length} 文件)`);
  console.log('\n💡 用浏览器打开 dist/index.html 查看构建结果');
}

main().catch((err) => {
  console.error('❌ 构建失败:', err.message);
  process.exit(1);
});
