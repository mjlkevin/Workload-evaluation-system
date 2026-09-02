const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'cookie',
  'passwordhash',
])

// 内容形态（非 JSON 文件）：完整 bcrypt 散列（$2a$/$2b$/$2y$ + 22 盐 + 31 散列 = 53 字符）。
// 长度判据天然排除测试夹具形态（$2a$10$hash / test-hash-not-real 等短占位）。
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g

// 内容形态：行内密钥字段赋值（捕获值后经 isMeaningfulSecret 判占位，不含值打印，只报位置）。
const INLINE_SECRET_RE =
  /["']?(?:apiKey|api_key|clientSecret|client_secret|accessToken|access_token|refreshToken|refresh_token|privateKey|private_key|passwordHash)["']?\s*[:=]\s*["']([^"'\n]+)/g

// 白名单（EXCLUDED 口径，同防漂移守卫）：每条 { file, reason, clearCondition }。
// 过期自检：文件已删或已不再命中 → 报红（不得让白名单永久躺平）。
// 条目来源：S3B3 report-only 全量清单（120 hits）逐条判定——真凭据仅归档 users.json（已移出跟踪），
// 其余为测试夹具 / 文档示例 / 锁文件包名误报，全部显式登记。
const EXCLUDED = [
  // ── 测试夹具（断言输入值，非真实凭据；文件已删或夹具形态消失即删条目）──
  { file: 'apps/api/src/ai/provider/tool-calling.test.ts', reason: '测试夹具 apiKey: test-key 等', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/agent/default-registry.test.ts', reason: '测试夹具 passwordHash: hash 等短占位', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/memory/memory.distiller.test.ts', reason: '测试夹具 apiKey: fake 等短占位', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/ai-sessions/ai-sessions.usecase.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/auth/users-pg.repository.test.ts', reason: '测试夹具 passwordHash: $2a$10$hash 等', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/modules.handlers.test.ts', reason: '测试夹具 apiKey: zhipu-unit-* 等', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/system/knowledge-base-access-probe.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/system/system-pg.repository.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/system/system.kb-config.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/system/system.repository.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/modules/trace/trace.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/chat.service.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/eval/runner.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/handlers/handlers.unit.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/knowledge-tool.service.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/o10-bc.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/rag-baseline/rag-baseline-report.repository.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/rag-baseline/rag-baseline-runner.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/workbench-chip-trace.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/workbench-dispatch.service.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/services/ai/workbench-routing.snapshot.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  { file: 'apps/api/src/utils/kimi-ping.test.ts', reason: '测试夹具', clearCondition: '该文件删除或改用非密钥形态常量' },
  // ── 扫描器自测（fixture 必须像密钥才能验证检测能力）──
  { file: 'scripts/check-tracked-secrets.test.js', reason: '自测 fixture apiKey/passwordHash（unit-* 占位）', clearCondition: '测试改构非密钥形态后删条目' },
  // ── 文档示例（API 契约/方案示例值，非运行配置）──
  { file: '03_技术设计/API与集成/API接口设计-V2.md', reason: '接口文档示例 accessToken: jwt-token', clearCondition: '示例改占位符后删条目' },
  { file: 'docs/superpowers/plans/2026-06-24-wes-agent-rp-018-knowledge-tool.md', reason: '实现计划示例 apiKey: test-key', clearCondition: '示例改占位符后删条目' },
  // ── npm 锁文件（机器生成，cookie 等字段名是依赖包名非密钥）──
  { file: 'package-lock.json', reason: 'npm 锁文件包名 cookie 误报（express 依赖）', clearCondition: 'express 移除 cookie 依赖后删条目' },
  { file: 'ui/V2_PROTOTYPE/package-lock.json', reason: 'npm 锁文件包名 cookie 误报（msw 依赖）', clearCondition: 'msw 移除 cookie 依赖后删条目' },
]

// 文本扩展名集合：其余扩展名按内容判二进制（含 NUL 即跳过，如 xlsx/zip/png）。
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.json', '.md', '.yml', '.yaml', '.html', '.css', '.sh', '.txt',
  '.env', '.example', '.tsv', '.csv', '.ini', '.toml', '.conf',
  '.svg', '.xml', '.lock',
])

function isMeaningfulSecret(value) {
  if (typeof value !== 'string') return value != null
  const normalized = value.trim()
  if (!normalized) return false
  // 占位形态：masked/redacted/placeholder/example/changeme/${env} 引用/$ENV_REF 引用/…结尾的截断示例
  if (/^(?:masked|redacted|placeholder|example|changeme|\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*)$/i.test(normalized)) return false
  // 全大写蛇形环境变量名（区分大小写，避免 /i 把 fake/hash 等短占位也吞掉）
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(normalized)) return false
  if (/^.{1,40}\.\.\.$/.test(normalized)) return false
  return true
}

