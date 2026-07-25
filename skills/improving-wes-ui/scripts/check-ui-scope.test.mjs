import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const checker = new URL('./check-ui-scope.mjs', import.meta.url)

function run(cwd, command, args = []) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function write(root, path, content) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'wes-ui-scope-'))
  run(root, 'git', ['init'])
  run(root, 'git', ['config', 'user.email', 'fixture@example.com'])
  run(root, 'git', ['config', 'user.name', 'Fixture'])
  write(root, 'ui/V2_PROTOTYPE/package.json', JSON.stringify({
    dependencies: { react: '^18.3.1' },
  }, null, 2))
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', `
export default function Page() {
  return <button aria-label="刷新">↻</button>
}
`)
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['commit', '-m', 'baseline'])
  return root
}

test('reports newly introduced stack and deterministic UI debt', () => {
  const root = createFixture()
  write(root, 'ui/V2_PROTOTYPE/package.json', JSON.stringify({
    dependencies: {
      react: '^18.3.1',
      '@radix-ui/react-dialog': '^1.1.0',
    },
  }, null, 2))
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', `
export default function Page() {
  return <button style={{ color: '#fff', zIndex: 999 }}>↻</button>
}
function DialogCard() {
  return null
}
`)
  const result = run(root, process.execPath, [checker.pathname, '--base', 'HEAD'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /new-ui-dependency/)
  assert.match(result.stdout, /raw-color/)
  assert.match(result.stdout, /numeric-z-index/)
  assert.match(result.stdout, /icon-button-name/)
  assert.match(result.stdout, /inline-dialog-owner/)
})

test('ignores baseline debt and accepts token-backed accessible changes', () => {
  const root = createFixture()
  const baseline = readFileSync(join(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx'), 'utf8')
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', baseline.replace(
    'aria-label="刷新"',
    'aria-label="重新加载" style={{ color: "var(--brand)" }}'
  ))
  const result = run(root, process.execPath, [checker.pathname, '--base', 'HEAD'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /No new deterministic UI findings/)
})

test('checks explicitly scoped untracked UI files', () => {
  const root = createFixture()
  write(root, 'ui/V2_PROTOTYPE/src/components/Dialog.jsx', `
export function Dialog() {
  return <div style={{ background: '#fff' }} />
}
`)
  const result = run(root, process.execPath, [
    checker.pathname,
    '--base',
    'HEAD',
    '--',
    'ui/V2_PROTOTYPE/src/components/Dialog.jsx',
  ])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /raw-color/)
})
