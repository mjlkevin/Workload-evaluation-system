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

// 显式白名单：已知含密字段的文件级豁免（文件仍参与扫描，仅豁免指定字段）。
// 到期条件（阶段 2 必须执行，勿遗忘）：users 存储切换 PG 后，
// 从 git 移除 config/auth/users.json 并删除本白名单条目。
// 在此之前保留 passwordHash 扫描键——任何新增文件若含该键会立即暴露。
const FIELD_ALLOWLIST = new Map([
  ['config/auth/users.json', new Set(['passwordhash'])],
])

function isMeaningfulSecret(value) {
  if (typeof value !== 'string') return value != null
  const normalized = value.trim()
  if (!normalized) return false
  return !/^(?:masked|redacted|placeholder|example|changeme|\$\{[^}]+\})$/i.test(normalized)
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

function trackedConfigJsonFiles(cwd) {
  const result = spawnSync('git', ['ls-files', '-z', '--', 'config/**/*.json', 'config/*.json'], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git_ls_files_failed')
  return result.stdout.split('\0').filter(Boolean)
}

function scanFiles(paths, cwd = process.cwd()) {
  const findings = []
  for (const candidate of paths) {
    const filePath = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate)
    if (!fs.existsSync(filePath)) continue
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const relative = path.relative(cwd, filePath) || path.basename(filePath)
    const allowedKeys = FIELD_ALLOWLIST.get(relative)
    for (const fieldPath of collectSecretPaths(parsed)) {
      const leafKey = fieldPath.split('.').pop().toLowerCase()
      if (allowedKeys && allowedKeys.has(leafKey)) continue
      findings.push({ file: relative, fieldPath })
    }
  }
  return findings
}

function runCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const paths = argv.length ? argv : trackedConfigJsonFiles(cwd)
  const findings = scanFiles(paths, cwd)
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`[secret-scan] ${finding.file}:${finding.fieldPath}\n`)
    return 1
  }
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

module.exports = { collectSecretPaths, runCli, scanFiles, trackedConfigJsonFiles }
