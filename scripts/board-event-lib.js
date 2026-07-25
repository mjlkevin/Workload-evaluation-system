const fs = require('fs');
const path = require('path');

const BOARD_DIR = path.join(__dirname, '..', '03_技术设计', '系统架构', 'WES-Agent-升级总看板');

const ALLOWED_TYPES = new Set([
  'requirement_intake',
  'implementation',
  'verification',
  'risk',
  'source_asset',
  'loop_cleanup',
  'process_change',
]);

const ALLOWED_PAGES = new Set([
  'index',
  'issues',
  'defects',
  'requirements',
  'plan',
  'testing',
  'monitoring',
  'risks',
  'changes',
  'sources',
  'collaboration-protocol',
]);

const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*\S+/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
];

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineCode(value) {
  return `<code class="inline">${htmlEscape(value)}</code>`;
}

function hasSensitiveContent(value) {
  const text = JSON.stringify(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateBoardEvent(rawEvent) {
  const event = isPlainObject(rawEvent) ? rawEvent : {};
  const errors = [];

  for (const field of ['id', 'date', 'type', 'scope', 'summary', 'status', 'pages']) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (event.id && !/^BE-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/i.test(event.id)) {
    errors.push('id must match BE-YYYY-MM-DD-slug');
  }
  if (event.date && !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    errors.push('date must use YYYY-MM-DD');
  }
  if (event.type && !ALLOWED_TYPES.has(event.type)) {
    errors.push(`unsupported type: ${event.type}`);
  }
  if (event.pages !== undefined) {
    if (!Array.isArray(event.pages) || event.pages.length === 0) {
      errors.push('pages must be a non-empty array');
    } else {
      for (const page of event.pages) {
        if (!ALLOWED_PAGES.has(page)) errors.push(`unsupported page: ${page}`);
      }
    }
  }
  if (event.evidence !== undefined && !Array.isArray(event.evidence)) {
    errors.push('evidence must be an array when provided');
  }
  if (hasSensitiveContent(event)) {
    errors.push('event contains sensitive-looking content');
  }

  return { event, errors };
}

function statusClass(status) {
  const text = String(status || '');
  if (/失败|阻断|返工|风险|warn|待/.test(text)) return 'warn';
  if (/通过|完成|已实施|已交付|pass|done|清理/.test(text)) return 'done';
  return 'run';
}

function renderEvidence(evidence = []) {
  const items = Array.isArray(evidence) ? evidence : [];
  if (!items.length) return '';
  const chunks = items.map((item) => {
    const ref = item?.ref ? inlineCode(item.ref) : '';
    const result = item?.result ? `（${htmlEscape(item.result)}）` : '';
    const summary = item?.summary ? `：${htmlEscape(item.summary)}` : '';
    return `${ref}${result}${summary}`;
  });
  return ` 证据：${chunks.join('；')}。`;
}

function sentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[。.!?？]$/.test(text) ? text : `${text}。`;
}

function renderChangeRow(event) {
  const stage = event.board?.change?.stage || event.scope;
  const result = event.board?.change?.result || event.status;
  const body = [
    `${htmlEscape(event.date)}：${htmlEscape(sentence(event.summary))}`,
    renderEvidence(event.evidence),
    event.next ? ` 下一步：${htmlEscape(sentence(event.next))}` : '',
  ].join('');
  const cls = statusClass(result);
  return `          <tr data-board-event-id="${htmlEscape(event.id)}"><td class="mono">${htmlEscape(stage)}</td><td>${body}</td><td><span class="status ${cls}"><span class="dot"></span>${htmlEscape(result)}</span></td></tr>`;
}

function renderTestingRows(event) {
  const rows = Array.isArray(event.board?.testing) ? event.board.testing : [];
  return rows.map((item, index) => {
    const command = item.command || item.scope || event.scope;
    const result = item.result || event.status;
    const summary = item.summary || event.summary;
    const cls = statusClass(result);
    const id = `${event.id}:testing:${index + 1}`;
    return `        <tr data-board-event-id="${htmlEscape(id)}"><td class="mono">${htmlEscape(command)}</td><td><span class="status ${cls}"><span class="dot"></span>${htmlEscape(result)}</span></td><td>${htmlEscape(event.date)}：${htmlEscape(summary)}</td></tr>`;
  });
}

function insertAfterMarker(html, marker, row) {
  const index = html.indexOf(marker);
  if (index === -1) {
    throw new Error(`marker not found: ${marker}`);
  }
  const insertAt = index + marker.length;
  return `${html.slice(0, insertAt)}\n${row}${html.slice(insertAt)}`;
}

function applyBoardEventToHtml(html, event, page) {
  if (html.includes(`data-board-event-id="${event.id}`)) {
    return { html, changed: false };
  }

  if (page === 'changes') {
    const marker = '<tr><th>阶段</th><th>工作内容</th><th>结果</th></tr>';
    return { html: insertAfterMarker(html, marker, renderChangeRow(event)), changed: true };
  }

  if (page === 'testing') {
    const rows = renderTestingRows(event);
    if (!rows.length) return { html, changed: false };
    const marker = '<tr><th>命令</th><th>最近结果</th><th>覆盖范围</th></tr>';
    return { html: insertAfterMarker(html, marker, rows.join('\n')), changed: true };
  }

  return { html, changed: false };
}

function readEventFile(filePath) {
  const fullPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function applyEventToBoard(event, options = {}) {
  const boardDir = options.boardDir || BOARD_DIR;
  const touched = [];
  for (const page of ['changes', 'testing']) {
    if (!event.pages.includes(page)) continue;
    const htmlPath = path.join(boardDir, `${page}.html`);
    const current = fs.readFileSync(htmlPath, 'utf8');
    const result = applyBoardEventToHtml(current, event, page);
    if (result.changed) {
      fs.writeFileSync(htmlPath, result.html, 'utf8');
      touched.push(path.relative(process.cwd(), htmlPath));
    }
  }
  return touched;
}

module.exports = {
  ALLOWED_PAGES,
  ALLOWED_TYPES,
  BOARD_DIR,
  applyBoardEventToHtml,
  applyEventToBoard,
  htmlEscape,
  readEventFile,
  renderChangeRow,
  renderTestingRows,
  validateBoardEvent,
};
