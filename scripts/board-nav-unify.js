#!/usr/bin/env node
/**
 * WES 总看板导航结构统一脚本（一次性 + 幂等）
 *
 * 背景：issues / defects / code-audit / ops-health 四个页面沿用旧侧边栏布局，
 * 而当前样式资产中已无 .sidebar / .main-content 规则，导致导航裸奔、与主导航不一致；
 * design-architecture 为独立海报页，完全没有看板导航。
 *
 * 本脚本：
 * 1. 将侧边栏页面的 <aside class="sidebar">…</aside> 替换为标准顶部导航
 *    （header.topnav，与 index.html 同构），并移除 .main-content 包裹层与失效的侧边栏脚本；
 * 2. 为 design-architecture.html 补齐标准 CSS 引用与顶部导航；
 * 3. 导航链接内容由 board-build.generateNav 生成（分组结构 + 当前页激活），
 *    后续再跑 board-ux-transform.js 做全页导航同步与脚本注入。
 *
 * 用法: node scripts/board-nav-unify.js [--dry]
 */

const fs = require('fs');
const path = require('path');
const { generateNav } = require('./board-build');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const DRY = process.argv.includes('--dry');

const SIDEBAR_PAGES = ['issues.html', 'defects.html', 'code-audit.html', 'ops-health.html'];
const POSTER_PAGES = ['design-architecture.html'];

const CSS_LINKS = [
  '<link rel="stylesheet" href="assets/fonts/fonts.css" />',
  '<link rel="stylesheet" href="assets/base.css" />',
  '<link rel="stylesheet" href="assets/components.css" />',
  '<link rel="stylesheet" href="assets/pages.css" />',
];

function headerFor(page) {
  return [
    '  <header class="topnav">',
    '    <div class="topnav-in">',
    '      <a class="brand" href="index.html"><span class="logo">W</span><span>WES 项目管理</span></a>',
    `      ${generateNav(page).split('\n').join('\n      ')}`,
    '      <span class="pill brand">阶段 1H-C · 规划中</span>',
    '    </div>',
    '  </header>',
  ].join('\n');
}

function unifySidebarPage(file) {
  const filePath = path.join(BOARD_DIR, file);
  let html = fs.readFileSync(filePath, 'utf-8');
  if (!/<aside class="sidebar"/.test(html)) return false;
  const original = html;

  // 1. 侧边栏整体替换为标准顶部导航
  html = html.replace(/<aside class="sidebar"[\s\S]*?<\/aside>\s*/, headerFor(file) + '\n');

  // 2. 移除 .main-content 包裹层（开标签 + </main> 后的闭标签）
  html = html.replace(/\s*<div class="main-content">/, '');
  html = html.replace(/(<\/main>)\s*\n\s*<\/div>/, '$1');

  // 3. 移除失效的侧边栏切换脚本
  html = html.replace(/\s*<script>\s*const sidebar = document\.getElementById\('sidebar'\);[\s\S]*?<\/script>/, '');

  if (html !== original && !DRY) fs.writeFileSync(filePath, html, 'utf-8');
  return html !== original;
}

function unifyPosterPage(file) {
  const filePath = path.join(BOARD_DIR, file);
  let html = fs.readFileSync(filePath, 'utf-8');
  if (html.includes('class="topnav"')) return false;
  const original = html;

  // 1. 补齐标准 CSS（置于内联 <style> 之前，页面自有样式仍可覆盖）
  if (!html.includes('assets/base.css')) {
    html = html.replace(/<style>/, CSS_LINKS.join('\n  ') + '\n  <style>');
  }

  // 2. <body> 后插入标准顶部导航
  html = html.replace(/<body>/, '<body>\n' + headerFor(file));

  if (html !== original && !DRY) fs.writeFileSync(filePath, html, 'utf-8');
  return html !== original;
}

function main() {
  console.log(`\n═══ 导航结构统一${DRY ? '（dry-run）' : ''} ═══\n`);
  for (const file of SIDEBAR_PAGES) {
    console.log(`  ${unifySidebarPage(file) ? '✅' : '──'} ${file}（侧边栏 → 顶部导航）${DRY ? ' [dry-run]' : ''}`);
  }
  for (const file of POSTER_PAGES) {
    console.log(`  ${unifyPosterPage(file) ? '✅' : '──'} ${file}（补齐 CSS 与顶部导航）${DRY ? ' [dry-run]' : ''}`);
  }
  console.log('\n完成。请继续运行 node scripts/board-ux-transform.js 同步全页导航与脚本。\n');
}

if (require.main === module) main();

module.exports = { main, unifySidebarPage, unifyPosterPage };
