const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')

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
// S3B4 起豁免是「文件 + 值形态」双条件（任务 A）：白名单只对「可豁免形态」（短占位，
// isMeaningfulSecret 判据）生效；命中「真凭据形态」（isCredentialLike：完整 bcrypt /
// 长度与熵超阈值随机串）时**即便文件在白名单内也必须报出并失败**——不再有整文件盲区。
// 唯一例外：条目可带 allowedCredentialFingerprints（sha256 十六进制）按值登记豁免，
// 只豁免该值本身（指纹），非该值的新命中仍然报红。
// 过期自检：文件已删或已不再命中可豁免形态 → 报红（不得让白名单永久躺平）。
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
  // S3B4 任务 B：探针固化的完整 bcrypt 样本（probe-1/2 的 fullHash 常量）按值登记指纹豁免——
  // 测试必须持有真散列形态才能验证检测能力，仅豁免该值本身，其他新命中仍报红。
  { file: 'scripts/check-tracked-secrets.test.js', reason: '自测 fixture apiKey/passwordHash（unit-* 占位）+ 完整 bcrypt 样本按值登记指纹', clearCondition: '测试改构非密钥形态后删条目', allowedCredentialFingerprints: ['9aaa24da796108523b71758949edb4a2fc8703acfd8781352dd394e83c89c1c6'] },
  // ── 文档示例（API 契约/方案示例值，非运行配置）──
  { file: '03_技术设计/API与集成/API接口设计-V2.md', reason: '接口文档示例 accessToken: jwt-token', clearCondition: '示例改占位符后删条目' },
  { file: 'docs/superpowers/plans/2026-06-24-wes-agent-rp-018-knowledge-tool.md', reason: '实现计划示例 apiKey: test-key', clearCondition: '示例改占位符后删条目' },
]

// S3B4 任务 C 瘦身登记：原 24 条 → 22 条（−2）。删除的 2 条：package-lock.json ×2
// （express/msw 依赖包名 cookie 误报）——已改用值形态判据（semver 含 ~/^ 前缀）识别包版本号，
// 无需整文件豁免；其余 22 条全部仍命中可豁免形态（短占位），保留。

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
  // 语义版本号（npm 锁文件依赖版本号，S3B4 任务 C：package-lock 的 cookie 字段值是包版本非密钥；
  // 含 ~/^ 范围前缀形态，如 `~0.7.1` / `^1.1.1`）——包名 vs 值形态：值形态判据优先，不靠整文件豁免
  if (/^[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) return false
  if (/^.{1,40}\.\.\.$/.test(normalized)) return false
  return true
}

// 真凭据形态判据（S3B4 任务 A：真凭据形态不可按文件名豁免）：
// ① 完整 bcrypt 散列：$2a$/$2b$/$2y$ + 两位 cost + $ + 22 盐 + 31 散列 = 53 字符（与 BCRYPT_RE 锚定一致）；
// ② 长度与熵超阈值的随机串：长度 ≥ 32 且至少 3 个字符类（小写/大写/数字/符号）。
// 阈值 32 的依据：主流 API key 最短常见形态为 32 位 base64（智谱）；Kimi 48 位、OpenAI 48 位、
// JWT 与完整 bcrypt 均更长；存量测试占位最长实取 25 位（`$2a$10$test-hash-not-real`）——
// 32 位在真凭据与测试占位之间有明确间隙，不误伤既有夹具（users-pg L71 25 位、unit-* 系列均 < 32）。
function isCredentialLike(value) {
  if (typeof value !== 'string') return value != null
  const normalized = value.trim()
  if (!normalized) return false
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(normalized)) return true
  return normalized.length >= 32 && countCharClasses(normalized) >= 3
}

function countCharClasses(value) {
  let classes = 0
  if (/[a-z]/.test(value)) classes += 1
  if (/[A-Z]/.test(value)) classes += 1
  if (/[0-9]/.test(value)) classes += 1
  if (/[^a-zA-Z0-9]/.test(value)) classes += 1
  return classes
}

// 按值登记豁免用指纹（只存 sha256 十六进制，不存明文散列样本）。
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function collectSecretPaths(value, prefix = '', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretPaths(item, `${prefix}[${index}]`, findings))
    return findings
  }
  if (!value || typeof value !== 'object') return findings
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key
    if (SECRET_KEYS.has(key.toLowerCase()) && isMeaningfulSecret(child)) findings.push({ fieldPath, value: child })
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
    for (const hit of collectSecretPaths(parsed)) {
      findings.push({ file: relative, fieldPath: hit.fieldPath, kind: 'json-field', credentialLike: isCredentialLike(hit.value), value: hit.value })
    }
    return findings
  }
  if (!TEXT_EXTENSIONS.has(ext)) return findings
  // 非 JSON：内容形态扫描（bcrypt 散列 + 行内密钥字段）
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    BCRYPT_RE.lastIndex = 0
    const bcryptMatch = BCRYPT_RE.exec(line)
    if (bcryptMatch) {
      findings.push({ file: relative, fieldPath: `L${i + 1}`, kind: 'bcrypt-hash', credentialLike: true, value: bcryptMatch[0] })
      BCRYPT_RE.lastIndex = 0
    }
    for (const m of line.matchAll(INLINE_SECRET_RE)) {
      if (!isMeaningfulSecret(m[1])) continue
      findings.push({ file: relative, fieldPath: `L${i + 1}`, kind: 'inline-secret', credentialLike: isCredentialLike(m[1]), value: m[1] })
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

  // 白名单过期自检：文件已删或已不再命中可豁免形态 → 报红（report-only / 部分扫描不参与判定）。
  // S3B4：只统计可豁免命中（非 credentialLike）——白名单内仅真凭据形态命中不构成「还在命中」，
  // 不应据此判定条目未过期（真凭据命中本来就会报红，条目是无效豁免）。
  const expired = []
  if (!reportOnly && !scoped) {
    const hitFiles = new Set(findings.filter((f) => !f.credentialLike).map((f) => f.file))
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
  const whitelistByFile = new Map(excludedList.map((e) => [e.file, e]))
  // S3B4 核心修复：白名单只豁免「可豁免形态」——真凭据形态（credentialLike）即便文件在白名单内
  // 也必须报出并失败；唯一例外是按值登记指纹（allowedCredentialFingerprints）只豁免该值本身。
  const remaining = reportOnly ? findings : findings.filter((f) => {
    const entry = whitelistByFile.get(f.file)
    if (!entry) return true
    if (!f.credentialLike) return false
    if (entry.allowedCredentialFingerprints?.includes(f.value ? sha256Hex(String(f.value)) : '')) return false
    return true
  })

  if (reportOnly) {
    // 只报告不失败：全量命中清单（不含值），供架构侧决策白名单
    for (const finding of findings) {
      process.stdout.write(`[secret-scan] ${finding.file}:${finding.fieldPath} (${finding.kind})\n`)
    }
    process.stdout.write(`[secret-scan] report-only: ${findings.length} hits\n`)
    return 0
  }

  for (const finding of remaining) {
    const note = finding.credentialLike && excludedSet.has(finding.file)
      ? ' — 该文件虽在白名单，但命中真凭据形态（不可豁免）'
      : ''
    process.stderr.write(`[secret-scan] ${finding.file}:${finding.fieldPath} (${finding.kind})${note}\n`)
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

module.exports = { BCRYPT_RE, INLINE_SECRET_RE, collectSecretPaths, isCredentialLike, runCli, scanFiles, trackedFiles }
