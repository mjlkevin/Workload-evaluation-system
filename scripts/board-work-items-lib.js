const fs = require('fs');
const path = require('path');

const { htmlEscape } = require('./board-event-lib');

const BOARD_DIR = path.join(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');
const DEFAULT_REGISTRY_PATH = path.join(BOARD_DIR, 'work-items', 'board-work-items.json');

const ISSUE_DISPOSITIONS = new Set(['pending', 'defect', 'requirement', 'risk', 'closed']);
const ISSUE_STATUSES = new Set(['new', 'analyzing', 'analyzed', 'converted', 'closed']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateRequired(record, fields, label, errors) {
  for (const field of fields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`${label} missing required field: ${field}`);
    }
  }
}

function validateWorkItemRegistry(rawRegistry) {
  const registry = rawRegistry && typeof rawRegistry === 'object' ? rawRegistry : {};
  const errors = [];

  if (!registry.updatedAt || !/^\d{4}-\d{2}-\d{2}$/.test(registry.updatedAt)) {
    errors.push('updatedAt must use YYYY-MM-DD');
  }
  if (!Array.isArray(registry.issues)) errors.push('issues must be an array');
  if (!Array.isArray(registry.defects)) errors.push('defects must be an array');

  const issueIds = new Set();
  const defectIds = new Set();
  for (const issue of asArray(registry.issues)) {
    validateRequired(issue, ['id', 'date', 'title', 'source', 'rawFeedback', 'triageStatus', 'disposition', 'priority', 'next'], `issue ${issue.id || '<unknown>'}`, errors);
    if (issue.id) {
      if (issueIds.has(issue.id)) errors.push(`duplicate issue id: ${issue.id}`);
      issueIds.add(issue.id);
    }
    if (issue.date && !/^\d{4}-\d{2}-\d{2}$/.test(issue.date)) {
      errors.push(`issue ${issue.id} date must use YYYY-MM-DD`);
    }
    if (issue.triageStatus && !ISSUE_STATUSES.has(issue.triageStatus)) {
      errors.push(`issue ${issue.id} unsupported triageStatus: ${issue.triageStatus}`);
    }
    const type = issue.disposition?.type;
    if (!type || !ISSUE_DISPOSITIONS.has(type)) {
      errors.push(`issue ${issue.id} unsupported disposition.type: ${type}`);
    }
    if (type && type !== 'pending' && !issue.disposition?.ref) {
      errors.push(`issue ${issue.id} disposition.ref is required when disposition.type is ${type}`);
    }
  }

  for (const defect of asArray(registry.defects)) {
    validateRequired(defect, ['id', 'linkedIssueId', 'rpId', 'title'], `defect ${defect.id || '<unknown>'}`, errors);
    if (defect.id) {
      if (defectIds.has(defect.id)) errors.push(`duplicate defect id: ${defect.id}`);
      defectIds.add(defect.id);
    }
    if (defect.linkedIssueId && !issueIds.has(defect.linkedIssueId)) {
      errors.push(`defect ${defect.id} unknown linkedIssueId: ${defect.linkedIssueId}`);
    }
  }

  return { registry, errors };
}

function computeWorkItemSummary(registry) {
  const issues = asArray(registry.issues);
  const defects = asArray(registry.defects);
  return {
    issueTotal: issues.length,
    issuePending: issues.filter((issue) => issue.disposition?.type === 'pending').length,
    issueToDefect: issues.filter((issue) => issue.disposition?.type === 'defect').length,
    issueToRequirement: issues.filter((issue) => issue.disposition?.type === 'requirement').length,
    issueToRisk: issues.filter((issue) => issue.disposition?.type === 'risk').length,
    defectTotal: defects.length,
    defectOpen: defects.filter((defect) => /open|rework|待返工|待修复/.test(defect.status || '')).length,
    defectFixed: defects.filter((defect) => /fixed|已修复|已实施|done/.test(defect.status || '')).length,
    defectManualPending: defects.filter((defect) => /manual_pending|人工|待复核/.test(`${defect.status || ''} ${defect.acceptance || ''}`)).length,
  };
}

function statusClass(value) {
  const text = String(value || '');
  if (/open|pending|rework|待|风险|warn|manual/.test(text)) return 'warn';
  if (/fixed|done|closed|已修复|已实施|已交付|通过/.test(text)) return 'done';
  return 'run';
}

function dispositionLabel(disposition = {}) {
  const labels = {
    pending: '待分析',
    defect: '转缺陷',
    requirement: '转需求',
    risk: '转风险',
    closed: '已关闭',
  };
  const label = labels[disposition.type] || disposition.type || '未分类';
  return disposition.ref ? `${label} · ${disposition.ref}` : label;
}

