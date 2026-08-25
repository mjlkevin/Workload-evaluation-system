const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const script = path.join(__dirname, 'check-tracked-secrets.js')

function runScanner(paths) {
  return spawnSync(process.execPath, [script, ...paths], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  })
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
