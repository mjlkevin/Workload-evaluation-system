#!/usr/bin/env node
/**
 * WES 总看板「技术细节折叠」标记脚本（一次性 + 幂等）
 *
 * 为各页面指定的区块添加 data-tech-collapse / data-tech-label 属性，
 * 由 assets/board-ui.js 在运行时转换为可折叠结构（渐进增强，无 JS 时内容全可见）。
 *
 * 标记规则：
 * - wrap + sec-head 结构：标记加在 .wrap 上（业务标题保留在外层）
 * - h-num + h2 结构：标记加在 <section> 上（h2 标题保留在外层）
 * - requirements.html 中所有 RP 分析卡片默认折叠（状态看板保持常显）
 *
 * 用法: node scripts/board-tech-mark.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.resolve(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const DRY = process.argv.includes('--dry');

// 按 h2 标题包含匹配的待折叠区块（label 为折叠条显示文案）
const TARGETS = {
  'index.html': [
    { match: '项目资料与事实来源', label: '来源与依据明细' },
    { match: '设计、计划和验证如何配合', label: '流程细节' },
    { match: '阶段 1D 已完成的业务闭环', label: '历史交付明细' },
    { match: '阶段 1G 交付状态', label: '阶段 1G 交付明细' },
    { match: '本会话补齐的 Harness 决策', label: '决策明细' },
  ],
  'requirements.html': [
    { match: '需求生命周期', label: '流程细节' },
    { match: '需求完整台账', label: '完整台账' },
    { match: '需求影响范围', label: '影响范围明细' },
    { match: '维护规则', label: '规则细节' },
    { prefix: 'RP-', label: '分析明细' }, // 所有 RP 深度分析卡片
  ],
  'changes.html': [
    { match: 'Git 与合并', label: 'Git 明细' },
    { match: '代码工作内容', label: '代码明细' },
    { match: '验证记录', label: '验证明细' },
    { match: '文档升级', label: '文档明细' },
  ],
  'plan.html': [
    { match: '已完成工作', label: '历史交付明细' },
    { match: '阶段 1E 已完成的能力', label: '历史交付明细' },
    { match: '阶段 1F 的目标', label: '历史计划明细' },
    { match: '阶段 1F 任务拆解', label: '历史任务明细' },
    { match: '人工测试计划', label: '测试计划明细' },
    { match: '验收门禁', label: '门禁明细' },
    { match: '暂不进入范围', label: '范围决策明细' },
    { match: '阶段 1G 交付状态', label: '阶段 1G 交付明细' },
    { match: '后续任务池', label: '任务池明细' },
    { match: '需求池定期处理机制', label: '机制明细' },
  ],
  'testing.html': [
    { match: '阶段 1F 扩展用例', label: '用例明细' },
    { match: '阶段 1G 意图路由用例', label: '用例明细' },
    { match: '阶段 1H-A 工作台体验用例', label: '用例明细' },
    { match: '阶段 1H-B 引导选项用例', label: '用例明细' },
    { prefix: 'RP-', label: '用例明细' },
    { match: '结果反馈模板', label: '模板明细' },
    { match: '缺陷分级', label: '分级标准' },
    { match: '关闭标准', label: '标准明细' },
    { match: '自动化基线', label: '自动化明细' },
  ],
  'risks.html': [
    { match: '架构边界', label: '边界明细' },
    { match: '关键决策', label: '决策明细' },
    { match: '阶段 1E 基线风险', label: '历史风险明细' },
    { match: '阶段 1F 风险', label: '历史风险明细' },
    { match: '决策触发器', label: '触发器明细' },
  ],
  'sources.html': [
    { match: '文档分层图', label: '分层明细' },
    { match: '文档矩阵', label: '矩阵明细' },
    { match: '事实流转图', label: '流转明细' },
    { match: '资产清单', label: '清单明细' },
  ],
};

function markFile(file) {
  const targets = TARGETS[file];
  if (!targets) return 0;
  const filePath = path.join(BOARD_DIR, file);
  let html = fs.readFileSync(filePath, 'utf-8');
  let marked = 0;

  // 按 <section 切块处理（section 不嵌套）
  const parts = html.split(/(<section\b[^>]*>)/);
  for (let i = 1; i < parts.length; i += 2) {
    const openTag = parts[i];
    const body = parts[i + 1] || '';
    const end = body.indexOf('</section>');
    if (end === -1) continue;
    const inner = body.slice(0, end);
    if (openTag.includes('data-tech-collapse')) continue;

    const h2Match = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h2Match) continue;
    const title = h2Match[1].replace(/<[^>]+>/g, '').trim();
    const hit = targets.find(t => (t.match && title.includes(t.match)) || (t.prefix && title.startsWith(t.prefix)));
    if (!hit) continue;

    if (/<div class="wrap">\s*<div class="sec-head">/.test(inner)) {
      // sec-head 结构：标记加在 .wrap 上，业务标题保留常显
      parts[i + 1] = body.replace('<div class="wrap">', `<div class="wrap" data-tech-collapse data-tech-label="${hit.label}">`);
      marked++;
    } else {
      // h-num / h2 结构：标记加在 section 开标签上
      parts[i] = openTag.replace(/^<section/, '<section data-tech-collapse data-tech-label="' + hit.label + '"');
      marked++;
    }
  }

  if (marked && !DRY) fs.writeFileSync(filePath, parts.join(''), 'utf-8');
  console.log(`  ${marked ? '✅' : '──'} ${file}：标记 ${marked} 个折叠区块${DRY ? ' [dry-run]' : ''}`);
  return marked;
}

function main() {
  console.log(`\n═══ 技术细节折叠标记${DRY ? '（dry-run）' : ''} ═══\n`);
  let total = 0;
  for (const file of Object.keys(TARGETS)) total += markFile(file);
  console.log(`\n完成：共标记 ${total} 个区块\n`);
}

if (require.main === module) main();

module.exports = { TARGETS, main, markFile };
