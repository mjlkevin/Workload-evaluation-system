const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const script = path.join(__dirname, 'check-tracked-secrets.js')
const scanner = require('./check-tracked-secrets.js')

function runScanner(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  })
}

/** 临时 git 仓库（git init + 写文件 + git add，无需 commit 即可被 git ls-files 列出）。 */
function makeTempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-secret-scan-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const git = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (git.status !== 0) throw new Error(git.stderr.trim() || 'git init failed')
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' })
  return dir
}

test('missing ignored runtime config is skipped', () => {
  const result = runScanner(['config/system/not-created.json'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /no tracked secret fields/i)
})

test('reports a secret path without printing the secret value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-secret-scan-'))
  const file = path.join(dir, 'fixture.json')
  fs.writeFileSync(file, JSON.stringify({ credentials: { apiKey: 'unit-secret-value' } }))

  const result = runScanner([file])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /credentials\.apiKey/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unit-secret-value/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('detects passwordHash as a secret field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-secret-scan-'))
  const file = path.join(dir, 'fixture.json')
  fs.writeFileSync(file, JSON.stringify({ users: [{ passwordHash: '$2b$10$unit-hash-value' }] }))

  const result = runScanner([file])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /users\[0\]\.passwordHash/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /unit-hash-value/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('report-only mode lists all hits but exits 0', () => {
  const repo = makeTempRepo({ 'credentials.json': JSON.stringify({ apiKey: 'repo-secret-value' }) })
  try {
    const result = spawnSync(process.execPath, [script, '--report-only'], {
      cwd: repo,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /credentials\.json:apiKey/)
    assert.match(result.stdout, /report-only: 1 hits/)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('content-form scan catches a full bcrypt hash in a non-JSON file', () => {
  const fullHash = '$2b$10$o7e5XNPyMl90S.yt.0AN4OV9vRHwODus0ENXfw3QUB45Uz0HUypnC'
  const repo = makeTempRepo({ 'seed.ts': `const hash = '${fullHash}'\n` })
  try {
    // 显式路径 = 部分扫描（跳过白名单过期检查），只验内容形态命中
    const result = spawnSync(process.execPath, [script, 'seed.ts'], { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /seed\.ts:L1 \(bcrypt-hash\)/)
    assert.doesNotMatch(result.stderr, /o7e5XNPyMl90S/)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('short bcrypt placeholders and env/doc reference values are not flagged', () => {
  const repo = makeTempRepo({
    'fixture.ts': [
      "const a = '$2a$10$hash'",
      "const b = '$2b$10$test-hash-not-real'",
      "const c = api_key: '$MOONSHOT_API_KEY'",
      "const d = apiKey: 'MOONSHOT_API_KEY'",
      "const e = apiKey: 'sk-abc...'",
    ].join('\n'),
  })
  try {
    // 显式路径 = 部分扫描（跳过白名单过期检查），只验占位形态全部豁免
    const result = spawnSync(process.execPath, [script, 'fixture.ts'], { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /no tracked secret fields/i)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('whitelist entry with an active hit passes and does not expire', () => {
  const repo = makeTempRepo({ 'data.ts': "const key = apiKey: 'real-looking-value'\n" })
  const excluded = [{ file: 'data.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 0)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('whitelist entry whose file no longer hits is reported as expired', () => {
  const repo = makeTempRepo({ 'data.ts': 'const x = 1\n' })
  const excluded = [{ file: 'data.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 1)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('whitelist entry for a deleted file is reported as expired', () => {
  const repo = makeTempRepo({ 'other.ts': 'const x = 1\n' })
  const excluded = [{ file: 'gone.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 1)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('whitelist entry missing reason or clearCondition is reported', () => {
  const repo = makeTempRepo({ 'data.ts': "const key = apiKey: 'real-looking-value'\n" })
  const excluded = [{ file: 'data.ts' }]
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 1)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

// ── 批 4：白名单整文件盲区对照探针（架构侧 2026-09-01 独立探针固化，S3B4 核心验收证据）──
// 探针原始形态：完整 bcrypt 散列追加进白名单文件 → 批 3 扫描报 `no tracked secret fields found` + EXIT=0，
// 即白名单是整文件永久盲区。本批修复 = 豁免粒度按「值形态」而非「文件名」：
// 真凭据形态（完整 bcrypt / 高熵长随机串）即使文件在白名单内也必须报出并失败。
// 断言无条件形态（§4.11 A-1/A-2/A-3），fixture 全部用临时文件（用完即删），不往仓库塞散列样本。

test('probe-1: full bcrypt in a non-whitelisted file is reported and fails', () => {
  const fullHash = '$2b$10$o7e5XNPyMl90S.yt.0AN4OV9vRHwODus0ENXfw3QUB45Uz0HUypnC'
  const repo = makeTempRepo({ 'probe.ts': `const hash = '${fullHash}'\n` })
  try {
    const result = spawnSync(process.execPath, [script, 'probe.ts'], { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /probe\.ts:L1 \(bcrypt-hash\)/)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('probe-2: full bcrypt in a WHITELISTED file is still reported and fails (S3B4 core)', () => {
  const fullHash = '$2b$10$o7e5XNPyMl90S.yt.0AN4OV9vRHwODus0ENXfw3QUB45Uz0HUypnC'
  const repo = makeTempRepo({ 'whitelisted.ts': `const hash = '${fullHash}'\n` })
  const excluded = [{ file: 'whitelisted.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  const realWrite = process.stderr.write.bind(process.stderr)
  let output = ''
  process.stderr.write = (chunk) => {
    output += String(chunk)
    return true
  }
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 1, output)
    assert.match(output, /whitelisted\.ts:L1 \(bcrypt-hash\)/)
    assert.match(output, /虽在白名单，但命中真凭据形态/)
  } finally {
    process.stderr.write = realWrite
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('probe-3: short placeholder in a whitelisted file passes', () => {
  const repo = makeTempRepo({ 'whitelisted.ts': "const key = apiKey: 'test-key'\n" })
  const excluded = [{ file: 'whitelisted.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 0, '白名单内短占位应放行')
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('probe-4: short placeholder in a non-whitelisted file is reported (existing behavior)', () => {
  const repo = makeTempRepo({ 'plain.ts': "const key = apiKey: 'test-key'\n" })
  try {
    const status = scanner.runCli([], repo, { excluded: [] })
    assert.equal(status, 1, '短占位在非白名单文件按现有口径报出，保持不变')
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

// ── S3B4M（2026-09-02）：阈值 32→26 收窄的两条钉住自测 ──
// 依据（架构侧实取）：存量占位最长 25 位 → 26 是不误伤下界；主流 key 最短 32 位 → 26 在
// 真凭据最短形态与占位上界之间。probe-5 钉「26 位必须报红」（白名单内也报），
// probe-6 钉「存量占位 ≤ 25」（将来有人加长占位即红，阈值依据失效有人发现）。

test('probe-5: 26-char mixed-class value in a WHITELISTED file is reported and fails (threshold floor)', () => {
  const value = 'Ab1xxxxxxxxxxxxxxxxxxxxxxx' // 26 位：小写+大写+数字 3 个字符类，无符号
  const repo = makeTempRepo({ 'whitelisted.ts': `const key = apiKey: '${value}'\n` })
  const excluded = [{ file: 'whitelisted.ts', reason: '测试', clearCondition: '文件删除后删条目' }]
  const realWrite = process.stderr.write.bind(process.stderr)
  let output = ''
  process.stderr.write = (chunk) => {
    output += String(chunk)
    return true
  }
  try {
    const status = scanner.runCli([], repo, { excluded })
    assert.equal(status, 1, output)
    assert.match(output, /whitelisted\.ts:L1 \(inline-secret\)/)
    assert.match(output, /虽在白名单，但命中真凭据形态/)
  } finally {
    process.stderr.write = realWrite
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

test('probe-6: existing placeholder values never exceed 25 chars (threshold 26 floor evidence)', () => {
  // 全仓扫描（内存 API，不打印值）：统计所有可豁免命中（非 credentialLike）的值长度上界。
  // 断言 ≤ 25 —— 钉住阈值 26 的依据 a（存量占位最长实取 25 位，users-pg L71）；
  // 将来有人加长占位即红，提醒阈值依据失效需重新评估（重新评估阈值，而非删断言）。
  const root = path.resolve(__dirname, '..')
  const findings = scanner.scanFiles(scanner.trackedFiles(root), root)
  const placeholderLens = findings
    .filter((f) => !scanner.isCredentialLike(f.value))
    .map((f) => String(f.value ?? '').length)
  const maxLen = Math.max(0, ...placeholderLens)
  assert.ok(maxLen <= 25, `存量占位最长 ${maxLen} 位 > 25，阈值 26 的依据失效（需重新评估阈值而非删断言）`)
})

test('content-form scan catches backtick-delimited apiKey (ruling E)', () => {
  // 裁决 E：INLINE_SECRET_RE 分隔符须覆盖反引号（JS 模板字面量 / .env 常见形态）。
  // 修复前此形态漏检；修复后应报 1 hit（值经 isMeaningfulSecret 判非占位）。
  const repo = makeTempRepo({
    'config.ts': 'const cfg = { apiKey: `sk-fake-fixture-abcdefgh` }\n',
  })
  try {
    const result = spawnSync(process.execPath, [script, 'config.ts'], { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 1, `expected exit 1 but got ${result.status}: ${result.stderr}`)
    assert.match(result.stderr, /config\.ts:L1.*inline-secret/)
    assert.doesNotMatch(result.stderr, /sk-fake-fixture-abcdefgh/)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})
