(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WESBranchTopology = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PREFERRED_PREFIXES = ['codex', 'qoder', 'feature', 'other'];
  var LEDGER_COLUMNS = [
    ['branchName', '分支'],
    ['headShort', '短 SHA'],
    ['headFull', '完整 SHA'],
    ['subject', '提交主题'],
    ['author', '作者'],
    ['committerDate', '提交时间'],
    ['gitRelation', 'Git 关系'],
    ['ahead', 'Ahead'],
    ['behind', 'Behind'],
    ['worktreePath', 'Worktree 路径'],
    ['worktreeDirty', 'Worktree 状态'],
    ['upstream', 'Upstream'],
    ['upstreamTrack', 'Upstream Track'],
    ['duplicateTipGroup', '重复指针组'],
    ['governanceSuggestion', '治理建议'],
  ];

  function text(value) {
    return value === undefined || value === null || value === '' ? '—' : String(value);
  }

  function element(documentRef, tagName, className, value) {
    var node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(function (value) { return value !== ''; })))
      .sort(function (left, right) { return left.localeCompare(right, 'zh-CN'); });
  }

  function filterBranches(branches, filters) {
    var criteria = filters || {};
    var search = String(criteria.search || '').trim().toLocaleLowerCase();
    return (branches || []).filter(function (branch) {
      var searchable = [branch.branchName, branch.subject, branch.author, branch.headFull, branch.headShort]
        .map(function (value) { return String(value || '').toLocaleLowerCase(); })
        .join('\n');
      if (search && searchable.indexOf(search) === -1) return false;
      if (criteria.relation && branch.gitRelation !== criteria.relation) return false;
      if (criteria.prefix && branch.prefix !== criteria.prefix) return false;
      if (criteria.governance && branch.governanceSuggestion !== criteria.governance) return false;
      if (criteria.worktree === 'active' && !branch.worktreePath) return false;
      if (criteria.worktree === 'none' && branch.worktreePath) return false;
      if (criteria.worktree === 'dirty' && branch.worktreeDirty !== 'dirty') return false;
      if (criteria.worktree === 'clean' && branch.worktreeDirty !== 'clean') return false;
      if (criteria.worktree === 'unknown' && branch.worktreeDirty !== 'unknown') return false;
      return true;
    });
  }

  function prefixRank(prefix) {
    var rank = PREFERRED_PREFIXES.indexOf(prefix);
    return rank === -1 ? PREFERRED_PREFIXES.length : rank;
  }

  function groupNonAncestorsByPrefix(branches) {
    var grouped = new Map();
    (branches || []).forEach(function (branch) {
      if (branch.gitRelation !== 'non_ancestor' || branch.worktreePath) return;
      var prefix = branch.prefix || 'other';
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix).push(branch);
    });
    return Array.from(grouped.entries())
      .map(function (entry) {
        return {
          prefix: entry[0],
          branches: entry[1].slice().sort(function (left, right) {
            return left.branchName.localeCompare(right.branchName, 'en');
          }),
        };
      })
      .sort(function (left, right) {
        return prefixRank(left.prefix) - prefixRank(right.prefix)
          || left.prefix.localeCompare(right.prefix, 'en');
      });
  }

  function renderSnapshotHeader(snapshot, target) {
    clear(target);
    var documentRef = target.ownerDocument;
    var mainline = snapshot.branches.find(function (branch) {
      return branch.branchName === snapshot.mainBranch;
    });
    var facts = [
      ['Configured mainline', snapshot.mainBranch],
      ['Mainline HEAD', (snapshot.provenance && snapshot.provenance.configuredMainlineHead) || (mainline && mainline.headFull)],
      ['Repository root', snapshot.repoRoot],
      ['Generated at', snapshot.generatedAt],
      ['As-of provenance', (snapshot.provenance && snapshot.provenance.semantics) || 'as_of_generation'],
      ['Source checkout', snapshot.provenance && snapshot.provenance.sourceCheckoutBranch],
      ['Observation note', snapshot.provenance && snapshot.provenance.observationNote],
    ];
    facts.forEach(function (fact) {
      var dl = element(documentRef, 'dl', 'branch-fact');
      dl.appendChild(element(documentRef, 'dt', '', fact[0]));
      dl.appendChild(element(documentRef, 'dd', '', fact[1]));
      target.appendChild(dl);
    });
  }

  function renderKpis(snapshot, target) {
    clear(target);
    var documentRef = target.ownerDocument;
    var summary = snapshot.summary;
    var values = [
      ['本地分支', summary.localBranchCount],
      ['活跃工作区', summary.worktreeCount],
      ['其他祖先分支', summary.ancestorCount],
      ['未汇入主线分支', summary.nonAncestorCount],
      ['重复指针组', summary.duplicateTipGroupCount],
      ['快照警告', summary.warningCount],
    ];
    values.forEach(function (item) {
      var card = element(documentRef, 'div', 'branch-kpi');
      card.appendChild(element(documentRef, 'strong', '', item[1]));
      card.appendChild(element(documentRef, 'span', '', item[0]));
      target.appendChild(card);
    });
  }

  function renderBranchNode(documentRef, branch) {
    var node = element(documentRef, 'div', 'branch-node');
    node.appendChild(element(documentRef, 'span', 'branch-name', branch.branchName));
    node.appendChild(element(documentRef, 'small', '', text(branch.headShort) + ' · ' + text(branch.gitRelation)));
    if (branch.worktreePath) {
      node.appendChild(element(documentRef, 'small', '', '工作区：' + text(branch.worktreeDirty) + ' · ' + branch.worktreePath));
    } else {
      node.appendChild(element(documentRef, 'small', '', '治理建议：' + text(branch.governanceSuggestion)));
    }
    return node;
  }

  function toggleSection(documentRef, id, title, branches, expanded, summary) {
    var section = element(documentRef, 'section', 'branch-toggle-section');
    var button = element(documentRef, 'button', 'branch-toggle', title + '（' + branches.length + '）');
    var panel = element(documentRef, 'div', 'branch-toggle-panel');
    button.type = 'button';
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-controls', id);
    panel.id = id;
    panel.hidden = !expanded;
    if (summary) panel.appendChild(element(documentRef, 'p', 'branch-group-summary', summary));
    var list = element(documentRef, 'div', 'branch-node-list');
    branches.forEach(function (branch) { list.appendChild(renderBranchNode(documentRef, branch)); });
    panel.appendChild(list);
    button.addEventListener('click', function () {
      var nextExpanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      panel.hidden = !nextExpanded;
    });
    section.appendChild(button);
    section.appendChild(panel);
    return section;
  }

  function renderTopology(snapshot, target) {
    clear(target);
    var documentRef = target.ownerDocument;
    var branches = snapshot.branches || [];
    var mainline = branches.find(function (branch) { return branch.branchName === snapshot.mainBranch; });
    var active = branches.filter(function (branch) {
      return branch.worktreePath && branch.branchName !== snapshot.mainBranch;
    }).sort(function (left, right) { return left.branchName.localeCompare(right.branchName, 'en'); });
    var ancestors = branches.filter(function (branch) {
      return branch.gitRelation === 'ancestor' && !branch.worktreePath;
    })
      .sort(function (left, right) { return left.branchName.localeCompare(right.branchName, 'en'); });
    var duplicateBranches = branches.filter(function (branch) { return branch.duplicateTipGroup; })
      .sort(function (left, right) { return left.branchName.localeCompare(right.branchName, 'en'); });
    var grid = element(documentRef, 'div', 'branch-topology-grid');
    var rootNode = element(documentRef, 'div', 'branch-mainline');
    rootNode.appendChild(element(documentRef, 'span', 'pill brand', 'MAINLINE ROOT · current'));
    rootNode.appendChild(element(documentRef, 'span', 'branch-name', mainline && mainline.branchName));
    rootNode.appendChild(element(documentRef, 'small', '', 'HEAD ' + text(mainline && mainline.headFull)));
    rootNode.appendChild(element(documentRef, 'small', '', '工作区状态：' + text(mainline && mainline.worktreeDirty)));
    grid.appendChild(rootNode);
    grid.appendChild(element(documentRef, 'div', 'branch-connector'));
    var groups = element(documentRef, 'div', 'branch-group-stack');
    groups.appendChild(toggleSection(documentRef, 'topology-active-worktrees', '活跃工作区分支 · 默认展开', active, true, '每个节点均显示工作区状态与路径；主线已在左侧单独呈现。'));
    groupNonAncestorsByPrefix(branches).forEach(function (group, index) {
      groups.appendChild(toggleSection(documentRef, 'topology-prefix-' + index, group.prefix + ' 前缀 · 未汇入主线', group.branches, false, '不含主线、祖先分支及活跃工作区分支。'));
    });
    groups.appendChild(toggleSection(documentRef, 'topology-ancestors', '祖先 / 历史摘要', ancestors, false, '这些分支是主线祖先；当前主线不计入该数量。'));
    groups.appendChild(toggleSection(documentRef, 'topology-duplicates', '重复指针摘要', duplicateBranches, false, '同一完整 SHA 被多个本地分支引用；这是事实分组，不代表自动清理决定。'));
    grid.appendChild(groups);
    target.appendChild(grid);
  }

  function buildTable(documentRef, className, columns, rows, emptyMessage) {
    var wrapper = element(documentRef, 'div', 'branch-table-wrap');
    var table = element(documentRef, 'table', className);
    var head = documentRef.createElement('thead');
    var headerRow = documentRef.createElement('tr');
    columns.forEach(function (column) {
      var th = element(documentRef, 'th', '', column[1]);
      th.scope = 'col';
      headerRow.appendChild(th);
    });
    head.appendChild(headerRow);
    table.appendChild(head);
    var body = documentRef.createElement('tbody');
    if (!rows.length) {
      var emptyRow = documentRef.createElement('tr');
      var emptyCell = element(documentRef, 'td', 'branch-empty', emptyMessage);
      emptyCell.colSpan = columns.length;
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
    } else {
      rows.forEach(function (row) {
        var tr = documentRef.createElement('tr');
        columns.forEach(function (column) {
          tr.appendChild(element(documentRef, 'td', '', row[column[0]]));
        });
        body.appendChild(tr);
      });
    }
    table.appendChild(body);
    wrapper.appendChild(table);
    return wrapper;
  }

  function renderLedger(branches, target) {
    clear(target);
    target.appendChild(buildTable(
      target.ownerDocument,
      'branch-ledger-table',
      LEDGER_COLUMNS,
      branches || [],
      '当前筛选条件没有匹配的本地分支。快照仍有效，请调整筛选条件。'
    ));
  }

  function renderRemoteRefs(remoteRefs, target) {
    clear(target);
    var columns = [
      ['branchName', 'Remote-tracking ref'],
      ['headShort', '短 SHA'],
      ['headFull', '完整 SHA'],
      ['refKind', 'Ref kind'],
      ['isSymbolicText', 'Symbolic'],
      ['symbolicTarget', 'Symbolic target'],
      ['subject', '提交主题'],
      ['committerDate', '提交时间'],
    ];
    var rows = (remoteRefs || []).map(function (ref) {
      var copy = Object.assign({}, ref);
      copy.isSymbolicText = ref.isSymbolic ? '是' : '否';
      return copy;
    });
    target.appendChild(buildTable(
      target.ownerDocument,
      'branch-remote-table',
      columns,
      rows,
      '本地快照中没有 remote-tracking refs；这不表示远端仓库为空。'
    ));
  }

  function renderWarnings(warnings, target) {
    clear(target);
    var documentRef = target.ownerDocument;
    if (!(warnings || []).length) {
      target.appendChild(element(documentRef, 'div', 'branch-warning-clear', '快照生成器未报告警告。'));
      return;
    }
    warnings.forEach(function (warning) {
      target.appendChild(element(documentRef, 'div', 'branch-warning-item', warning));
    });
  }

  function fillSelect(select, allLabel, values, labels) {
    clear(select);
    var documentRef = select.ownerDocument;
    var allOption = element(documentRef, 'option', '', allLabel);
    allOption.value = '';
    select.appendChild(allOption);
    values.forEach(function (value) {
      var option = element(documentRef, 'option', '', labels && labels[value] ? labels[value] : value);
      option.value = value;
      select.appendChild(option);
    });
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function isMetadataFlag(value) {
    return typeof value === 'boolean' || isNonEmptyString(value);
  }

  function snapshotError(snapshot) {
    if (!isRecord(snapshot)) return '未找到分支快照。';
    if (snapshot.schemaVersion !== 1) return '分支快照 schemaVersion 必须为 1。';
    if (!isNonEmptyString(snapshot.repoRoot)) return '分支快照缺少有效的仓库根路径。';
    if (typeof snapshot.generatedAt !== 'string' || !snapshot.generatedAt
      || typeof snapshot.mainBranch !== 'string' || !snapshot.mainBranch) {
      return '分支快照缺少生成时间或配置主线。';
    }
    if (!Array.isArray(snapshot.branches) || snapshot.branches.length === 0) return '分支快照为空或格式无效。';
    if (!Array.isArray(snapshot.remoteRefs) || !Array.isArray(snapshot.worktrees)
      || !Array.isArray(snapshot.duplicateTipGroups) || !Array.isArray(snapshot.warnings)) {
      return '分支快照缺少必需的数据集合。';
    }
    var summary = snapshot.summary;
    var summaryFields = [
      'localBranchCount', 'remoteRefCount', 'worktreeCount', 'ancestorCount',
      'nonAncestorCount', 'duplicateTipGroupCount', 'warningCount',
    ];
    if (!isRecord(summary) || summaryFields.some(function (field) {
      return !Number.isFinite(summary[field]) || summary[field] < 0;
    })) return '分支快照缺少完整有效的 canonical summary。';
    var requiredBranchStrings = ['branchName', 'headFull', 'headShort', 'prefix', 'governanceSuggestion'];
    var branchStringFields = [
      'subject', 'author', 'committerDate', 'upstream', 'upstreamTrack',
      'worktreePath', 'worktreeDirty', 'duplicateTipGroup',
    ];
    var invalidBranch = snapshot.branches.some(function (branch) {
      return !isRecord(branch)
        || requiredBranchStrings.some(function (field) {
          return typeof branch[field] !== 'string' || !branch[field];
        })
        || branchStringFields.some(function (field) { return typeof branch[field] !== 'string'; })
        || ['current', 'ancestor', 'non_ancestor'].indexOf(branch.gitRelation) === -1
        || !Number.isFinite(branch.ahead) || branch.ahead < 0
        || !Number.isFinite(branch.behind) || branch.behind < 0;
    });
    if (invalidBranch) return '快照包含字段不完整或类型无效的本地分支记录。';
    var currentBranches = snapshot.branches.filter(function (branch) {
      return branch.gitRelation === 'current';
    });
    if (currentBranches.length !== 1 || currentBranches[0].branchName !== snapshot.mainBranch) {
      return '快照必须且只能包含一个与配置主线一致的 current 分支。';
    }

    var invalidRemoteRef = snapshot.remoteRefs.some(function (ref) {
      return !isRecord(ref)
        || ['branchName', 'headFull', 'headShort', 'refKind', 'symbolicTarget', 'subject', 'committerDate']
          .some(function (field) { return typeof ref[field] !== 'string'; })
        || !isNonEmptyString(ref.branchName)
        || !isNonEmptyString(ref.headFull)
        || !isNonEmptyString(ref.headShort)
        || !isNonEmptyString(ref.refKind)
        || typeof ref.isSymbolic !== 'boolean';
    });
    if (invalidRemoteRef) return '快照包含字段不完整或类型无效的 remote-tracking ref。';

    var invalidWorktree = snapshot.worktrees.some(function (worktree) {
      return !isRecord(worktree)
        || !isNonEmptyString(worktree.path)
        || !isNonEmptyString(worktree.headFull)
        || typeof worktree.branchName !== 'string'
        || typeof worktree.detached !== 'boolean'
        || !isMetadataFlag(worktree.locked)
        || !isMetadataFlag(worktree.prunable);
    });
    if (invalidWorktree) return '快照包含字段不完整或类型无效的 worktree 记录。';

    var invalidDuplicateGroup = snapshot.duplicateTipGroups.some(function (group) {
      return !isRecord(group)
        || !isNonEmptyString(group.id)
        || !isNonEmptyString(group.headFull)
        || !Array.isArray(group.branches)
        || group.branches.length === 0
        || group.branches.some(function (branchName) { return !isNonEmptyString(branchName); });
    });
    if (invalidDuplicateGroup) return '快照包含字段不完整或类型无效的重复指针组。';

    if (snapshot.warnings.some(function (warning) { return typeof warning !== 'string'; })) {
      return '快照警告集合包含非文本记录。';
    }

    var expectedSummary = {
      localBranchCount: snapshot.branches.length,
      remoteRefCount: snapshot.remoteRefs.length,
      worktreeCount: snapshot.worktrees.length,
      ancestorCount: snapshot.branches.filter(function (branch) { return branch.gitRelation === 'ancestor'; }).length,
      nonAncestorCount: snapshot.branches.filter(function (branch) { return branch.gitRelation === 'non_ancestor'; }).length,
      duplicateTipGroupCount: snapshot.duplicateTipGroups.length,
      warningCount: snapshot.warnings.length,
    };
    if (summaryFields.some(function (field) { return summary[field] !== expectedSummary[field]; })) {
      return '分支快照 canonical summary 与实际记录数量不一致。';
    }

    var provenance = snapshot.provenance;
    var provenanceFields = [
      'semantics', 'sourceCheckoutBranch', 'sourceCheckoutHead',
      'configuredMainlineHead', 'observationNote',
    ];
    if (!isRecord(provenance)
      || provenanceFields.some(function (field) { return typeof provenance[field] !== 'string'; })
      || !isNonEmptyString(provenance.semantics)
      || !isNonEmptyString(provenance.configuredMainlineHead)
      || !isNonEmptyString(provenance.observationNote)) {
      return '快照缺少完整有效的 as-of provenance。';
    }

    var governance = snapshot.governance;
    if (!isRecord(governance)
      || !isNonEmptyString(governance.defaultRemote)
      || !Number.isFinite(governance.staleAfterDays)
      || governance.staleAfterDays < 0) {
      return '快照缺少完整有效的治理配置。';
    }
    return '';
  }

  function mountMobileNavigation(documentRef) {
    if (!documentRef) return false;
    var nav = documentRef.getElementById('branch-primary-nav');
    var button = documentRef.getElementById('branch-mobile-menu');
    if (!nav || !button) return false;
    button.addEventListener('click', function () {
      var open = !nav.classList.contains('open');
      if (open) nav.classList.add('open');
      else nav.classList.remove('open');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? '关闭主导航' : '打开主导航');
    });
    return true;
  }

  function mount(documentRef, snapshot) {
    if (!documentRef) return false;
    var status = documentRef.getElementById('branch-status');
    var error = snapshotError(snapshot);
    if (error) {
      if (status) {
        status.setAttribute('role', 'alert');
        status.setAttribute('aria-live', 'assertive');
        status.classList.add('is-error');
        status.textContent = error + ' 请运行 npm run board:branches 后重新打开页面。';
      }
      return false;
    }

    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.classList.remove('is-error');
    status.textContent = '本地快照已载入：' + snapshot.generatedAt + '；仅表示生成时刻事实。';
    renderSnapshotHeader(snapshot, documentRef.getElementById('snapshot-header'));
    renderKpis(snapshot, documentRef.getElementById('branch-kpis'));
    renderTopology(snapshot, documentRef.getElementById('branch-topology'));
    renderRemoteRefs(snapshot.remoteRefs, documentRef.getElementById('remote-refs'));
    renderWarnings(snapshot.warnings, documentRef.getElementById('snapshot-warnings'));

    var search = documentRef.getElementById('branch-search');
    var relation = documentRef.getElementById('relation-filter');
    var worktree = documentRef.getElementById('worktree-filter');
    var prefix = documentRef.getElementById('prefix-filter');
    var governance = documentRef.getElementById('governance-filter');
    var resultCount = documentRef.getElementById('branch-result-count');
    var ledger = documentRef.getElementById('branch-ledger');
    fillSelect(relation, '全部关系', ['current', 'ancestor', 'non_ancestor'], {
      current: '当前主线', ancestor: '祖先分支', non_ancestor: '未汇入主线',
    });
    fillSelect(worktree, '全部工作区状态', ['active', 'dirty', 'clean', 'unknown', 'none'], {
      active: '有活跃工作区', dirty: '工作区有改动', clean: '工作区干净', unknown: '工作区状态未知', none: '无工作区',
    });
    fillSelect(prefix, '全部前缀', uniqueSorted(snapshot.branches.map(function (branch) { return branch.prefix; })));
    fillSelect(governance, '全部治理建议', uniqueSorted(snapshot.branches.map(function (branch) { return branch.governanceSuggestion; })));

    function updateLedger() {
      var visible = filterBranches(snapshot.branches, {
        search: search.value,
        relation: relation.value,
        worktree: worktree.value,
        prefix: prefix.value,
        governance: governance.value,
      });
      renderLedger(visible, ledger);
      resultCount.textContent = visible.length
        ? '当前显示 ' + visible.length + ' / ' + snapshot.branches.length + ' 条本地分支。'
        : '没有匹配的分支；快照包含 ' + snapshot.branches.length + ' 条本地分支，请调整筛选条件。';
    }
    [search, relation, worktree, prefix, governance].forEach(function (control) {
      control.addEventListener(control === search ? 'input' : 'change', updateLedger);
    });
    updateLedger();
    return true;
  }

  if (root && root.document) {
    root.document.addEventListener('DOMContentLoaded', function () {
      mountMobileNavigation(root.document);
      mount(root.document, root.WES_BRANCH_SNAPSHOT);
    });
  }

  return {
    filterBranches: filterBranches,
    groupNonAncestorsByPrefix: groupNonAncestorsByPrefix,
    mount: mount,
    mountMobileNavigation: mountMobileNavigation,
    renderKpis: renderKpis,
    renderTopology: renderTopology,
    renderLedger: renderLedger,
    renderRemoteRefs: renderRemoteRefs,
  };
}));
