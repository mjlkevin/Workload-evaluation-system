const assert = require('node:assert/strict');
const fs = require('node:fs');
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
