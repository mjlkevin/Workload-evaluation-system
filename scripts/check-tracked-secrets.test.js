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