function renderNav(activeHref) {
  const navItems = [
    ['index.html', '总览'],
    ['roadmap.html', '路标管理'],
    ['design.html', '设计说明'],
    ['runtime.html', '任务运行时'],
    ['plan.html', '计划与进度'],
    ['testing.html', '测试'],
    ['monitoring.html', '监控与审计'],
    ['ops-health.html', '运维看板'],
    ['risks.html', '风险与决策'],
    ['changes.html', '变更记录'],
    ['sources.html', '文档事实源'],
    ['collaboration-protocol.html', '协作协议'],
    ['branches.html', '分支拓扑'],
    ['issues.html', '问题池'],
    ['defects.html', '缺陷池'],
    ['requirements.html', '需求池'],
  ];
  const links = navItems
    .map(([href, label]) => `        <a${href === activeHref ? ' class="active"' : ''} href="${href}">${label}</a>`)
    .join('\n');
  return `<aside class="sidebar" id="sidebar">
    <a class="sidebar-brand" href="index.html">
      <span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--brand-soft);color:var(--brand);font-weight:900;font-size:14px;">W</span>
      <span>WES 项目管理</span>
    </a>
    <nav class="sidebar-nav" aria-label="主导航">
${links}
    </nav>
    <div style="flex:1"></div>
    <div class="sidebar-pill">
      <span class="pill brand">Work Item Triage</span>
      <span class="pill">Issue → Defect / Requirement</span>
    </div>
  </aside>
  <button class="sidebar-toggle" id="sidebarToggle" aria-label="菜单">☰</button>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>`;
}

function renderDocumentStart(title, activeHref) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${htmlEscape(title)} · WES 项目管理</title>
  <link rel="stylesheet" href="assets/fonts/fonts.css" />
  <link rel="stylesheet" href="assets/base.css" />
  <link rel="stylesheet" href="assets/components.css" />
  <link rel="stylesheet" href="assets/pages.css" />
</head>
<body>${renderNav(activeHref)}
  <div class="main-content">
<main>`;
}

function renderDocumentEnd(label, updatedAt) {
  return `</main>
  </div>
  <footer>${htmlEscape(label)} · WES 项目管理 · ${htmlEscape(updatedAt)}</footer>
  <script>
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const overlay = document.getElementById('sidebarOverlay');
    if (toggle && sidebar && overlay) {
      toggle.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); });
      overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); });
    }
  </script>
</body>
</html>`;
}

function renderIssueRow(issue) {
  const cls = statusClass(issue.triageStatus);
  return `            <tr>
              <td class="mono">${htmlEscape(issue.id)}</td>
              <td>${htmlEscape(issue.date)}</td>
              <td>${htmlEscape(issue.title)}</td>
              <td>${htmlEscape(issue.source)}</td>
              <td>${htmlEscape(issue.rawFeedback)}</td>
              <td>${asArray(issue.evidence).map((item) => `<code class="inline">${htmlEscape(item)}</code>`).join(' ')}</td>
              <td><span class="status ${cls}"><span class="dot"></span>${htmlEscape(issue.triageStatus)}</span></td>
              <td>${htmlEscape(dispositionLabel(issue.disposition))}</td>
              <td>${htmlEscape(issue.next)}</td>
            </tr>`;
}

function renderDefectRow(defect) {
  const cls = statusClass(defect.status);
  return `            <tr>
              <td class="mono">${htmlEscape(defect.id)}</td>
              <td class="mono">${htmlEscape(defect.linkedIssueId)}</td>
              <td class="mono">${htmlEscape(defect.rpId)}</td>
              <td>${htmlEscape(defect.title)}</td>
              <td>${htmlEscape(defect.severity || '')}</td>
              <td><span class="status ${cls}"><span class="dot"></span>${htmlEscape(defect.status || '')}</span></td>
              <td>${htmlEscape(defect.affectedArea || '')}</td>
              <td>${htmlEscape(defect.fix || '')}</td>
              <td>${htmlEscape(defect.verification || '')}</td>
              <td>${htmlEscape(defect.acceptance || '')}</td>
            </tr>`;
}

function renderIssuesPage(registry) {
  const summary = computeWorkItemSummary(registry);
  return `${renderDocumentStart('问题池', 'issues.html')}
    <div class="doc-h">
      <div class="wrap">
        <div class="crumb">Work Item Triage</div>
        <h1>问题池</h1>
        <div class="meta">
          <span><b>定位</b> 用户原始反馈、截图、疑问和未定性现象的第一入口</span>
          <span><b>流转</b> Issue → triage → Defect / Requirement / Risk / Close</span>
          <span><b>更新日期</b> ${htmlEscape(registry.updatedAt)}</span>
        </div>
        <div class="pill-row" style="margin-top:18px">
          <span class="pill brand">${summary.issueTotal} 问题</span>
          <span class="pill warn">${summary.issuePending} 待分析</span>
          <span class="pill warn">${summary.issueToDefect} 转缺陷</span>
          <span class="pill brand">${summary.issueToRequirement} 转需求</span>
        </div>
      </div>
    </div>

    <section>
      <div class="wrap">
        <div class="sec-head">
          <div class="num">01 / Intake Rule</div>
          <h2>问题先行规则</h2>
          <p>所有原始反馈先记录为 Issue。只有完成 triage 后，才进入缺陷池或需求池，避免把尚未定性的问题直接排期或误标已交付。</p>
        </div>
        <div class="grid-3">
          <div class="card"><span class="pill brand">Issue</span><h3>保留原始事实</h3><p>记录用户原文、截图、会话、复现条件、当前影响和证据。</p></div>
          <div class="card"><span class="pill warn">Triage</span><h3>分析后分流</h3><p>判断是缺陷、需求、风险、测试证据，还是无需处理。</p></div>
          <div class="card"><span class="pill ok">Trace</span><h3>来源链路不断</h3><p>Defect / Requirement 必须能反查原始 Issue。</p></div>
        </div>
      </div>
    </section>

    <section>
      <div class="wrap">
        <div class="sec-head">
          <div class="num">02 / Issue Ledger</div>
          <h2>问题台账</h2>
          <p>本页只承载原始问题和 triage 结论；修复和需求规划分别进入缺陷池或需求池。</p>
        </div>
        <table>
          <tr><th>ID</th><th>日期</th><th>标题</th><th>来源</th><th>原始反馈</th><th>证据</th><th>分析状态</th><th>分流</th><th>下一步</th></tr>
