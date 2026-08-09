/**
 * WES 总看板三池表格行为层（渐进增强，无 JS 时表格原样全量可见）
 *
 * 依据 open-design（shadcn 包）规范：留白优先于边框、150–250ms 过渡、
 * 显式状态呈现（hover/focus/disabled），样式全部走看板既有 tokens。
 *
 * 两种模式（由 data-board-table 标记决定）：
 * - full（issues / defects）：list.js 接管搜索、状态筛选、表头排序、分页与计数；
 * - sort（requirements 主台账）：页面已有自研筛选与用户级干预标识，
 *   仅叠加轻量表头排序，避免双套筛选冲突。
 *
 * a11y：搜索框/筛选器带 aria-label；计数区 aria-live=polite；
 * 排序状态同步 aria-sort；分页按钮 disabled 态显式呈现。
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function cellText(td) {
    return (td.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* list.js 的 values() 取的是 innerHTML，比较/展示前需剥离标签取纯文本 */
  function stripHtml(v) {
    return String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /* ── 轻量表头排序（sort 模式与 list.js 不可用时的降级共用）── */
  function compareValues(a, b) {
    var na = parseFloat(a.replace(/[^\d.-]/g, ''));
    var nb = parseFloat(b.replace(/[^\d.-]/g, ''));
    var aIsNum = !isNaN(na) && /^[\s\d.,:%\-+]+$/.test(a) && a.trim() !== '';
    var bIsNum = !isNaN(nb) && /^[\s\d.,:%\-+]+$/.test(b) && b.trim() !== '';
    if (aIsNum && bIsNum) return na - nb;
    return a.localeCompare(b, 'zh-Hans-CN');
  }

  function initSimpleSort(table) {
    var heads = Array.prototype.slice.call(table.querySelectorAll('thead th'));
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    heads.forEach(function (th, col) {
      th.setAttribute('scope', 'col');
      th.setAttribute('aria-sort', 'none');
      th.classList.add('th-sortable');
      th.tabIndex = 0;
      function toggle() {
        var asc = th.getAttribute('aria-sort') !== 'ascending';
        heads.forEach(function (h) { h.setAttribute('aria-sort', 'none'); h.classList.remove('sort-asc', 'sort-desc'); });
        th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
        th.classList.add(asc ? 'sort-asc' : 'sort-desc');
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
        rows.sort(function (r1, r2) {
          var c1 = r1.children[col], c2 = r2.children[col];
          var v1 = c1 ? cellText(c1) : '', v2 = c2 ? cellText(c2) : '';
          var cmp = compareValues(v1, v2);
          return asc ? cmp : -cmp;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      }
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  /* ── full 模式：list.js 全功能 ── */
  function initFullTable(table) {
    var block = table.closest('.tbl-block');
    if (!block) return;

    var theadCells = Array.prototype.slice.call(table.querySelectorAll('thead th'));
    var colCount = theadCells.length;
    var valueNames = [];
    for (var i = 0; i < colCount; i++) valueNames.push('tc-' + i);

    var pageSize = parseInt(table.getAttribute('data-page-size'), 10) || 10;
    var filterCol = parseInt(table.getAttribute('data-filter-col'), 10);

    /* 表头预处理必须在 new List() 之前：list.js 构造时即快照 .sort 元素并绑定点击 */
    theadCells.forEach(function (th, idx) {
      th.setAttribute('scope', 'col');
      // sort 类：list.js 排序钩子；th-sortable：看板样式；data-sort：指定 valueName
      th.classList.add('sort', 'th-sortable');
      th.setAttribute('data-sort', 'tc-' + idx);
      th.tabIndex = 0;
      th.setAttribute('aria-sort', 'none');
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
      });
    });

    var list;
    try {
      list = new window.List(block, {
        // listClass 需指向包含数据行的直接容器（tbody，带钩子类）
        listClass: 'tbody',
        item: undefined,
        valueNames: valueNames,
        page: pageSize,
        // searchClass/sortClass 不用：避免与手动绑定重复触发
      });
    } catch (e) {
      initSimpleSort(table); // list.js 异常时至少保留排序
      return;
    }

    var searchInput = block.querySelector('.tbl-search');
    if (searchInput) searchInput.addEventListener('input', function () { list.search(this.value); });

    /* 状态筛选：选项从数据列去重生成 */
    var filterSel = block.querySelector('.tbl-filter');
    var currentFilter = '';
    if (filterSel && filterCol >= 0) {
      var seen = {};
      list.items.forEach(function (item) {
        var v = stripHtml(item.values()['tc-' + filterCol]);
        if (v && !seen[v]) seen[v] = true;
      });
      Object.keys(seen).forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        filterSel.appendChild(opt);
      });
      filterSel.addEventListener('change', function () {
        currentFilter = this.value;
        applyFilter();
      });
    }

    function applyFilter() {
      if (!currentFilter) { list.filter(); return; }
      list.filter(function (item) {
        return stripHtml(item.values()['tc-' + filterCol]) === currentFilter;
      });
    }

    /* 分页（list.js 核心 show()，UI 用看板自有样式自绘） */
    var page = 1;
    var info = block.querySelector('.tbl-page-info');
    var prevBtn = block.querySelector('[data-pg="prev"]');
    var nextBtn = block.querySelector('[data-pg="next"]');
    var countEl = block.querySelector('.tbl-count');

    function totalPages() {
      // list.js v2 的分页计数属性为 matchingItems（非 matching）
      return Math.max(1, Math.ceil(list.matchingItems.length / pageSize));
    }
    function render() {
      var tp = totalPages();
      if (page > tp) page = tp;
      if (page < 1) page = 1;
      list.show((page - 1) * pageSize + 1, pageSize);
      if (info) info.textContent = page + ' / ' + tp;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = page >= tp;
      if (countEl) countEl.textContent = '共 ' + list.matchingItems.length + ' 条';
    }
    if (prevBtn) prevBtn.addEventListener('click', function () { page--; render(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { page++; render(); });

    /* 搜索/筛选变化后回到第 1 页并同步 aria-sort */
    list.on('searchComplete', function () { page = 1; render(); });
    list.on('filterComplete', function () { page = 1; render(); });
    /* 排序方向由 list.js 在 th 上切换 asc/desc 类，updated 后同步 aria-sort */
    list.on('updated', function () {
      theadCells.forEach(function (h) {
        h.classList.remove('sort-asc', 'sort-desc');
        if (h.classList.contains('asc')) { h.setAttribute('aria-sort', 'ascending'); h.classList.add('sort-asc'); }
        else if (h.classList.contains('desc')) { h.setAttribute('aria-sort', 'descending'); h.classList.add('sort-desc'); }
        else h.setAttribute('aria-sort', 'none');
      });
    });

    render();
  }

  ready(function () {
    var tables = Array.prototype.slice.call(document.querySelectorAll('table[data-board-table]'));
    tables.forEach(function (table) {
      var mode = table.getAttribute('data-mode');
      if (mode === 'sort' || typeof window.List !== 'function') {
        initSimpleSort(table);
      } else {
        initFullTable(table);
      }
    });
  });
})();
