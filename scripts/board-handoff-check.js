#!/usr/bin/env node
/**
 * Handoff 完整性校验脚本
 * 验证外部 AI 交付报告是否符合 handoff template 要求
 *
 * 用法:
 *   node scripts/board-handoff-check.js <handoff-file.md>
 *   node scripts/board-handoff-check.js --stdin    (从标准输入读取)
 *
 * 退出码: 0=通过, 1=存在阻塞问题, 2=仅有警告
 */

const fs = require('fs');
const path = require('path');

// ── Required Sections ──
const REQUIRED_SECTIONS = [
  {
    key: '目标',
    patterns: [/^##\s*目标/m, /^##\s*Goal/m, /^##\s*Objective/m],
    description: '本轮要解决的问题和边界',
    critical: true,
  },
  {
    key: '变更文件',
    patterns: [/^##\s*变更文件/m, /^##\s*Changed\s+Files/m, /^##\s*Files\s+Changed/m],
    description: '新增/修改/删除的文件清单',
    critical: true,
  },
  {
    key: '验证命令与结果',
    patterns: [/^##\s*验证命令与结果/m, /^##\s*Verification/m, /^##\s*验证/m],
    description: '验证命令及 pass/fail 结果',
    critical: true,
  },
  {
    key: '风险',
    patterns: [/^##\s*风险/m, /^##\s*Risks?/m],
    description: '权限/数据/兼容/测试缺口',
    critical: true,
  },
  {
    key: '是否需看板同步',
    patterns: [/^##\s*是否需看板同步/m, /^##\s*Board\s+Sync/m, /^##\s*看板同步/m],
    description: '是否需要同步看板及建议页面',
    critical: false,
  },
  {
    key: '下一步建议',
    patterns: [/^##\s*下一步/m, /^##\s*Next\s+Steps?/m, /^##\s*下一步建议/m],
    description: '继续实现/等待验收/回滚/补测试',
    critical: false,
  },
];

// ── Red Flag Patterns ──
const RED_FLAGS = [
  {
    pattern: /(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*\S+/gi,
    message: '可能包含敏感信息（API Key / Token / Secret）',
  },
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    message: '检测到疑似 API Key 字符串',
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36,}/g,
    message: '检测到疑似 GitHub Token',
  },
];

// ── Quality Checks ──
function checkSectionContent(content, sectionMatch) {
  // Extract content between this section header and the next ## header
  const startIdx = sectionMatch.index + sectionMatch[0].length;
  const nextHeader = content.slice(startIdx).match(/^##\s/m);
  const sectionContent = nextHeader
    ? content.slice(startIdx, startIdx + nextHeader.index)
    : content.slice(startIdx);

  const trimmed = sectionContent.trim();
  const issues = [];

  if (!trimmed) {
    issues.push('章节内容为空');
  } else if (trimmed.length < 10) {
    issues.push('章节内容过短（< 10 字符），可能不够具体');
  }

  return { content: trimmed, issues };
}

function checkFileReferences(content) {
  // Check if changed files section references actual file paths
  const filePattern = /^[-*]\s*`?[\w./-]+\.(?:ts|tsx|js|jsx|html|css|md|json|yaml|yml|py|sh)`?/gm;
  const matches = content.match(filePattern) || [];
  return matches.length;
}

function checkVerificationContent(content) {
  // Check if verification section has command + result format
  const cmdPattern = /`[^`]+`/g;
  const passFailPattern = /(?:pass|fail|通过|失败|✅|❌|ok|error)/gi;
  const cmds = content.match(cmdPattern) || [];
  const results = content.match(passFailPattern) || [];
  return { cmdCount: cmds.length, resultCount: results.length };
}

// ── Main Validation ──
function validate(content, filename) {
  const errors = [];
  const warnings = [];
  const info = [];

  // 1. Check required sections
  for (const section of REQUIRED_SECTIONS) {
    let found = false;
    let match = null;
    for (const pattern of section.patterns) {
      match = content.match(pattern);
      if (match) {
        found = true;
        break;
      }
    }

    if (!found) {
      if (section.critical) {
        errors.push(`缺少必要章节「${section.key}」— ${section.description}`);
      } else {
        warnings.push(`缺少建议章节「${section.key}」— ${section.description}`);
      }
    } else {
      // Check content quality
      const { content: sectionContent, issues } = checkSectionContent(content, match);
      for (const issue of issues) {
        if (section.critical) {
          errors.push(`「${section.key}」${issue}`);
        } else {
          warnings.push(`「${section.key}」${issue}`);
        }
      }
      info.push(`✅ 「${section.key}」已填写 (${sectionContent.length} 字符)`);
    }
  }

  // 2. Check file references
  const fileCount = checkFileReferences(content);
  if (fileCount === 0) {
    warnings.push('变更文件章节未检测到文件路径引用（建议使用 `- path/to/file: 描述` 格式）');
  } else {
    info.push(`📁 检测到 ${fileCount} 个文件引用`);
  }

  // 3. Check verification content
  const verifSection = content.match(/^##\s*(?:验证命令与结果|Verification|验证)/m);
  if (verifSection) {
    const { content: verifContent } = checkSectionContent(content, verifSection);
    const { cmdCount, resultCount } = checkVerificationContent(verifContent);
    if (cmdCount === 0) {
      warnings.push('验证章节未检测到命令（建议使用 `` `command` `` 格式）');
    }
    if (resultCount === 0) {
      warnings.push('验证章节未检测到 pass/fail 结果标记');
    }
    if (cmdCount > 0 && resultCount > 0) {
      info.push(` 验证章节: ${cmdCount} 条命令, ${resultCount} 条结果`);
    }
  }

  // 4. Check red flags
  for (const flag of RED_FLAGS) {
    const matches = content.match(flag.pattern);
    if (matches) {
      errors.push(`🚨 ${flag.message} — 请移除敏感信息后再提交`);
    }
  }

  // 5. Check for "已完成" without details (anti-pattern from template)
  if (/^##\s*目标[\s\S]{0,200}已完成[\s\S]{0,50}(?!文件|验证|风险)/m.test(content)) {
    warnings.push('⚠️ 目标章节仅写"已完成"，缺少具体问题描述和边界');
  }

  return { errors, warnings, info, filename };
}

// ── Output ──
function printReport(result) {
  const { errors, warnings, info, filename } = result;
  const total = errors.length + warnings.length + info.length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Handoff 完整性校验报告`);
  console.log(`  文件: ${filename}`);
  console.log(`${'═'.repeat(60)}\n`);

  if (errors.length > 0) {
    console.log(`❌ 阻塞问题 (${errors.length}):`);
    for (const e of errors) console.log(`   • ${e}`);
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`⚠️  建议改进 (${warnings.length}):`);
    for (const w of warnings) console.log(`   • ${w}`);
    console.log();
  }

  if (info.length > 0) {
    console.log(` 检查通过项 (${info.length}):`);
    for (const i of info) console.log(`   ${i}`);
    console.log();
  }

  console.log(`${'─'.repeat(60)}`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 校验通过 — 无问题');
  } else if (errors.length === 0) {
    console.log(`️  通过但有 ${warnings.length} 条建议`);
  } else {
    console.log(`❌ 不通过 — ${errors.length} 个阻塞问题需修复`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

// ─ Main ──
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Handoff 完整性校验脚本

用法:
  node scripts/board-handoff-check.js <handoff-file.md>   校验指定文件
  node scripts/board-handoff-check.js --stdin             从标准输入读取
  node scripts/board-handoff-check.js --all               校验 docs/codex-workflows/ 下所有 .md 文件

校验规则:
  • 6 个必要/建议章节是否齐全
  • 章节内容是否有实质性内容
  • 文件引用格式是否正确
  • 验证命令与结果是否配对
  • 是否包含敏感信息（API Key / Token）
  • 是否违反"不接受的回填"规则
`);
    process.exit(0);
  }

  let content, filename;

  if (args.includes('--stdin')) {
    content = fs.readFileSync(0, 'utf-8');
    filename = '<stdin>';
  } else if (args.includes('--all')) {
    const docsDir = path.resolve(__dirname, '..', 'docs', 'codex-workflows');
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && f !== 'external-ai-handoff-template.md');
    let hasErrors = false;
    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const result = validate(fileContent, file);
      printReport(result);
      if (result.errors.length > 0) hasErrors = true;
    }
    process.exit(hasErrors ? 1 : 0);
  } else {
    filename = args[0];
    const filePath = path.resolve(filename);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const result = validate(content, filename);
  printReport(result);

  if (result.errors.length > 0) process.exit(1);
  if (result.warnings.length > 0) process.exit(2);
  process.exit(0);
}

main();
