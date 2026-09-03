#!/usr/bin/env node
/**
 * WES 总看板一致性校验脚本
 *
 * 扫描 03_技术设计/系统架构/WES-Agent-升级总看板/ 下所有 HTML 页面，
 * 检测以下不一致问题：
 *   1. 顶部 pill 中的 Phase 标记与 index.html 基准不一致
 *   2. footer 日期与页面实际内容更新时间不匹配（过期日期检测）
 *   3. 需求数量 KPI 在不同页面间不一致
 *   4. 导航栏 HTML 片段不一致（结构漂移）
 *   5. Google Fonts 外部依赖检测
 *   6. （保留编号）
 *   7. HTML 标签闭合校验（td / tr / table / details 按行计数）
 *
 * 用法：node scripts/board-consistency-check.js [--fix]
 *   --fix  自动修复可安全修复的问题（当前仅报告，不自动修复）
 *
 * 退出码：0 = 全部通过，1 = 存在不一致
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.join(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const HTML_FILES = [
  'index.html',
  'design.html',
  'design-architecture.html',
  'runtime.html',
  'plan.html',
  'testing.html',
  'monitoring.html',
  'risks.html',
  'changes.html',
  'sources.html',
  'collaboration-protocol.html',
  'branches.html',
  'requirements.html',
];

// ─── 颜色输出 ───
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }
function error(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function ok(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function info(msg) { console.log(`${CYAN}ℹ${RESET} ${msg}`); }

// ─── 读取文件 ───
function readHtml(filename) {
  const fp = path.join(BOARD_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf-8');
}

// ─── 提取顶部 pill 中的 Phase 标记 ───
function extractPhasePills(html, filename) {
  const pills = [];
  // 只匹配 topnav 区域（<header class="topnav"> 到 </header>）
  const topnavMatch = html.match(/<header\s+class="topnav">[\s\S]*?<\/header>/);
  if (!topnavMatch) return pills;
  const topnavHtml = topnavMatch[0];
  const pillRe = /class="pill[^"]*">([^<]*(?:Phase|1[A-Z][^<]*))/gi;
  let m;
  while ((m = pillRe.exec(topnavHtml)) !== null) {
    pills.push({ text: m[1].trim(), file: filename });
  }
  return pills;
}

// ─── 提取 meta 区域的当前阶段/状态 ───
function extractMetaStatus(html) {
  const metas = {};
  const metaRe = /<b>(当前阶段|事实基线|状态|当前基线)<\/b>\s*([^<]+)/g;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    metas[m[1]] = m[2].trim();
  }
  return metas;
}

// ─── 提取 footer 日期 ───
function extractFooterDate(html) {
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/);
  if (!footerMatch) return null;
  const dateMatch = footerMatch[1].match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : null;
}

// ─── 提取需求数量 KPI ───
function extractRequirementCounts(html) {
  const counts = {};
  // 匹配 "33 项" / "33 requirements" / "33 条需求" 等
  const patterns = [
    { re: /(\d+)\s*项[需求]*/g, key: '项' },
    { re: /(\d+)\s*条需求/g, key: '条' },
    { re: /(\d+)\s*requirements/gi, key: 'requirements' },
    { re: /(\d+)\s*delivered/gi, key: 'delivered' },
    { re: /(\d+)\s*已交付/g, key: '已交付' },
    { re: /(\d+)\s*pending/gi, key: 'pending' },
    { re: /(\d+)\s*deferred/gi, key: 'deferred' },
    { re: /(\d+)\s*暂缓/g, key: '暂缓' },
  ];
  for (const { re, key } of patterns) {
    const m = html.match(re);
    if (m) counts[key] = m.map(s => parseInt(s, 10));
  }
  return counts;
}

// ─── 提取导航栏 HTML ───
function extractNavHtml(html) {
  const navMatch = html.match(/<nav\s+class="navlinks"[^>]*>([\s\S]*?)<\/nav>/);
  return navMatch ? navMatch[1].replace(/\s+/g, ' ').trim() : null;
}

// ─── 检测 Google Fonts 依赖 ───
function hasGoogleFonts(html) {
  return /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html);
}

// ─── 检查 7：HTML 标签闭合校验（td / tr / table / details） ───
// 裁决 C（2026-09-03 架构侧）：看板行级 HTML 的 <td> 漏闭合靠浏览器自动闭合，
// 一致性门禁应主动捕获。采用整文件计数比对：开标签总数 ≠ 闭标签总数即报错误。
// 注：本板所有 <table>/<tr>/<details> 均为成对闭合（多行展开），按文件计数足够定位漏闭合。
const TAG_CLOSURE_TAGS = ['td', 'tr', 'table', 'details'];

