#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PATHS = ['ui/V2_PROTOTYPE']
const PACKAGE_PATH = 'ui/V2_PROTOTYPE/package.json'
const UI_DEPENDENCY_PATTERNS = [
  /^tailwindcss$/,
  /^@tailwindcss\//,
  /^(?:framer-)?motion$/,
  /^@radix-ui\//,
  /^@base-ui(?:-components)?\//,
  /^react-aria(?:-components)?$/,
  /^@react-aria\//,
  /^@mui\//,
  /^@chakra-ui\//,
  /^antd$/,
  /^@emotion\//,
  /^styled-components$/,
]

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  })

  if (result.error) {
    throw new Error(`Git execution failed: ${result.error.message}`)
  }

  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'unknown Git error').trim()
    throw new Error(detail)
  }

  return result
}

function normalizePath(root, inputPath) {
  const absolute = resolve(root, inputPath)
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  if (absolute !== root && !absolute.startsWith(rootWithSeparator)) {
    throw new Error(`Path escapes repository root: ${inputPath}`)
  }
  return relative(root, absolute).split(sep).join('/')
}

function parseAddedLines(diff) {
  const linesByFile = new Map()
  let currentFile = null
  let nextLine = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6)
      if (!linesByFile.has(currentFile)) linesByFile.set(currentFile, [])
      continue
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      nextLine = Number(hunk[1])
      continue
    }

    if (!currentFile || line.startsWith('diff --git ')) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      linesByFile.get(currentFile).push({
        line: nextLine,
        text: line.slice(1),
      })
      nextLine += 1
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      nextLine += 1
    }
  }

  return linesByFile
}

function readExplicitUntrackedFiles(root, paths, linesByFile) {
  for (const selectedPath of paths) {
    const absolute = resolve(root, selectedPath)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue

    const tracked = git(
      root,
      ['ls-files', '--error-unmatch', '--', selectedPath],
      { allowFailure: true },
    )
    if (tracked.status === 0 || linesByFile.has(selectedPath)) continue

    const lines = readFileSync(absolute, 'utf8').split('\n').map((text, index) => ({
      line: index + 1,
      text,
    }))
    linesByFile.set(selectedPath, lines)
  }
}

function parsePackageJson(content, source) {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error.message}`)
  }
}

function dependenciesOf(manifest) {
  return {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  }
}

function isUiDependency(name) {
  return UI_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(name))
}

function findNewUiDependencies(root, base) {
  const baseResult = git(
    root,
    ['show', `${base}:${PACKAGE_PATH}`],
    { allowFailure: true },
  )
  const workingPath = resolve(root, PACKAGE_PATH)
  if (baseResult.status !== 0 || !existsSync(workingPath)) return []

  const baseDependencies = dependenciesOf(
    parsePackageJson(baseResult.stdout, `${base}:${PACKAGE_PATH}`),
  )
  const workingDependencies = dependenciesOf(
    parsePackageJson(readFileSync(workingPath, 'utf8'), PACKAGE_PATH),
  )

  return Object.keys(workingDependencies)
    .filter((name) => !(name in baseDependencies) && isUiDependency(name))
    .sort()
    .map((name) => ({
      code: 'new-ui-dependency',
      file: PACKAGE_PATH,
      line: 1,
      message: `New UI dependency requires explicit approval: ${name}`,
    }))
}

function obviousIconButtonWithoutName(line) {
  const match = line.match(/<button\b([^>]*)>([^<]*)<\/button>/i)
  if (!match) return false
  const [, attributes, content] = match
  if (/\b(?:aria-label|title)\s*=/.test(attributes)) return false

  const normalized = content.trim()
  if (!normalized) return true
  const lettersOrNumbers = normalized.match(/[\p{L}\p{N}]/gu) || []
  return lettersOrNumbers.length === 0
}

function findingsForAddedLine(file, { line, text }) {
  const findings = []
  const add = (code, message) => findings.push({ code, file, line, message })

  if (
    !/(?:^|\/)tokens\.css$/.test(file)
    && /#[\da-f]{3,8}\b|(?:rgb|hsl)a?\s*\(/i.test(text)
  ) {
    add('raw-color', 'Use an existing semantic color token instead of a raw color.')
  }

  if (/\bzIndex\s*:\s*-?\d+\b|\bz-index\s*:\s*-?\d+\b/i.test(text)) {
    add('numeric-z-index', 'Use the shared layer scale instead of a numeric z-index.')
  }

  if (obviousIconButtonWithoutName(text)) {
    add('icon-button-name', 'Icon-only buttons need an accessible name.')
  }

  if (/\b(?:function|const)\s+Dialog(?:Backdrop|Card)\b/.test(text)) {
    add('inline-dialog-owner', 'Use the shared Dialog instead of adding page-owned dialog helpers.')
  }

  return findings
}

export function analyzeUiScope({
  root = process.cwd(),
  base = 'HEAD',
  paths = DEFAULT_PATHS,
} = {}) {
  const repositoryRoot = resolve(root)
  if (!base || base.startsWith('-')) {
    throw new Error('Invalid --base value.')
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('At least one path is required.')
  }

  const selectedPaths = paths.map((path) => normalizePath(repositoryRoot, path))
  const diff = git(repositoryRoot, [
    'diff',
    '--unified=0',
    '--no-ext-diff',
    base,
    '--',
    ...selectedPaths,
  ]).stdout
  const linesByFile = parseAddedLines(diff)
  readExplicitUntrackedFiles(repositoryRoot, selectedPaths, linesByFile)

  const findings = []
  for (const [file, lines] of linesByFile) {
    for (const addedLine of lines) {
      findings.push(...findingsForAddedLine(file, addedLine))
    }
  }
  findings.push(...findNewUiDependencies(repositoryRoot, base))

  findings.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.code.localeCompare(right.code)
  ))

  return {
    findings,
    checkedFiles: [...linesByFile.keys()].sort(),
  }
}

function parseArguments(argv) {
  let base = 'HEAD'
  let paths = DEFAULT_PATHS
  let index = 0

  while (index < argv.length) {
    const argument = argv[index]
    if (argument === '--base') {
      const value = argv[index + 1]
      if (!value || value === '--') throw new Error('--base requires a value.')
      base = value
      index += 2
      continue
    }
    if (argument === '--') {
      paths = argv.slice(index + 1)
      if (paths.length === 0) throw new Error('The -- separator must be followed by a path.')
      break
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return { base, paths }
}

function runCli() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = analyzeUiScope(options)

    if (result.findings.length === 0) {
      console.log('No new deterministic UI findings.')
      process.exitCode = 0
      return
    }

    for (const finding of result.findings) {
      console.log(`${finding.code} ${finding.file}:${finding.line} ${finding.message}`)
    }
    process.exitCode = 1
  } catch (error) {
    console.error(`check-ui-scope: ${error.message}`)
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
}