${asArray(registry.issues).map(renderIssueRow).join('\n')}
        </table>
      </div>
    </section>
${renderDocumentEnd('问题池', registry.updatedAt)}`;
}

function renderDefectsPage(registry) {
  const summary = computeWorkItemSummary(registry);
  return `${renderDocumentStart('缺陷池', 'defects.html')}
    <div class="doc-h">
      <div class="wrap">
        <div class="crumb">Defect Governance</div>
        <h1>缺陷池</h1>
        <div class="meta">
          <span><b>定位</b> 已分析确认的错误行为、回归和质量缺口</span>
          <span><b>来源</b> 只从问题池或测试失败分流，不直接接收未定性原始反馈</span>
          <span><b>更新日期</b> ${htmlEscape(registry.updatedAt)}</span>
        </div>
        <div class="pill-row" style="margin-top:18px">
          <span class="pill brand">${summary.defectTotal} 缺陷</span>
          <span class="pill warn">${summary.defectOpen} 待修复 / 返工</span>
          <span class="pill ok">${summary.defectFixed} 已修复</span>
          <span class="pill warn">${summary.defectManualPending} 人工待复核</span>
        </div>
      </div>
    </div>

    <section>
      <div class="wrap">
        <div class="sec-head">
          <div class="num">01 / Defect Lifecycle</div>
          <h2>缺陷生命周期</h2>
          <p>缺陷必须保留 Issue 来源，按复现、修复、回归、人工复核关闭，不与新能力需求共用同一状态轴。</p>
        </div>
        <div class="lifecycle">
          <div class="lifecycle-step"><span class="ls-num">01</span><b>来源 Issue</b><small>用户反馈 / 测试失败 / 截图证据</small></div>
          <div class="lifecycle-step"><span class="ls-num">02</span><b>复现</b><small>实际结果、期望结果、影响范围</small></div>
          <div class="lifecycle-step"><span class="ls-num">03</span><b>修复</b><small>最小补丁与边界说明</small></div>
          <div class="lifecycle-step"><span class="ls-num">04</span><b>回归</b><small>自动化和必要人工复核</small></div>
        </div>
      </div>
    </section>

    <section>
      <div class="wrap">
        <div class="sec-head">
          <div class="num">02 / Defect Ledger</div>
          <h2>缺陷台账</h2>
          <p>缺陷台账聚焦已有能力不符合预期的事实，不承载新能力设计。</p>
        </div>
        <table>
          <tr><th>缺陷 ID</th><th>来源 Issue</th><th>关联 RP</th><th>标题</th><th>等级</th><th>状态</th><th>影响范围</th><th>修复口径</th><th>验证</th><th>验收</th></tr>
${asArray(registry.defects).map(renderDefectRow).join('\n')}
        </table>
      </div>
    </section>
${renderDocumentEnd('缺陷池', registry.updatedAt)}`;
}

function readWorkItemRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeWorkItemPages(registry, options = {}) {
  const boardDir = options.boardDir || BOARD_DIR;
  const outputs = [
    ['issues.html', renderIssuesPage(registry)],
    ['defects.html', renderDefectsPage(registry)],
  ];
  for (const [file, html] of outputs) {
    fs.writeFileSync(path.join(boardDir, file), html, 'utf8');
  }
  return outputs.map(([file]) => path.join(boardDir, file));
}

module.exports = {
  BOARD_DIR,
  DEFAULT_REGISTRY_PATH,
  computeWorkItemSummary,
  readWorkItemRegistry,
  renderDefectsPage,
  renderIssuesPage,
  validateWorkItemRegistry,
  writeWorkItemPages,
};
