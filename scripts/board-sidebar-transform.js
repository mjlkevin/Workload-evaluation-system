#!/usr/bin/env node
/**
 * board-sidebar-transform.js
 * Transform all HTML pages from topnav to left sidebar navigation.
 * - Replace <header class="topnav"> with <aside class="sidebar">
 * - Move page TOC into sidebar (if exists)
 * - Wrap remaining content in <div class="main-content">
 * - Add sidebar toggle + overlay for mobile
 * - Add scroll-spy for TOC links
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '03_技术设计/系统架构/WES-Agent-升级总看板');

const NAV_ITEMS = [
  { href: 'index.html', label: '总览' },
  { href: 'roadmap.html', label: '路标管理' },
  { href: 'design.html', label: '设计说明' },
  { href: 'runtime.html', label: '任务运行时' },
  { href: 'plan.html', label: '计划与进度' },
  { href: 'testing.html', label: '测试' },
  { href: 'monitoring.html', label: '监控与审计' },
  { href: 'risks.html', label: '风险与决策' },
  { href: 'changes.html', label: '变更记录' },
  { href: 'sources.html', label: '文档事实源' },
  { href: 'collaboration-protocol.html', label: '协作协议' },
  { href: 'branches.html', label: '分支拓扑' },
  { href: 'requirements.html', label: '需求池' },
];

function buildNavLinks(currentPage, tocItems) {
  const links = [];
  for (const item of NAV_ITEMS) {
    const isActive = item.href === currentPage;
    const cls = isActive ? ' class="active"' : '';
    if (isActive && tocItems && tocItems.length > 0) {
      // Wrap active item in a group with subnav
      const subLinks = tocItems.map(t => `          <a href="${t.href}">${t.label}</a>`).join('\n');
      links.push(`        <div class="sidebar-nav-group">\n          <a${cls} href="${item.href}">${item.label}</a>\n          <div class="sidebar-subnav">\n${subLinks}\n          </div>\n        </div>`);
    } else {
      links.push(`        <a${cls} href="${item.href}">${item.label}</a>`);
    }
  }
  return links.join('\n');
}

function extractToc(html) {
  // Try to extract from existing .toc block first
  const tocMatch = html.match(/<(?:div|nav)\s+class="toc"[^>]*>([\s\S]*?)<\/(?:div|nav)>/);
  if (tocMatch) {
    const inner = tocMatch[1];
    const items = [];
    const liRegex = /<li>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRegex.exec(inner)) !== null) {
      const content = m[1].trim();
      const aMatch = content.match(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (aMatch) {
        items.push({ href: aMatch[1], label: aMatch[2].trim() });
      } else {
        items.push({ href: '#', label: content });
      }
    }
    if (items.length > 0) return items;
  }

  // Fallback: extract from h2 headings with id="sec-NN"
  const items = [];
  const h2Regex = /<h2\s+id="(sec-\d+)"[^>]*>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = h2Regex.exec(html)) !== null) {
    const id = m[1];
    const title = m[2].trim();
    // Extract section number from id (sec-01 -> 1)
    const num = parseInt(id.replace('sec-', ''), 10);
    items.push({ href: `#${id}`, label: `<b>§${num}</b> ${title}` });
  }
  return items.length > 0 ? items : null;
}

function extractBrandPill(html) {
  const pillMatch = html.match(/<header class="topnav">[\s\S]*?<span class="pill brand">([\s\S]*?)<\/span>[\s\S]*?<\/header>/);
  if (pillMatch) return pillMatch[1].trim();
  return '';
}

function transformFile(filePath) {
  const fileName = path.basename(filePath);

  // Skip design-architecture.html - standalone page with inline styles
  if (fileName === 'design-architecture.html') {
    console.log(`⊘ ${fileName} (standalone, skipped)`);
    return;
  }

  let html = fs.readFileSync(filePath, 'utf-8');

  // 0. Remove existing sidebar if present (idempotent)
  html = html.replace(/\s*<aside class="sidebar"[^>]*>[\s\S]*?<\/aside>\s*\n?/g, '');
  html = html.replace(/\s*<button class="sidebar-toggle"[^>]*>[^<]*<\/button>\s*\n?/g, '');
  html = html.replace(/\s*<div class="sidebar-overlay"[^>]*><\/div>\s*\n?/g, '');
  html = html.replace(/\s*<div class="main-content">\s*\n?/g, '');
  // Remove closing </div> for main-content (the one right before </body>)
  html = html.replace(/\s*<\/div>\s*(?=<\/body>)/g, '');

  // 1. Extract info
  const tocItems = extractToc(html);
  const navLinks = buildNavLinks(fileName, tocItems);
  const brandPill = extractBrandPill(html);

  // 2. Build full sidebar HTML (no separate TOC block — subnav is inline)
  const sidebarHtml = `<aside class="sidebar" id="sidebar">
    <a class="sidebar-brand" href="index.html">
      <span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--brand-soft);color:var(--brand);font-weight:900;font-size:14px;">W</span>
      <span>WES 项目管理</span>
    </a>
    <nav class="sidebar-nav" aria-label="主导航">
${navLinks}
    </nav>
    <div style="flex:1"></div>
    <div class="sidebar-pill">
      <span class="pill brand">${brandPill || 'WES Project Management'}</span>
    </div>
  </aside>
  <button class="sidebar-toggle" id="sidebarToggle" aria-label="菜单">☰</button>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>`;

  // 4. Remove old topnav
  html = html.replace(/<header class="topnav">[\s\S]*?<\/header>\s*\n?/, '');

  // 5. Remove in-page TOC block
  html = html.replace(/\s*<(?:div|nav)\s+class="toc"[^>]*>[\s\S]*?<\/(?:div|nav)>\s*\n?/, '\n');

  // 6. Remove stray mobile-menu-btn buttons (e.g. in sources.html)
  html = html.replace(/\s*<button class="mobile-menu-btn"[^>]*>[^<]*<\/button>\s*\n?/g, '\n');

  // 7. Insert sidebar + open main-content wrapper after <body>
  const bodyMatch = html.match(/(<body>\s*\n?)/);
  if (bodyMatch) {
    html = html.replace(bodyMatch[0], bodyMatch[0] + sidebarHtml + '\n\n  <div class="main-content">\n');
  }

  // 8. Close main-content wrapper before </body>
  html = html.replace(/(\s*<\/body>)/, '  </div>\n$1');

  // 9. Add toggle script + scroll spy before </body>
  const toggleScript = `  <script>
  (function(){
    var toggle = document.getElementById('sidebarToggle');
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (toggle && sidebar) {
      toggle.addEventListener('click', function() {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open');
      });
      if (overlay) overlay.addEventListener('click', function() {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
      });
    }
    /* Scroll-spy for sidebar subnav */
    var subLinks = document.querySelectorAll('.sidebar-subnav a[href^="#"]');
    if (subLinks.length) {
      var sections = [];
      subLinks.forEach(function(a) {
        var t = document.querySelector(a.getAttribute('href'));
        if (t) sections.push({ el: t, link: a });
      });
      function onScroll() {
        var y = window.scrollY + 120;
        var active = null;
        sections.forEach(function(s) { if (s.el.offsetTop <= y) active = s; });
        subLinks.forEach(function(a) { a.classList.remove('active'); });
        if (active) active.link.classList.add('active');
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  })();
  </script>
`;
  html = html.replace(/(\s*<\/div>\s*<\/body>)/, toggleScript + '$1');

  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`✓ ${fileName}`);
}

function main() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
  files.forEach(f => transformFile(path.join(DIR, f)));
  console.log(`\nDone: ${files.length} files processed.`);
}

if (require.main === module) main();

module.exports = { NAV_ITEMS, buildNavLinks, main, transformFile };
