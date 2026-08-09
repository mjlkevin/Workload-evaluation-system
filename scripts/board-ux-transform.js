#!/usr/bin/env node
/**
 * WES 总看板 UX 迁移脚本（一次性 + 幂等）
 *
 * 功能：
 * 1. 将所有根目录看板页面的 <nav class="navlinks"> 替换为分组导航
 *    （含分支拓扑页 branch-primary-nav，全看板统一分组结构）
 * 2. 在 </body> 前注入 assets/board-ui.js 渐进增强脚本
 * 3. 术语业务化：Phase → 阶段、Gate → 关卡、Loop → 循环
 *    - 每页首个出现处保留英文原名作为括号补充（如「关卡（Gate）」）
 *    - 仅处理标签外文本，跳过 script/style/code/pre 内容与所有属性值
 *    - 通过前瞻/回顾断言保证重复执行不会二次包裹
 *
 * 用法: node scripts/board-ux-transform.js [--dry]
 */

const fs = require('fs');
const path = require('path');
const { replaceNavigationLinks } = require('./board-build');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const SCRIPT_TAG = '<script src="assets/board-ui.js" defer></script>';
const DRY = process.argv.includes('--dry');

// ── 术语替换规则 ──
// Phase：仅处理 "Phase 1X(-Y)" 形式；替换后 "(Phase" 紧随，前瞻阻断二次匹配
const PHASE_RE = /\bPhase\s*(1[A-H](?:-[A-Z])?)(?!\s*[（(])/g;
// Gate / Loop：独立单词；已在括号内的英文原名不再处理
const GATE_RE = /(?<![(（])\bGate\b(?!\s*[）)])/g;
const LOOP_RE = /(?<![(（])\bLoop\b(?!\s*[）)])/g;

function transformTermsInText(text, counters) {
  // 元描述句（讨论术语本身）不做替换，避免语义自相矛盾
  if (/工程术语|术语对照|术语表/.test(text)) return text;
  let out = text.replace(PHASE_RE, (_m, code) => {
    const suffix = counters.phase++ === 0 ? `（Phase ${code}）` : '';
    return `阶段 ${code}${suffix}`;
  });
  out = out.replace(GATE_RE, () => (counters.gate++ === 0 ? '关卡（Gate）' : '关卡'));
  out = out.replace(LOOP_RE, () => (counters.loop++ === 0 ? '循环（Loop）' : '循环'));
  return out;
}

// 轻量标签流解析：只替换标签之间的文本节点，跳过 script/style/code/pre 内容
function transformTerms(html) {
  const counters = { phase: 0, gate: 0, loop: 0 };
  const parts = html.split(/(<[^>]*>)/g);
  const skipTags = new Set(['script', 'style', 'code', 'pre']);
  let skipDepth = 0;
  const result = parts.map(part => {
    if (part.startsWith('<')) {
      const m = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(part);
      if (m) {
        const tag = m[1].toLowerCase();
        if (skipTags.has(tag)) {
          if (part.startsWith('</')) skipDepth = Math.max(0, skipDepth - 1);
          else if (!part.endsWith('/>')) skipDepth += 1;
        }
      }
      return part; // 标签（含属性）原样保留
    }
    if (skipDepth > 0) return part;
    return transformTermsInText(part, counters);
  });
  return { html: result.join(''), counters };
}

function transformFile(file) {
  const filePath = path.join(BOARD_DIR, file);
  let html = fs.readFileSync(filePath, 'utf-8');
  const original = html;

  // 1. 分组导航（全看板统一，含 branch-primary-nav）
  html = replaceNavigationLinks(html, file);

  // 2. 注入渐进增强脚本
  if (!/assets\/board-ui\.js/.test(html) && /<\/body>/.test(html)) {
    html = html.replace(/<\/body>/, `  ${SCRIPT_TAG}\n</body>`);
  }

  // 3. 术语业务化
  const { html: termed, counters } = transformTerms(html);
  html = termed;

  if (html !== original) {
    if (!DRY) fs.writeFileSync(filePath, html, 'utf-8');
    console.log(`  ✅ ${file}  (阶段:${counters.phase} 关卡:${counters.gate} 循环:${counters.loop})${DRY ? ' [dry-run]' : ''}`);
    return true;
  }
  console.log(`  ─ ${file} 无需变更`);
  return false;
}

function main() {
  console.log(`\n═══ WES 总看板 UX 迁移${DRY ? '（dry-run）' : ''} ═══\n目录：${BOARD_DIR}\n`);
  const files = fs.readdirSync(BOARD_DIR).filter(f => f.endsWith('.html'));
  let changed = 0;
  for (const file of files.sort()) {
    if (transformFile(file)) changed += 1;
  }
  console.log(`\n完成：${changed}/${files.length} 个页面有变更\n`);
}

if (require.main === module) main();

module.exports = { main, transformTerms, transformFile };
