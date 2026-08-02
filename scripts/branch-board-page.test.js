const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.join(__dirname, '..');
const BOARD_DIR = path.join(PROJECT_ROOT, '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const PAGE_PATH = path.join(BOARD_DIR, 'branches.html');
const CSS_PATH = path.join(BOARD_DIR, 'assets', 'branch-topology.css');
const RENDERER_PATH = path.join(BOARD_DIR, 'assets', 'branch-topology.js');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function createTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wes-branch-board-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

function directoryManifest(directory) {
  if (!fs.existsSync(directory)) return null;
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        files.push([
          path.relative(directory, entryPath),
          crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex'),
        ]);
      }
    }
  }
  visit(directory);
  return files.sort(([left], [right]) => left.localeCompare(right));
}

function branch(overrides = {}) {
  return {
    branchName: 'codex/rp-045',
    headFull: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headShort: 'aaaaaaa',
    subject: 'board renderer',
    author: 'Kevin',
    committerDate: '2026-08-02T12:00:00+08:00',
    gitRelation: 'non_ancestor',
    ahead: 2,
    behind: 1,
    worktreePath: '',
    worktreeDirty: '',
    upstream: '',
    upstreamTrack: '',
    prefix: 'codex',
    duplicateTipGroup: '',
    governanceSuggestion: '待确认集成、返工或归档',
    ...overrides,
  };
}

function validSnapshot(overrides = {}) {
  const mainline = branch({
    branchName: 'main',
    gitRelation: 'current',
    prefix: 'other',
    ahead: 0,
    behind: 0,
    worktreePath: '/repo',
    worktreeDirty: 'clean',
    governanceSuggestion: '保留主线',
  });
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-02T12:00:00.000Z',
    repoRoot: '/repo',
    mainBranch: 'main',
    summary: {
      localBranchCount: 1,
      remoteRefCount: 1,
      worktreeCount: 1,
      ancestorCount: 0,
      nonAncestorCount: 0,
      duplicateTipGroupCount: 1,
      warningCount: 1,
    },
    branches: [mainline],
    remoteRefs: [{
      branchName: 'origin/HEAD',
      headFull: mainline.headFull,
      headShort: mainline.headShort,
      refKind: 'remote_tracking',
      symbolicTarget: 'origin/main',
      isSymbolic: true,
      subject: mainline.subject,
      committerDate: mainline.committerDate,
    }],
    worktrees: [{
      path: '/repo',
      headFull: mainline.headFull,
      branchName: 'main',
      detached: false,
      locked: false,
      prunable: false,
    }],
    duplicateTipGroups: [{
      id: 'duplicate-aaaaaaa',
      headFull: mainline.headFull,
      branches: ['main', 'legacy/main'],
    }],
    warnings: ['fixture warning'],
    governance: { defaultRemote: 'origin', staleAfterDays: 30 },
    provenance: {
      semantics: 'as_of_generation',
      sourceCheckoutBranch: 'codex/rp-045-branch-board',
      sourceCheckoutHead: mainline.headFull,
      configuredMainlineHead: mainline.headFull,
      observationNote: 'As-of-generation observation.',
    },
    ...overrides,
  };
}

function alertDocument() {
  const attributes = new Map();
  const status = {
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { attributes.set(name, value); },
    textContent: '',
  };
  return {
    attributes,
    status,
    documentRef: {
      getElementById(id) { return id === 'branch-status' ? status : null; },
    },
  };
}

class MiniElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.value = '';
    this._textContent = '';
    this.classList = {
      contains: (name) => this.className.split(/\s+/).filter(Boolean).includes(name),
      add: (name) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        names.add(name);
        this.className = [...names].join(' ');
      },
      remove: (name) => {
        this.className = this.className.split(/\s+/).filter((value) => value && value !== name).join(' ');
      },
    };
  }

  get firstChild() { return this.children[0] || null; }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const payload = typeof event === 'string' ? { type: event } : event;
    for (const listener of this.listeners.get(payload.type) || []) listener.call(this, payload);
    return true;
  }

  click() { this.dispatchEvent({ type: 'click' }); }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    return descendants(this).filter((node) => matchesSelectorChain(node, parts));
  }
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function matchesSimpleSelector(node, selector) {
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function matchesSelectorChain(node, parts) {
  if (!matchesSimpleSelector(node, parts[parts.length - 1])) return false;
  let ancestor = node.parentNode;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (ancestor && !matchesSimpleSelector(ancestor, parts[index])) ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

class MiniDocument {
  constructor() {
    this.body = new MiniElement(this, 'body');
  }

  createElement(tagName) { return new MiniElement(this, tagName); }

  getElementById(id) {
    return [this.body, ...descendants(this.body)].find((node) => node.id === id) || null;
  }

  querySelector(selector) { return this.body.querySelector(selector); }

  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
}

function mountDocument() {
  const documentRef = new MiniDocument();
  const elements = new Map();
  const specs = [
    ['branch-status', 'div'],
    ['snapshot-header', 'div'],
    ['branch-kpis', 'div'],
    ['branch-topology', 'div'],
    ['branch-ledger', 'div'],
    ['remote-refs', 'div'],
    ['snapshot-warnings', 'div'],
    ['branch-search', 'input'],
    ['relation-filter', 'select'],
    ['worktree-filter', 'select'],
    ['prefix-filter', 'select'],
    ['governance-filter', 'select'],
    ['branch-result-count', 'p'],
  ];
  for (const [id, tagName] of specs) {
    const node = documentRef.createElement(tagName);
    node.id = id;
    documentRef.body.appendChild(node);
    elements.set(id, node);
  }
  return { documentRef, elements };
}

function representativeSnapshot() {
  const base = validSnapshot();
  const activeAncestor = branch({
    branchName: 'qoder/active-ancestor',
    headFull: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    headShort: 'bbbbbbb',
    gitRelation: 'ancestor',
    ahead: 0,
    behind: 4,
    prefix: 'qoder',
    worktreePath: '/repo/active-ancestor',
    worktreeDirty: 'dirty',
    governanceSuggestion: '活跃工作区，先复核任务状态',
  });
  const scriptLikeName = 'codex/<script>window.injected=true</script>';
  const nonAncestor = branch({
    branchName: scriptLikeName,
    headFull: 'cccccccccccccccccccccccccccccccccccccccc',
    headShort: 'ccccccc',
    duplicateTipGroup: 'duplicate-ccccccc',
  });
  const history = branch({
    branchName: 'feature/history',
    headFull: 'dddddddddddddddddddddddddddddddddddddddd',
    headShort: 'ddddddd',
    gitRelation: 'ancestor',
    ahead: 0,
    behind: 9,
    prefix: 'feature',
    duplicateTipGroup: 'duplicate-ccccccc',
    governanceSuggestion: '可评估归档或清理',
  });
  return validSnapshot({
    branches: [base.branches[0], activeAncestor, nonAncestor, history],
    worktrees: [
      base.worktrees[0],
      {
        path: activeAncestor.worktreePath,
        headFull: activeAncestor.headFull,
        branchName: activeAncestor.branchName,
        detached: false,
        locked: false,
        prunable: false,
      },
    ],
    duplicateTipGroups: [{
      id: 'duplicate-ccccccc',
      headFull: nonAncestor.headFull,
      branches: [nonAncestor.branchName, history.branchName],
    }],
    summary: {
      localBranchCount: 4,
      remoteRefCount: 1,
      worktreeCount: 2,
      ancestorCount: 2,
      nonAncestorCount: 1,
      duplicateTipGroupCount: 1,
      warningCount: 1,
    },
  });
}

test('branches page provides the complete static board shell and accessible mount targets', () => {
  const html = read(PAGE_PATH);

  assert.match(html, /<a\s+class="active"\s+href="branches\.html">分支拓扑<\/a>/);
  assert.match(html, /<nav[^>]*id="branch-primary-nav"[^>]*class="navlinks"[^>]*aria-label="主导航"/);
  assert.match(html, /<button[^>]*type="button"[^>]*class="mobile-menu-btn"[^>]*id="branch-mobile-menu"[^>]*aria-label="打开主导航"[^>]*aria-expanded="false"[^>]*aria-controls="branch-primary-nav"[^>]*>☰<\/button>/);
  assert.match(html, /id="branch-status"[^>]*role="status"[^>]*aria-live="polite"/);
  for (const id of [
    'snapshot-header',
    'branch-kpis',
    'branch-topology',
    'branch-ledger',
    'remote-refs',
    'snapshot-warnings',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /<label[^>]*for="branch-search"[^>]*>[^<]*搜索/);
  assert.match(html, /<input[^>]*id="branch-search"[^>]*type="search"/);
  for (const [id, label] of [
    ['relation-filter', '关系'],
    ['worktree-filter', '工作区'],
    ['prefix-filter', '前缀'],
    ['governance-filter', '治理建议'],
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"[^>]*>[^<]*${label}`));
    assert.match(html, new RegExp(`<select[^>]*id="${id}"`));
  }
  assert.match(html, /id="branch-result-count"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /<noscript>[\s\S]*npm run board:branches[\s\S]*<\/noscript>/);

  const snapshotIndex = html.indexOf('data/branch-snapshot.js');
  const rendererIndex = html.indexOf('assets/branch-topology.js');
  assert.ok(snapshotIndex >= 0 && rendererIndex > snapshotIndex, 'snapshot must load before renderer');
  assert.match(html, /href="assets\/branch-topology\.css"/);
  assert.match(html, /本地 Git refs[^<]*worktree/i);
  assert.match(html, /LOCAL REMOTE-TRACKING SNAPSHOT/);
  assert.match(html, /npm run board:branches/);
});

test('renderer exports stable pure filtering and topology grouping helpers', () => {
  const renderer = require(RENDERER_PATH);
  for (const name of [
    'filterBranches',
    'groupNonAncestorsByPrefix',
    'mount',
    'renderKpis',
    'renderTopology',
    'renderLedger',
    'renderRemoteRefs',
  ]) {
    assert.equal(typeof renderer[name], 'function', `${name} must be exported`);
  }

  const rows = [
    branch(),
    branch({
      branchName: 'qoder/active',
      headFull: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      headShort: 'bbbbbbb',
      subject: 'NightOps',
      author: 'Qoder',
      worktreePath: '/repo/qoder',
      worktreeDirty: 'dirty',
      prefix: 'qoder',
      governanceSuggestion: '活跃工作区，先复核任务状态',
    }),
    branch({
      branchName: 'feature/history',
      headFull: 'cccccccccccccccccccccccccccccccccccccccc',
      headShort: 'ccccccc',
      gitRelation: 'ancestor',
      prefix: 'feature',
      governanceSuggestion: '可评估归档或清理',
    }),
  ];

  assert.deepEqual(renderer.filterBranches(rows, { search: 'nightops' }), [rows[1]]);
  assert.deepEqual(renderer.filterBranches(rows, { search: 'BBBBBBB' }), [rows[1]]);
  assert.deepEqual(renderer.filterBranches(rows, { relation: 'ancestor' }), [rows[2]]);
  assert.deepEqual(renderer.filterBranches(rows, { worktree: 'active' }), [rows[1]]);
  assert.deepEqual(renderer.filterBranches(rows, { worktree: 'none' }), [rows[0], rows[2]]);
  assert.deepEqual(renderer.filterBranches(rows, { prefix: 'codex' }), [rows[0]]);
  assert.deepEqual(renderer.filterBranches(rows, { governance: '可评估归档或清理' }), [rows[2]]);
  assert.deepEqual(renderer.filterBranches(rows, {}), rows);

  const grouped = renderer.groupNonAncestorsByPrefix([
    rows[1],
    branch({ branchName: 'other/zeta', prefix: 'other' }),
    branch({ branchName: 'codex/zeta', prefix: 'codex' }),
    branch({ branchName: 'codex/alpha', prefix: 'codex' }),
    branch({ branchName: 'mainline', gitRelation: 'current', prefix: 'other' }),
    rows[2],
  ]);
  assert.deepEqual(grouped.map((group) => group.prefix), ['codex', 'other']);
  assert.deepEqual(grouped[0].branches.map((row) => row.branchName), ['codex/alpha', 'codex/zeta']);
});

test('renderer treats snapshot strings as text and has no runtime Git or network dependency', () => {
  const source = read(RENDERER_PATH);
  assert.match(source, /createElement\s*\(/);
  assert.match(source, /textContent|createTextNode/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /\bfetch\s*\(|child_process|execFile|spawn\s*\(|git\s+(?:branch|fetch|merge|status|worktree)/i);
  assert.match(source, /DOMContentLoaded/);
  assert.match(source, /WES_BRANCH_SNAPSHOT/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /\bhidden\b/);
});

test('renderer rejects an incomplete branch record as an alert without rendering fake data', () => {
  const renderer = require(RENDERER_PATH);
  const { attributes, status, documentRef } = alertDocument();
  const incomplete = {
    generatedAt: '2026-08-02T12:00:00.000Z',
    mainBranch: 'main',
    branches: [{ branchName: 'main', gitRelation: 'current' }],
    remoteRefs: [],
    worktrees: [],
    duplicateTipGroups: [],
    warnings: [],
  };

  assert.doesNotThrow(() => assert.equal(renderer.mount(documentRef, incomplete), false));
  assert.equal(attributes.get('role'), 'alert');
  assert.match(status.textContent, /npm run board:branches/);
});

test('renderer rejects every malformed nested snapshot collection before rendering', () => {
  const renderer = require(RENDERER_PATH);
  const malformedCases = [
    ['remote ref', { remoteRefs: [null] }],
    ['worktree', { worktrees: [null] }],
    ['duplicate group', { duplicateTipGroups: [null] }],
    ['warning', { warnings: [null] }],
    ['provenance', { provenance: { semantics: '', sourceCheckoutBranch: '', sourceCheckoutHead: '', configuredMainlineHead: '', observationNote: '' } }],
    ['governance', { governance: { defaultRemote: 42, staleAfterDays: '30' } }],
    ['multiple current branches', { branches: [validSnapshot().branches[0], branch({ branchName: 'other-current', gitRelation: 'current' })] }],
  ];

  for (const [label, overrides] of malformedCases) {
    const { attributes, status, documentRef } = alertDocument();
    assert.doesNotThrow(() => {
      assert.equal(renderer.mount(documentRef, validSnapshot(overrides)), false, label);
    }, label);
    assert.equal(attributes.get('role'), 'alert', label);
    assert.match(status.textContent, /npm run board:branches/, label);
  }
});

test('renderer rejects missing, invalid, or inconsistent canonical snapshot metadata', () => {
  const renderer = require(RENDERER_PATH);
  const summaryFields = [
    'localBranchCount',
    'remoteRefCount',
    'worktreeCount',
    'ancestorCount',
    'nonAncestorCount',
    'duplicateTipGroupCount',
    'warningCount',
  ];
  const malformedCases = [
    ['missing schemaVersion', { schemaVersion: undefined }],
    ['invalid schemaVersion', { schemaVersion: 2 }],
    ['missing repoRoot', { repoRoot: '' }],
    ['invalid summary', { summary: null }],
    ['negative summary value', { summary: { ...validSnapshot().summary, warningCount: -1 } }],
    ...summaryFields.map((field) => [
      `mismatched ${field}`,
      { summary: { ...validSnapshot().summary, [field]: validSnapshot().summary[field] + 1 } },
    ]),
  ];

  for (const [label, overrides] of malformedCases) {
    const { attributes, status, documentRef } = alertDocument();
    assert.doesNotThrow(() => {
      assert.equal(renderer.mount(documentRef, validSnapshot(overrides)), false, label);
    }, label);
    assert.equal(attributes.get('role'), 'alert', label);
    assert.match(status.textContent, /npm run board:branches/, label);
  }
});

test('topology assigns an ancestor with a worktree to the active group only', () => {
  const renderer = require(RENDERER_PATH);
  const { documentRef } = mountDocument();
  const target = documentRef.getElementById('branch-topology');
  const snapshot = representativeSnapshot();

  renderer.renderTopology(snapshot, target);

  const activePanel = documentRef.getElementById('topology-active-worktrees');
  const ancestorPanel = documentRef.getElementById('topology-ancestors');
  assert.match(activePanel.textContent, /qoder\/active-ancestor/);
  assert.doesNotMatch(ancestorPanel.textContent, /qoder\/active-ancestor/);
  assert.equal(target.textContent.split('qoder/active-ancestor').length - 1, 1);
});

test('successful DOM mount renders facts and supports filtering and topology interactions', () => {
  const renderer = require(RENDERER_PATH);
  const { documentRef, elements } = mountDocument();
  const snapshot = representativeSnapshot();

  assert.equal(renderer.mount(documentRef, snapshot), true);
  assert.match(elements.get('snapshot-header').textContent, /\/repo/);
  assert.deepEqual(
    elements.get('branch-kpis').querySelectorAll('strong').map((node) => node.textContent),
    ['4', '2', '2', '1', '1', '1'],
  );
  assert.equal(elements.get('branch-ledger').querySelectorAll('tbody tr').length, 4);
  assert.equal(elements.get('remote-refs').querySelectorAll('tbody tr').length, 1);

  const scriptLikeName = 'codex/<script>window.injected=true</script>';
  assert.match(elements.get('branch-ledger').textContent, /<script>window\.injected=true<\/script>/);
  assert.equal(elements.get('branch-ledger').querySelector('script'), null);
  assert.equal(globalThis.injected, undefined);

  const search = elements.get('branch-search');
  search.value = scriptLikeName;
  search.dispatchEvent({ type: 'input' });
  assert.equal(elements.get('branch-ledger').querySelectorAll('tbody tr').length, 1);
  assert.match(elements.get('branch-result-count').textContent, /1 \/ 4/);

  search.value = '';
  search.dispatchEvent({ type: 'input' });
  const relation = elements.get('relation-filter');
  relation.value = 'ancestor';
  relation.dispatchEvent({ type: 'change' });
  assert.equal(elements.get('branch-ledger').querySelectorAll('tbody tr').length, 2);
  assert.match(elements.get('branch-result-count').textContent, /2 \/ 4/);

  const ancestorPanel = documentRef.getElementById('topology-ancestors');
  const ancestorToggle = elements.get('branch-topology').querySelectorAll('.branch-toggle')
    .find((button) => button.getAttribute('aria-controls') === 'topology-ancestors');
  assert.equal(ancestorToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(ancestorPanel.hidden, true);
  ancestorToggle.click();
  assert.equal(ancestorToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(ancestorPanel.hidden, false);
});

test('KPI renderer consumes the canonical summary values', () => {
  const renderer = require(RENDERER_PATH);
  const { documentRef } = mountDocument();
  const target = documentRef.getElementById('branch-kpis');
  const snapshot = validSnapshot({
    summary: {
      localBranchCount: 11,
      remoteRefCount: 12,
      worktreeCount: 13,
      ancestorCount: 14,
      nonAncestorCount: 15,
      duplicateTipGroupCount: 16,
      warningCount: 17,
    },
  });

  renderer.renderKpis(snapshot, target);
  assert.deepEqual(
    target.querySelectorAll('strong').map((node) => node.textContent),
    ['11', '13', '14', '15', '16', '17'],
  );
});

test('mobile navigation initializes independently and maintains accessible open state', () => {
  const renderer = require(RENDERER_PATH);
  const navClasses = new Set(['navlinks']);
  const listeners = {};
  const attributes = new Map([
    ['aria-expanded', 'false'],
    ['aria-label', '打开主导航'],
  ]);
  const nav = {
    classList: {
      contains(value) { return navClasses.has(value); },
      add(value) { navClasses.add(value); },
      remove(value) { navClasses.delete(value); },
    },
  };
  const button = {
    addEventListener(name, listener) { listeners[name] = listener; },
    getAttribute(name) { return attributes.get(name); },
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const documentRef = {
    getElementById(id) {
      if (id === 'branch-primary-nav') return nav;
      if (id === 'branch-mobile-menu') return button;
      return null;
    },
  };

  assert.equal(typeof renderer.mountMobileNavigation, 'function');
  assert.equal(renderer.mountMobileNavigation(documentRef), true);
  listeners.click();
  assert.equal(navClasses.has('open'), true);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(attributes.get('aria-label'), '关闭主导航');
  listeners.click();
  assert.equal(navClasses.has('open'), false);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(attributes.get('aria-label'), '打开主导航');

  const componentsCss = read(path.join(BOARD_DIR, 'assets', 'components.css'));
  assert.match(componentsCss, /@media\s*\(max-width:\s*1040px\)[\s\S]*\.mobile-menu-btn\s*\{[^}]*display\s*:\s*block/is);
  assert.match(componentsCss, /@media\s*\(max-width:\s*1040px\)[\s\S]*\.navlinks\.open\s*\{[^}]*display\s*:\s*flex/is);
});

test('branch page CSS contains local table scrolling, responsive topology, and focus affordances', () => {
  const css = read(CSS_PATH);
  assert.match(css, /\.branch-table-wrap\s*\{[^}]*overflow\s*:\s*auto/is);
  assert.match(css, /\.branch-ledger-table\s*\{[^}]*min-width\s*:\s*(?:1[4-9]\d{2}|[2-9]\d{3})px/is);
  assert.match(css, /\.branch-kpi-grid\s*\{[^}]*display\s*:\s*grid/is);
  assert.match(css, /\.branch-topology-grid\s*\{[^}]*display\s*:\s*grid/is);
  assert.match(css, /:focus-visible\s*\{[^}]*outline\s*:/is);
  assert.match(css, /\.mobile-menu-btn:focus-visible[^{]*\{[^}]*outline\s*:/is);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.branch-filter-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr/is);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*\.branch-topology-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr/is);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow-x\s*:\s*(?:auto|scroll)/is);
});

test('package scripts run generator and page tests while check mode remains non-mutating', () => {
  const pkg = JSON.parse(read(path.join(PROJECT_ROOT, 'package.json')));
  assert.match(pkg.scripts['test:board:branches'], /scripts\/branch-board\.test\.js/);
  assert.match(pkg.scripts['test:board:branches'], /scripts\/branch-board-page\.test\.js/);
  assert.match(pkg.scripts['board:branches:check'], /generate-branch-board\.js --check/);
  assert.match(pkg.scripts['board:branches:check'], /scripts\/branch-board\.test\.js/);
  assert.match(pkg.scripts['board:branches:check'], /scripts\/branch-board-page\.test\.js/);
  assert.ok(pkg.scripts['board:branches:check'].indexOf('--check') < pkg.scripts['board:branches:check'].indexOf('node --test'));
});

test('work item and central navigation owners register branch topology immediately after collaboration protocol', () => {
  const sidebarSource = read(path.join(PROJECT_ROOT, 'scripts', 'board-sidebar-transform.js'));
  const consistencySource = read(path.join(PROJECT_ROOT, 'scripts', 'board-consistency-check.js'));
  assert.match(sidebarSource, /if\s*\(require\.main\s*===\s*module\)/);
  assert.match(sidebarSource, /module\.exports/);
  assert.match(consistencySource, /if\s*\(require\.main\s*===\s*module\)/);
  assert.match(consistencySource, /module\.exports/);

  const build = require('./board-build');
  const sidebar = require('./board-sidebar-transform');
  const consistency = require('./board-consistency-check');
  for (const items of [build.NAV_ITEMS, sidebar.NAV_ITEMS]) {
    const collaboration = items.findIndex((item) => item.href === 'collaboration-protocol.html');
    assert.deepEqual(items[collaboration + 1], { href: 'branches.html', label: '分支拓扑' });
  }
  assert.ok(consistency.HTML_FILES.includes('branches.html'));
});

test('navigation synchronizer inserts one branch link in supported nav blocks and is idempotent', (t) => {
  const { syncDirectory } = require('./sync-board-branch-nav');
  const tempDir = createTempDir(t);
  const collaboration = '        <a href="collaboration-protocol.html">协作协议</a>';
  const activeCollaboration = '        <a class="active" href="collaboration-protocol.html">协作协议</a>';
  const expected = `${collaboration}\n        <a href="branches.html">分支拓扑</a>`;
  const nav = `<nav class="navlinks" aria-label="主导航">\n${collaboration}\n        <a href="requirements.html">需求池</a>\n      </nav>`;
  const linkedNav = `<nav class="navlinks">\n${expected}\n      </nav>`;
  const sidebarNav = `<nav class="sidebar-nav">\n${collaboration}\n      </nav>`;

  fs.writeFileSync(path.join(tempDir, 'index.html'), `<!doctype html><body>${nav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'active.html'), `<!doctype html><body><nav class="navlinks">\n${activeCollaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'sidebar.html'), `<!doctype html><body><nav class="sidebar-nav" aria-label="主导航">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'multi-navlinks.html'), `<!doctype html><body><nav class="foo navlinks bar">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'multi-sidebar.html'), `<!doctype html><body><nav class="sidebar-nav compact">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'spaced-equals.html'), `<!doctype html><body><nav class = "navlinks">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'single-quoted.html'), `<!doctype html><body><nav  class = ' compact sidebar-nav ' >\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'class-not-first.html'), `<!doctype html><body><nav aria-label="主导航" id="fixture-nav" class="navlinks">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'data-with-exact.html'), `<!doctype html><body><nav data-class="navlinks-extra" class="sidebar-nav">\n${collaboration}\n      </nav></body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'content.html'), `<!doctype html><body>${collaboration}${nav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'content-branch.html'), `<!doctype html><body><a href="branches.html">内容链接</a>${nav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'two-navs.html'), `<!doctype html><body>${nav}${sidebarNav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'first-linked-second-missing.html'), `<!doctype html><body>${linkedNav}${sidebarNav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'both-linked.html'), `<!doctype html><body>${linkedNav}${linkedNav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'branches.html'), `<!doctype html><body>${nav}</body>`, 'utf8');
  fs.writeFileSync(path.join(tempDir, 'already-linked.html'), `<!doctype html><body>${expected}</body>`, 'utf8');
  const unsupportedNavs = [
    ['navlinks-extra.html', 'navlinks-extra'],
    ['foo-navlinks.html', 'foo-navlinks'],
    ['sidebar-nav-secondary.html', 'sidebar-nav-secondary'],
    ['data-class.html', 'data-class="navlinks"'],
  ];
  for (const [file, className] of unsupportedNavs) {
    const attribute = className.includes('=') ? className : `class="${className}"`;
    fs.writeFileSync(path.join(tempDir, file), `<!doctype html><body><nav ${attribute}>\n${collaboration}\n      </nav></body>`, 'utf8');
  }

  const first = syncDirectory(tempDir);
  assert.deepEqual(first.map((file) => path.basename(file)), ['active.html', 'class-not-first.html', 'content-branch.html', 'content.html', 'data-with-exact.html', 'first-linked-second-missing.html', 'index.html', 'multi-navlinks.html', 'multi-sidebar.html', 'sidebar.html', 'single-quoted.html', 'spaced-equals.html', 'two-navs.html']);
  assert.equal((read(path.join(tempDir, 'index.html')).match(/href="branches\.html"/g) || []).length, 1);
  assert.match(read(path.join(tempDir, 'index.html')), new RegExp(expected));
  assert.match(read(path.join(tempDir, 'active.html')), new RegExp(`${activeCollaboration}\\n      <a href="branches.html">分支拓扑</a>`));
  assert.match(read(path.join(tempDir, 'content.html')), new RegExp(`${collaboration}<nav class="navlinks"`));
  assert.equal((read(path.join(tempDir, 'content-branch.html')).match(/href="branches\.html"/g) || []).length, 2);
  assert.equal((read(path.join(tempDir, 'two-navs.html')).match(/href="branches\.html"/g) || []).length, 2);
  assert.equal((read(path.join(tempDir, 'first-linked-second-missing.html')).match(/href="branches\.html"/g) || []).length, 2);
  assert.equal(read(path.join(tempDir, 'both-linked.html')), `<!doctype html><body>${linkedNav}${linkedNav}</body>`);
  for (const file of ['class-not-first.html', 'data-with-exact.html', 'single-quoted.html', 'spaced-equals.html']) {
    assert.match(read(path.join(tempDir, file)), /href="branches\.html"/);
  }
  assert.equal(read(path.join(tempDir, 'branches.html')), `<!doctype html><body>${nav}</body>`);
  assert.equal(read(path.join(tempDir, 'already-linked.html')), `<!doctype html><body>${expected}</body>`);
  for (const [file, className] of unsupportedNavs) {
    const attribute = className.includes('=') ? className : `class="${className}"`;
    assert.equal(read(path.join(tempDir, file)), `<!doctype html><body><nav ${attribute}>\n${collaboration}\n      </nav></body>`);
  }

  const afterFirstRun = Object.fromEntries(fs.readdirSync(tempDir).map((file) => [file, read(path.join(tempDir, file))]));
  assert.deepEqual(syncDirectory(tempDir), []);
  for (const [file, html] of Object.entries(afterFirstRun)) {
    assert.equal(read(path.join(tempDir, file)), html, `${file} should be unchanged on the second run`);
  }
});

test('board build accepts isolated source and destination directories', () => {
  const source = read(path.join(PROJECT_ROOT, 'scripts', 'board-build.js'));
  assert.match(source, /function mergeCSS\(boardDir\s*=\s*BOARD_DIR\)/);
  assert.match(source, /function copyExtraFiles\(destinationDir\s*=\s*DIST_DIR, sourceBoardDir\s*=\s*BOARD_DIR\)/);
  assert.match(source, /async function main\(\{ boardDir\s*=\s*BOARD_DIR, distDir\s*=\s*path\.join\(boardDir, 'dist'\) \}\s*=\s*\{\}\)/);
});

test('every supported source board navigation links to branch topology exactly once', () => {
  const supportedPages = fs.readdirSync(BOARD_DIR)
    .filter((file) => file.endsWith('.html') && file !== 'branches.html')
    .sort()
    .filter((file) => {
      const html = read(path.join(BOARD_DIR, file));
      return [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].some((match) => {
        const nav = match[0];
        const openingTag = nav.slice(0, nav.indexOf('>') + 1);
        const classAttribute = /(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/.exec(openingTag);
        const classes = classAttribute ? classAttribute[2].trim().split(/\s+/) : [];
        return (classes.includes('navlinks') || classes.includes('sidebar-nav'))
          && /href=(["'])collaboration-protocol\.html\1/.test(nav);
      });
    });

  assert.ok(supportedPages.length > 0);
  for (const file of supportedPages) {
    const html = read(path.join(BOARD_DIR, file));
    const navs = [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)]
      .map((match) => match[0])
      .filter((nav) => {
        const openingTag = nav.slice(0, nav.indexOf('>') + 1);
        const classAttribute = /(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/.exec(openingTag);
        const classes = classAttribute ? classAttribute[2].trim().split(/\s+/) : [];
        return (classes.includes('navlinks') || classes.includes('sidebar-nav'))
          && /href=(["'])collaboration-protocol\.html\1/.test(nav);
      });
    for (const nav of navs) {
      assert.equal((nav.match(/href=(["'])branches\.html\1/g) || []).length, 1, `${file} navigation`);
    }
  }
});

test('source board modules expose one RP-045 governance record per planned owner', () => {
  const expected = {
    'issues.html': [
      'BE-2026-08-02-rp-045-branch-topology:issues',
      'ISS-2026-08-02-001',
      '项目看板缺少主分支与子分支拓扑',
    ],
    'requirements.html': [
      'BE-2026-08-02-rp-045-branch-topology:requirements',
      'RP-045 · WES 分支拓扑与 Worktree 看板',
      '全部本地分支与 Git 集合一致',
    ],
    'index.html': [
      'BE-2026-08-02-rp-045-branch-topology:index',
      '分支拓扑与 Worktree',
      '查看自动生成的主线、子分支关系',
    ],
    'plan.html': [
      'BE-2026-08-02-rp-045-branch-topology:plan',
      '实施验证中',
      '不执行自动删除、合并或远端同步',
    ],
    'monitoring.html': [
      'BE-2026-08-02-rp-045-branch-topology:monitoring',
      'npm run board:branches:check',
      '待最终验证',
    ],
    'changes.html': [
      'BE-2026-08-02-rp-045-branch-topology:changes',
      '新增只读 Git 分支快照生成器',
      '人工浏览器验收回填',
    ],
    'sources.html': [
      'BE-2026-08-02-rp-045-branch-topology:sources-page',
      'BE-2026-08-02-rp-045-branch-topology:sources-generator',
      'BE-2026-08-02-rp-045-branch-topology:sources-spec',
      'BE-2026-08-02-rp-045-branch-topology:sources-plan',
    ],
  };

  for (const [file, fragments] of Object.entries(expected)) {
    const html = read(path.join(BOARD_DIR, file));
    for (const fragment of fragments) {
      assert.equal(html.split(fragment).length - 1, 1, `${file}: ${fragment}`);
    }
  }
});

test('board build centralizes actual branch navigation while preserving its shell and runtime assets', async (t) => {
  const build = require('./board-build');
  const nav = build.generateNav('branches.html');
  assert.match(nav, /<a class="active" href="branches\.html">分支拓扑<\/a>/);
  assert.equal((nav.match(/class="active"/g) || []).length, 1);
  assert.match(nav, /class="mobile-menu-btn"/);

  const fixture = `<!doctype html><head>\n  <link rel="stylesheet" href="assets/base.css" />\n  <link rel="stylesheet" href="assets/components.css" />\n  <link rel="stylesheet" href="assets/pages.css" />\n  <link rel="stylesheet" href="assets/branch-topology.css" />\n</head><body><nav class="navlinks"><a href="index.html">总览</a></nav><button class="mobile-menu-btn">☰</button><script src="data/branch-snapshot.js"></script><script src="assets/branch-topology.js"></script></body>`;
  const processed = build.processHTML(fixture, 'branches.html');
  assert.match(processed, /href="assets\/dashboard\.css"/);
  assert.match(processed, /href="assets\/branch-topology\.css"/);
  assert.match(processed, /src="data\/branch-snapshot\.js"/);
  assert.match(processed, /src="assets\/branch-topology\.js"/);
  assert.match(processed, /<a class="active" href="branches\.html">分支拓扑<\/a>/);

  const branchesSource = read(PAGE_PATH);
  const processedBranches = build.processHTML(branchesSource, 'branches.html');
  const branchNav = processedBranches.match(/<nav\b(?=[^>]*\bid="branch-primary-nav")[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(branchNav, 'branch nav opening attributes must be retained');
  assert.deepEqual(
    [...branchNav[1].matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    build.NAV_ITEMS.map((item) => item.href),
  );
  assert.equal((branchNav[1].match(/class="active"/g) || []).length, 1);
  assert.doesNotMatch(branchNav[1], /roadmap\.html/);
  assert.match(processedBranches, /<nav id="branch-primary-nav" class="navlinks" aria-label="主导航">/);
  assert.match(processedBranches, /<button type="button" class="mobile-menu-btn" id="branch-mobile-menu" aria-label="打开主导航" aria-expanded="false" aria-controls="branch-primary-nav">☰<\/button>/);
  assert.match(processedBranches, /href="assets\/branch-topology\.css"/);
  assert.match(processedBranches, /src="data\/branch-snapshot\.js"/);
  assert.match(processedBranches, /src="assets\/branch-topology\.js"/);

  const distDir = createTempDir(t);
  const copied = build.copyExtraFiles(distDir);
  assert.deepEqual(copied.map((file) => path.relative(distDir, file).split(path.sep).join('/')).sort(), [
    'assets/branch-topology.css',
    'assets/branch-topology.js',
    'data/branch-snapshot.js',
  ]);
  for (const relativeFile of copied.map((file) => path.relative(distDir, file))) {
    assert.equal(read(path.join(distDir, relativeFile)), read(path.join(BOARD_DIR, relativeFile)));
  }

  const realDistManifest = directoryManifest(path.join(BOARD_DIR, 'dist'));
  const buildDist = createTempDir(t);
  const buildResult = await build.main({ boardDir: BOARD_DIR, distDir: buildDist });
  assert.equal(buildResult.distDir, buildDist);
  const distBranches = read(path.join(buildDist, 'branches.html'));
  const distNav = distBranches.match(/<nav\b(?=[^>]*\bid="branch-primary-nav")[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(distNav);
  assert.deepEqual(
    [...distNav[1].matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    build.NAV_ITEMS.map((item) => item.href),
  );
  assert.match(distBranches, /<button type="button" class="mobile-menu-btn" id="branch-mobile-menu" aria-label="打开主导航" aria-expanded="false" aria-controls="branch-primary-nav">☰<\/button>/);
  assert.deepEqual(directoryManifest(path.join(BOARD_DIR, 'dist')), realDistManifest);
});