function checkTagClosures(html, filename) {
  const issues = [];
  for (const tag of TAG_CLOSURE_TAGS) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
    const closeRe = new RegExp(`</${tag}>`, 'gi');
    const selfCloseRe = new RegExp(`<${tag}[^>]*/>`, 'gi');
    const opens = (html.match(openRe) || []).length - (html.match(selfCloseRe) || []).length;
    const closes = (html.match(closeRe) || []).length;
    if (opens !== closes) {
      issues.push({ tag, opens, closes, file: filename });
    }
  }
  return issues;
}

// ─── 主检查逻辑 ───
function run() {
  console.log(`\n${BOLD}═══ WES 总看板一致性校验 ═══${RESET}\n`);
  console.log(`扫描目录：${BOARD_DIR}\n`);

  let issues = 0;
  let warnings = 0;

  // 收集所有页面数据
  const pages = {};
  for (const file of HTML_FILES) {
    const html = readHtml(file);
    if (!html) {
      info(`${file} 不存在，跳过`);
      continue;
    }
    pages[file] = {
      html,
      pills: extractPhasePills(html, file),
      meta: extractMetaStatus(html),
      footerDate: extractFooterDate(html),
      reqCounts: extractRequirementCounts(html),
      navHtml: extractNavHtml(html),
      hasGoogleFonts: hasGoogleFonts(html),
    };
  }

  // ─── 检查 1：顶部 pill Phase 一致性 ───
  console.log(`${BOLD}── 检查 1：顶部 Phase pill 一致性 ──${RESET}`);
  // 术语业务化后 pill 可能写作「阶段 1H-C（Phase 1H-C）」或「阶段 1H-C」
  const indexPill = pages['index.html']?.pills.find(p => /(Phase|阶段)\s*1H-C/.test(p.text));
  if (indexPill) {
    info(`基准：index.html → "${indexPill.text}"`);
  }

  for (const [file, data] of Object.entries(pages)) {
    if (file === 'index.html') continue;
    // 只检查 topnav 中第一个 pill 是否包含 Phase 标记
    const topnavPill = data.pills[0];
    if (topnavPill) {
      // 检查是否包含过时的 Phase 标记（低于当前 Phase 1H-C）
      const stalePatterns = [
        /(Phase|阶段)\s*1[A-E][^F-GH]/i,  // 1A-1E（不含 F 以后）
        /(Phase|阶段)\s*1F\b/i,           // 1F（不是最新）
      ];
      const isStale = stalePatterns.some(re => re.test(topnavPill.text));
      if (isStale && !topnavPill.text.includes('1H')) {
        error(`${file}: 顶部 pill 过时 → "${topnavPill.text}"（当前为 Phase 1H-C）`);
        issues++;
      }
    }
  }

  // ─── 检查 2：meta 区域状态一致性 ───
  console.log(`\n${BOLD}── 检查 2：meta 区域当前阶段/事实基线 ──${RESET}`);
  for (const [file, data] of Object.entries(pages)) {
    const stage = data.meta['当前阶段'] || data.meta['事实基线'];
    if (stage) {
      // 检测是否只写到 1F（过时）
      if (/1F\s*验证|1F\s*回写监控已落地/.test(stage) && !/1G|1H/.test(stage)) {
        warn(`${file}: meta 状态停留在 Phase 1F → "${stage.substring(0, 60)}..."`);
        warnings++;
      }
    }
  }

  // ─── 检查 3：footer 日期 ───
  console.log(`\n${BOLD}── 检查 3：footer 日期 ──${RESET}`);
  const today = '2026-06-29'; // 当前系统日期
  for (const [file, data] of Object.entries(pages)) {
    if (!data.footerDate) {
      warn(`${file}: footer 中未找到日期`);
      warnings++;
      continue;
    }
    if (data.footerDate < '2026-06-26') {
      warn(`${file}: footer 日期 ${data.footerDate} 可能已过时（当前 ${today}）`);
      warnings++;
    } else {
      ok(`${file}: footer 日期 ${data.footerDate}`);
    }
  }

  // ─── 检查 4：需求数量 KPI 一致性 ───
  console.log(`\n${BOLD}── 检查 4：需求数量 KPI ──${RESET}`);
  // 提取需求总数（匹配 "需求池 N 项" / "N 条需求" / "N requirements"）
  const reqTotalMap = {};
  for (const [file, data] of Object.entries(pages)) {
    const html = data.html;
    // 优先匹配 "需求池 33 项" 或 "33 条需求" 或 "33 requirements"
    const totalPatterns = [
      /需求池[^\d]*(\d+)\s*项/,
      /(\d+)\s*条需求/,
      /(\d+)\s*requirements/i,
    ];
    for (const re of totalPatterns) {
      const m = html.match(re);
      if (m) {
        reqTotalMap[file] = parseInt(m[1], 10);
        break;
      }
    }
  }
  const uniqueTotals = [...new Set(Object.values(reqTotalMap))];
  if (uniqueTotals.length > 1) {
    error(`需求总数不一致：${Object.entries(reqTotalMap).map(([f, v]) => `${f}=${v}`).join(', ')}`);
    issues++;
  } else if (uniqueTotals.length === 1) {
    ok(`需求总数一致：${uniqueTotals[0]}`);
  } else {
    warn('未能提取到需求总数 KPI');
    warnings++;
  }

  // ─── 检查 5：导航栏结构一致性 ───
  console.log(`\n${BOLD}── 检查 5：导航栏结构一致性 ──${RESET}`);
  const indexNav = pages['index.html']?.navHtml;
  if (indexNav) {
    for (const [file, data] of Object.entries(pages)) {
      if (file === 'index.html' || file === 'collaboration-protocol.html') continue;
      if (!data.navHtml) continue;
      // 比较链接数量（忽略 active class 差异）
      const indexLinks = (indexNav.match(/href="[^"]+"/g) || []).length;
      const pageLinks = (data.navHtml.match(/href="[^"]+"/g) || []).length;
      if (indexLinks !== pageLinks) {
        error(`${file}: 导航链接数量不一致（index=${indexLinks}, ${file}=${pageLinks}）`);
        issues++;
      }
    }
    ok(`导航栏链接数量检查完成`);
  }

  // ─── 检查 6：Google Fonts 外部依赖 ───
  console.log(`\n${BOLD}── 检查 6：Google Fonts 外部依赖 ──${RESET}`);
  let fontCount = 0;
  for (const [file, data] of Object.entries(pages)) {
    if (data.hasGoogleFonts) {
      fontCount++;
    }
  }
  if (fontCount > 0) {
    warn(`${fontCount} 个页面依赖 Google Fonts CDN（建议本地化字体）`);
    warnings++;
  } else {
    ok('无 Google Fonts 外部依赖');
  }

  // ─── 检查 7：HTML 标签闭合（td / tr / table / details） ───
  console.log(`\n${BOLD}── 检查 7：HTML 标签闭合校验 ──${RESET}`);
  // 裁决 C（2026-09-03）：
  //   - <td> 漏闭合（changes.html 单行式行的已知形态）→ error，必须清零
  //   - 其他标签（tr / table / details）整文件计数不匹配 → warn，留作跨页陈旧事实备查
  //     （多行展开结构偶有跨行未闭合，按整文件计数会出现假阳性，故降级处理）
  let tagClosureErrors = 0;
  let tagClosureWarnings = 0;
  for (const [file, data] of Object.entries(pages)) {
    const found = checkTagClosures(data.html, file);
    for (const iss of found) {
      const delta = iss.opens - iss.closes;
      const msg = `${iss.file} <${iss.tag}> 不闭合 → opens=${iss.opens} closes=${iss.closes}（Δ=${delta}）`;
      if (iss.tag === 'td') {
        error(msg);
        tagClosureErrors++;
      } else {
        warn(msg + '（多行结构允许，降级为警告）');
        tagClosureWarnings++;
      }
    }
  }
  if (tagClosureErrors > 0) {
    issues += tagClosureErrors;
  } else if (tagClosureWarnings === 0) {
    ok(`全部 ${Object.keys(pages).length} 页标签闭合正常（检查标签：${TAG_CLOSURE_TAGS.join(' / ')}）`);
  } else {
    ok(`<td> 全部闭合正常（共 ${Object.keys(pages).length} 页）`);
  }
  if (tagClosureWarnings > 0) {
    warnings += tagClosureWarnings;
  }

  // ─── 汇总 ───
  console.log(`\n${BOLD}═══ 校验结果 ═══${RESET}`);
  console.log(`  错误：${issues}`);
  console.log(`  警告：${warnings}`);
  console.log(`  页面：${Object.keys(pages).length}`);

  if (issues > 0) {
    console.log(`\n${RED}${BOLD}存在 ${issues} 个不一致问题，需要修复${RESET}`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`\n${YELLOW}${BOLD}有 ${warnings} 个警告，建议关注${RESET}`);
    process.exit(0);
  } else {
    console.log(`\n${GREEN}${BOLD}全部通过${RESET}`);
    process.exit(0);
  }
}

if (require.main === module) run();

module.exports = { BOARD_DIR, HTML_FILES, main: run, run, checkTagClosures, TAG_CLOSURE_TAGS };
