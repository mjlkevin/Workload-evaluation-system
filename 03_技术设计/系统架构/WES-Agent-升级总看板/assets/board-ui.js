/**
 * WES 项目管理总看板 — 渐进增强脚本（board-ui.js）
 *
 * 职责（无依赖、可安全重复执行）：
 * 1. 分组导航下拉（点击 / Esc / 点击外部 / aria-expanded）
 * 2. 移动端菜单：点击链接后自动收起
 * 3. 滚动进场动效（IntersectionObserver，尊重 prefers-reduced-motion）
 * 4. KPI 数字滚动与进度条填充动画
 * 5. [data-tech-collapse] 区块 → 可折叠「技术细节」（业务摘要默认保留，技术细节默认收起）
 * 6. 页面存在多个折叠块时，注入「全部展开 / 全部收起」工具条
 *
 * 渐进增强原则：脚本不可用时，全部内容保持可见，导航链接保持可跳转。
 */
(function () {
  'use strict';

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 忽略：老浏览器按默认动效处理 */ }

  /* ── 1. 分组导航下拉（悬停为主，点击为降级）── */
  function initNavGroups() {
    var groups = Array.prototype.slice.call(document.querySelectorAll('.nav-group'));
    if (!groups.length) return;

    function openGroup(group) {
      group.classList.add('open');
      var btn = group.querySelector('.nav-group-btn');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
    function closeGroup(group) {
      group.classList.remove('open');
      var btn = group.querySelector('.nav-group-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    function closeAll(except) {
      groups.forEach(function (g) {
        if (g !== except) closeGroup(g);
      });
    }

    groups.forEach(function (group) {
      var btn = group.querySelector('.nav-group-btn');
      if (!btn) return;

      // 鼠标悬停：打开当前分组，关闭其他
      group.addEventListener('mouseenter', function () {
        closeAll(group);
        openGroup(group);
      });
      group.addEventListener('mouseleave', function (e) {
        // 如果鼠标移到了下拉菜单内部，不关闭
        var related = e.relatedTarget;
        if (related && group.contains(related)) return;
        closeGroup(group);
      });

      // 点击按钮：切换（作为触摸设备降级）
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = group.classList.contains('open');
        if (isOpen) {
          closeGroup(group);
        } else {
          closeAll(group);
          openGroup(group);
        }
      });

      // 键盘焦点进入分组时保持可见（可访问性）
      group.addEventListener('focusin', function () {
        closeAll(group);
        openGroup(group);
      });
    });

    // 点击页面空白处关闭所有
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.nav-group')) closeAll(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  /* ── 2. 移动端菜单收起 ── */
  function initMobileNav() {
    var nav = document.querySelector('.navlinks');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      var target = e.target;
      if (target && target.tagName === 'A' && nav.classList.contains('open')) {
        nav.classList.remove('open');
      }
    });
  }

  /* ── 3. 滚动进场动效（渐进增强：仅 JS 可用时隐藏待进场元素）── */
  function initReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll(
      '.kpi, .card, .res-card, .flow-step, .lifecycle-step, .timeline-card, .roadmap, .backlog-column, .panel'
    ));
    if (!items.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    items.forEach(function (el) { el.classList.add('reveal-pending'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -28px 0px' });
    items.forEach(function (el) { io.observe(el); });
    // 兜底：若 IO 在异常环境下永不触发（如零尺寸嵌入窗口），1.5s 后强制显示，避免内容永久隐藏
    setTimeout(function () {
      items.forEach(function (el) {
        if (el.classList.contains('reveal-pending') && !el.classList.contains('in')) el.classList.add('in');
      });
    }, 1500);
  }

  /* ── 4. KPI 数字与进度条动画 ── */
  function animateCount(el) {
    var text = el.textContent.trim();
    var m = /^(\d{1,4})$/.exec(text);
    if (!m || reduceMotion) return;
    var target = parseInt(m[1], 10);
    if (!target) return;
    var dur = 650;
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initKpiMotion() {
    var bars = Array.prototype.slice.call(document.querySelectorAll('.bar > i'));
    bars.forEach(function (i) {
      var w = i.style.width;
      if (!w) return;
      i.dataset.targetWidth = w;
      if (!reduceMotion) i.style.width = '0%';
    });
    var nums = Array.prototype.slice.call(document.querySelectorAll('.kpi .v'));

    if (reduceMotion || !('IntersectionObserver' in window)) {
      bars.forEach(function (i) { if (i.dataset.targetWidth) i.style.width = i.dataset.targetWidth; });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.classList.contains('kpi')) {
          var v = el.querySelector('.v');
          if (v) animateCount(v);
          var bar = el.querySelector('.bar > i');
          if (bar && bar.dataset.targetWidth) bar.style.width = bar.dataset.targetWidth;
        } else if (el.dataset.targetWidth) {
          el.style.width = el.dataset.targetWidth;
        }
        io.unobserve(el);
      });
    }, { threshold: 0.25 });

    Array.prototype.slice.call(document.querySelectorAll('.kpi')).forEach(function (k) { io.observe(k); });
    bars.forEach(function (i) {
      if (!i.closest('.kpi')) io.observe(i);
    });
    nums.forEach(function () { /* 数字随所属 .kpi 触发，这里仅保留引用兼容性 */ });
  }

  /* ── 5/6. 技术细节折叠与工具条 ── */
  function initTechCollapse() {
    var blocks = Array.prototype.slice.call(document.querySelectorAll('[data-tech-collapse]'));
    if (!blocks.length) return;

    blocks.forEach(function (block) {
      if (block.dataset.techReady === '1') return;
      block.dataset.techReady = '1';

      var label = block.dataset.techLabel || block.getAttribute('data-tech-collapse') || '技术细节';
      var details = document.createElement('details');
      details.className = 'tech-detail';
      var summary = document.createElement('summary');
      summary.innerHTML =
        '<span class="td-caret" aria-hidden="true"></span>' +
        '<span class="td-label">' + label + '</span>' +
        '<span class="td-hint">点击展开 · 面向实施与审计</span>';
      var body = document.createElement('div');
      body.className = 'tech-detail-body';

      // 保留业务标题在外层：优先 .sec-head；其次 h-num 结构保留 h2（及编号）
      var head = block.querySelector(':scope > .wrap > .sec-head, :scope > .sec-head');
      var parent, cursor;
      if (head) {
        parent = head.parentNode;
        cursor = head.nextSibling;
      } else {
        var h2 = block.querySelector(':scope > h2');
        parent = block;
        cursor = h2 ? h2.nextSibling : block.firstChild;
      }
      details.appendChild(summary);
      details.appendChild(body);
      while (cursor) {
        var next = cursor.nextSibling;
        body.appendChild(cursor);
        cursor = next;
      }
      parent.appendChild(details);
    });

    // 工具条：存在 ≥2 个折叠块时提供全部展开 / 收起
    if (blocks.length >= 2) {
      var first = blocks[0];
      var anchor = first.closest('section') || first;
      if (document.querySelector('.tech-toolbar')) return;
      var toolbar = document.createElement('div');
      toolbar.className = 'tech-toolbar wrap';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', '技术细节显示控制');
      toolbar.innerHTML =
        '<span class="tt-note">技术细节默认收起，业务读者可忽略；AI Agent / 审计可通过展开或源码检索获取完整信息。</span>' +
        '<div class="tt-actions">' +
        '<button type="button" class="tt-btn" data-td-all="open">全部展开</button>' +
        '<button type="button" class="tt-btn" data-td-all="close">全部收起</button>' +
        '</div>';
      anchor.parentNode.insertBefore(toolbar, anchor);
      toolbar.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-td-all]');
        if (!btn) return;
        var open = btn.getAttribute('data-td-all') === 'open';
        document.querySelectorAll('.tech-detail').forEach(function (d) { d.open = open; });
      });
    }
  }

  // B5 试点 F1：行内文本上限 —— 看板表格超 120 字单元格默认收起到 3 行，点击/回车展开
  function initCellClamp() {
    function toggle(td) {
      var open = td.classList.toggle('cell-open');
      td.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    document.querySelectorAll('table[data-board-table] tbody td').forEach(function (td) {
      var text = (td.textContent || '').trim();
      if (text.length <= 120 || td.querySelector('table, ul, ol, details')) return;
      td.classList.add('cell-clamp');
      td.setAttribute('tabindex', '0');
      td.setAttribute('role', 'button');
      td.setAttribute('aria-expanded', 'false');
      td.title = '点击展开/收起';
    });
    document.addEventListener('click', function (e) {
      var td = e.target.closest('td.cell-clamp');
      if (td) toggle(td);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var td = e.target.closest ? e.target.closest('td.cell-clamp') : null;
      if (td) { e.preventDefault(); toggle(td); }
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    initNavGroups();
    initMobileNav();
    initTechCollapse();
    initCellClamp();
    initReveal();
    initKpiMotion();
  });
})();