function collectSecretPaths(value, prefix = '', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretPaths(item, `${prefix}[${index}]`, findings))
    return findings
  }
  if (!value || typeof value !== 'object') return findings
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key
    if (SECRET_KEYS.has(key.toLowerCase()) && isMeaningfulSecret(child)) findings.push(fieldPath)
    if (child && typeof child === 'object') collectSecretPaths(child, fieldPath, findings)
  }
  return findings
}

/** git ls-files 全集（S3B3 起扫描面为全仓跟踪文件，不再限于 config/）。 */
function trackedFiles(cwd) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git_ls_files_failed')
  return result.stdout.split('\0').filter(Boolean)
}

function isBinary(content) {
  return content.includes(0)
}

function scanFile(filePath, cwd) {
  const relative = path.relative(cwd, filePath) || path.basename(filePath)
  const findings = []
  const ext = path.extname(filePath).toLowerCase()
  const content = fs.readFileSync(filePath)
  if (isBinary(content)) return findings
  const text = content.toString('utf8')
  if (ext === '.json') {
    // JSON：字段名递归扫描（SECRET_KEYS）
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return findings
    }
    for (const fieldPath of collectSecretPaths(parsed)) {
      findings.push({ file: relative, fieldPath, kind: 'json-field' })
    }
    return findings
  }
  if (!TEXT_EXTENSIONS.has(ext)) return findings
  // 非 JSON：内容形态扫描（bcrypt 散列 + 行内密钥字段）
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (BCRYPT_RE.test(line)) {
      findings.push({ file: relative, fieldPath: `L${i + 1}`, kind: 'bcrypt-hash' })
      BCRYPT_RE.lastIndex = 0
    }
    for (const m of line.matchAll(INLINE_SECRET_RE)) {
      if (!isMeaningfulSecret(m[1])) continue
      findings.push({ file: relative, fieldPath: `L${i + 1}`, kind: 'inline-secret' })
    }
  }
  return findings
}

function scanFiles(paths, cwd = process.cwd()) {
  const findings = []
  for (const candidate of paths) {
    const filePath = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate)
    if (!fs.existsSync(filePath)) continue
    findings.push(...scanFile(filePath, cwd))
  }
  return findings
}

function runCli(argv = process.argv.slice(2), cwd = process.cwd(), options = {}) {
  const reportOnly = argv.includes('--report-only')
  const excludedList = options.excluded || EXCLUDED
  const explicitPaths = argv.filter((a) => a !== '--report-only')
  // 默认全仓模式：git ls-files 全集；显式传路径（部分扫描）时不做白名单过期检查
  //（部分扫描无法判定「不再命中」，过期自检是全仓模式的职责）
  const scoped = explicitPaths.length > 0
  const paths = scoped ? explicitPaths : trackedFiles(cwd)
  const findings = scanFiles(paths, cwd)

  // 白名单过期自检：文件已删或已不再命中 → 报红（report-only / 部分扫描不参与判定）
  const expired = []
  if (!reportOnly && !scoped) {
    const hitFiles = new Set(findings.map((f) => f.file))
    for (const entry of excludedList) {
      if (!entry.reason || !entry.clearCondition) {
        expired.push(`白名单条目 ${entry.file} 必须写明 reason 与 clearCondition`)
        continue
      }
      const abs = path.resolve(cwd, entry.file)
      if (!fs.existsSync(abs)) {
        expired.push(`白名单条目 ${entry.file} 已不存在（文件已删除），本条应一并删除`)
        continue
      }
      if (!hitFiles.has(entry.file)) {
        expired.push(`白名单条目 ${entry.file} 已不再命中任何密钥形态，本条应删除`)
      }
    }
  }

  const excludedSet = new Set(reportOnly ? [] : excludedList.map((e) => e.file))
  const remaining = reportOnly ? findings : findings.filter((f) => !excludedSet.has(f.file))

  if (reportOnly) {
    // 只报告不失败：全量命中清单（不含值），供架构侧决策白名单
    for (const finding of findings) {
      process.stdout.write(`[secret-scan] ${finding.file}:${finding.fieldPath} (${finding.kind})\n`)
    }
    process.stdout.write(`[secret-scan] report-only: ${findings.length} hits\n`)
    return 0
  }

  for (const finding of remaining) {
    process.stderr.write(`[secret-scan] ${finding.file}:${finding.fieldPath} (${finding.kind})\n`)
  }
  for (const line of expired) {
    process.stderr.write(`[secret-scan] whitelist-expired: ${line}\n`)
  }
  if (remaining.length || expired.length) return 1
  process.stdout.write('[secret-scan] no tracked secret fields found\n')
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = runCli()
  } catch (error) {
    process.stderr.write(`[secret-scan] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { BCRYPT_RE, INLINE_SECRET_RE, collectSecretPaths, runCli, scanFiles, trackedFiles }
