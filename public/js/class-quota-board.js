/**
 * 后台「班级名额看板」
 * 页内切换（替换课程列表），非弹窗
 */
(function (global) {
  'use strict';

  var state = {
    grade: '六年级',
    rows: [],
    expanded: {},
    view: 'courses' // courses | board
  };
  var mounted = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiRequest(method, url, body) {
    if (typeof global.request === 'function') {
      return global.request(method, url, body);
    }
    throw new Error('admin request() 未就绪');
  }

  function toast(msg, type) {
    if (typeof global.toast === 'function') global.toast(msg, type || 'success');
    else alert(msg);
  }

  function ensureStyles() {
    if (document.getElementById('cqbStyle')) return;
    var style = document.createElement('style');
    style.id = 'cqbStyle';
    style.textContent =
      '.cqb-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:4px 0 14px;}' +
      '.cqb-grade-label{font-size:13px;font-weight:600;color:#334155;display:inline-flex;align-items:center;gap:8px;}' +
      '.cqb-grade-label select{height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;}' +
      '.cqb-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:10px;}' +
      '.cqb-table{width:100%;border-collapse:collapse;font-size:13px;}' +
      '.cqb-table th,.cqb-table td{padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:center;white-space:nowrap;}' +
      '.cqb-table th{background:#f0fdfa;color:#0f766e;font-weight:700;position:sticky;top:0;z-index:1;}' +
      '.cqb-table td.class-name{text-align:left;font-weight:600;}' +
      '.cqb-empty{padding:28px!important;color:#94a3b8;}' +
      '.cqb-status{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;}' +
      '.cqb-status.balanced{background:#d1fae5;color:#047857;}' +
      '.cqb-status.short{background:#fee2e2;color:#b91c1c;}' +
      '.cqb-status.surplus{background:#e2e8f0;color:#475569;}' +
      '.cqb-expand{border:1px solid #cbd5e1;background:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;}' +
      '.cqb-size-input{width:64px;height:30px;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-weight:600;}' +
      '.cqb-detail-row td{background:#f8fafc;padding:0!important;}' +
      '.cqb-detail{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.cqb-detail th,.cqb-detail td{padding:8px;border-bottom:1px solid #e2e8f0;}' +
      '.cqb-detail th{background:#ecfeff;position:static;}' +
      '.cqb-act{display:inline-flex;gap:4px;}' +
      '.cqb-act button{height:28px;padding:0 8px;border-radius:6px;border:1px solid #99f6e4;background:#fff;color:#0f766e;font-size:11px;font-weight:700;cursor:pointer;}' +
      '.cqb-act button:disabled{opacity:.45;cursor:not-allowed;}' +
      '.cqb-adj-modal{position:fixed;inset:0;z-index:12100;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);padding:16px;}' +
      '.cqb-adj-box{background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow:auto;padding:16px;}' +
      '.cqb-adj-box h4{margin:0 0 10px;color:#0f766e;}' +
      '.cqb-adj-box ul{margin:0;padding-left:18px;font-size:13px;line-height:1.6;}' +
      '.cqb-adj-box .ok{margin-top:12px;width:100%;}';
    document.head.appendChild(style);
  }

  function ensureMount() {
    ensureStyles();
    var mount = document.getElementById('classQuotaBoardMount');
    if (!mount) return null;
    if (mounted) return mount;
    mount.innerHTML =
      '<div class="cqb-toolbar">' +
      '  <label class="cqb-grade-label">年级' +
      '    <select id="cqbGradeSelect">' +
      '      <option value="六年级">六年级</option>' +
      '      <option value="七年级">七年级</option>' +
      '    </select>' +
      '  </label>' +
      '  <button type="button" class="btn btn-primary btn-sm" id="cqbAutoFillBtn">一键名额补齐</button>' +
      '  <button type="button" class="btn btn-outline btn-sm" id="cqbRestoreBtn">恢复初始配置</button>' +
      '  <button type="button" class="btn btn-outline btn-sm" id="cqbRefreshBtn">刷新</button>' +
      '</div>' +
      '<div class="cqb-table-wrap"><table class="cqb-table" id="cqbTable">' +
      '  <thead><tr>' +
      '    <th></th><th>班级名称</th><th>班级总人数</th><th>内定学生总数</th>' +
      '    <th>普通学生数</th><th>总固定名额</th><th>普通可用总名额</th><th>名额状态</th>' +
      '  </tr></thead>' +
      '  <tbody id="cqbTbody"><tr><td colspan="8" class="cqb-empty">加载中…</td></tr></tbody>' +
      '</table></div>';

    document.getElementById('cqbGradeSelect').addEventListener('change', function (e) {
      state.grade = e.target.value;
      state.expanded = {};
      loadBoard();
    });
    document.getElementById('cqbRefreshBtn').addEventListener('click', loadBoard);
    document.getElementById('cqbAutoFillBtn').addEventListener('click', onAutoFill);
    document.getElementById('cqbRestoreBtn').addEventListener('click', onRestore);
    mounted = true;
    return mount;
  }

  function setActiveButtons() {
    var boardBtn = document.getElementById('openClassQuotaBoardBtn');
    var listBtn = document.getElementById('showCoursesListBtn');
    if (boardBtn) boardBtn.classList.toggle('is-active', state.view === 'board');
    if (listBtn) listBtn.classList.toggle('is-active', state.view === 'courses');
  }

  function showBoard() {
    ensureMount();
    state.view = 'board';
    var list = document.getElementById('coursesListPanel');
    var board = document.getElementById('classQuotaBoardPanel');
    var upload = document.getElementById('courseUploadPanel');
    if (list) list.style.display = 'none';
    if (board) {
      board.hidden = false;
      board.style.display = '';
    }
    if (upload) upload.style.display = 'none';
    setActiveButtons();
    var gradeSel = document.getElementById('cqbGradeSelect');
    if (gradeSel) gradeSel.value = state.grade;
    loadBoard();
  }

  function showCourses() {
    state.view = 'courses';
    var list = document.getElementById('coursesListPanel');
    var board = document.getElementById('classQuotaBoardPanel');
    var upload = document.getElementById('courseUploadPanel');
    if (list) list.style.display = '';
    if (board) {
      board.style.display = 'none';
      board.hidden = true;
    }
    if (upload) upload.style.display = '';
    setActiveButtons();
  }

  async function loadBoard() {
    var tbody = document.getElementById('cqbTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="cqb-empty">加载中…</td></tr>';
    try {
      var data = await apiRequest('GET', '/api/class-quota-board?grade=' + encodeURIComponent(state.grade));
      state.rows = data.rows || [];
      renderTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="cqb-empty">加载失败：' + esc(e.message) + '</td></tr>';
      toast('加载看板失败：' + e.message, 'error');
    }
  }

  function statusHtml(row) {
    return '<span class="cqb-status ' + esc(row.status) + '">' + esc(row.status_text) + '</span>';
  }

  function renderTable() {
    var tbody = document.getElementById('cqbTbody');
    if (!tbody) return;
    if (!state.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="cqb-empty">暂无数据</td></tr>';
      return;
    }
    var html = '';
    state.rows.forEach(function (row) {
      var cn = row.class_number;
      var open = !!state.expanded[cn];
      html += '<tr data-class="' + esc(cn) + '">' +
        '<td><button type="button" class="cqb-expand" data-act="toggle" data-class="' + esc(cn) + '">' + (open ? '−' : '+') + '</button></td>' +
        '<td class="class-name">' + esc(row.class_name) + '</td>' +
        '<td><input class="cqb-size-input" type="number" min="0" data-act="size" data-class="' + esc(cn) + '" value="' + esc(row.total_students) + '"></td>' +
        '<td>' + esc(row.locked_total) + '</td>' +
        '<td>' + esc(row.ordinary_students) + '</td>' +
        '<td>' + esc(row.base_quota_sum) + '</td>' +
        '<td>' + esc(row.ordinary_available_total) + '</td>' +
        '<td>' + statusHtml(row) + '</td>' +
        '</tr>';
      if (open) {
        html += '<tr class="cqb-detail-row"><td colspan="8">' + renderDetail(row) + '</td></tr>';
      }
    });
    tbody.innerHTML = html;
    bindTableEvents(tbody);
  }

  function renderDetail(row) {
    var h = '<table class="cqb-detail"><thead><tr>' +
      '<th>课程名</th><th>基础名额</th><th>有效名额</th><th>内定人数</th><th>是否锁死</th><th>普通可用名额</th><th>操作</th>' +
      '</tr></thead><tbody>';
    (row.courses || []).forEach(function (c) {
      var locked = !!c.selection_locked;
      h += '<tr>' +
        '<td>' + esc(c.course_name) + (c.has_override ? ' <span style="color:#b45309;font-size:11px;">(已调剂)</span>' : '') + '</td>' +
        '<td>' + esc(c.base_quota) + '</td>' +
        '<td>' + esc(c.effective_quota) + '</td>' +
        '<td>' + esc(c.preenroll_count) + '</td>' +
        '<td>' + (locked ? '是' : '否') + '</td>' +
        '<td>' + esc(c.ordinary_available) + '</td>' +
        '<td><div class="cqb-act">' +
        '<button type="button" data-act="plus" data-class="' + esc(row.class_number) + '" data-course="' + esc(c.course_id) + '"' + (locked ? ' disabled' : '') + '>+1名额</button>' +
        '<button type="button" data-act="minus" data-class="' + esc(row.class_number) + '" data-course="' + esc(c.course_id) + '"' + (locked ? ' disabled' : '') + '>-1名额</button>' +
        '</div></td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function bindTableEvents(tbody) {
    tbody.querySelectorAll('[data-act="toggle"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cn = btn.getAttribute('data-class');
        state.expanded[cn] = !state.expanded[cn];
        renderTable();
      });
    });
    tbody.querySelectorAll('input[data-act="size"]').forEach(function (input) {
      input.addEventListener('change', async function () {
        var cn = input.getAttribute('data-class');
        var val = parseInt(input.value, 10);
        if (isNaN(val) || val < 0) {
          toast('人数无效', 'error');
          loadBoard();
          return;
        }
        try {
          var data = await apiRequest('PUT', '/api/class-quota-board/class-size', {
            grade: state.grade,
            class_number: cn,
            total_students: val
          });
          if (data.row) {
            state.rows = state.rows.map(function (r) {
              return r.class_number === cn ? data.row : r;
            });
            renderTable();
            toast('已更新班级人数', 'success');
          } else {
            loadBoard();
          }
        } catch (e) {
          toast('更新失败：' + e.message, 'error');
          loadBoard();
        }
      });
    });
    tbody.querySelectorAll('[data-act="plus"],[data-act="minus"]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var cn = btn.getAttribute('data-class');
        var courseId = parseInt(btn.getAttribute('data-course'), 10);
        var delta = btn.getAttribute('data-act') === 'plus' ? 1 : -1;
        btn.disabled = true;
        try {
          var data = await apiRequest('PUT', '/api/class-quota-board/adjust', {
            grade: state.grade,
            class_number: cn,
            course_id: courseId,
            delta: delta
          });
          if (data.row) {
            state.rows = state.rows.map(function (r) {
              return r.class_number === cn ? data.row : r;
            });
            renderTable();
            toast(delta > 0 ? '已 +1 名额' : '已 -1 名额', 'success');
          } else {
            loadBoard();
          }
        } catch (e) {
          toast(e.message || '调剂失败', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function showAdjustments(list) {
    var wrap = document.createElement('div');
    wrap.className = 'cqb-adj-modal';
    var items = (list || []).map(function (a) {
      var from = state.grade + '(' + a.from_class + ')班';
      var to = state.grade + '(' + a.to_class + ')班';
      if (a.type === 'same_course') {
        return '<li>同课程「' + esc(a.course_name) + '」：' + esc(from) + ' → ' + esc(to) + '（' + esc(a.amount) + '）</li>';
      }
      return '<li>跨课程：' + esc(from) + '「' + esc(a.course_name) + '」→ ' + esc(to) + '「' + esc(a.to_course_name || a.course_name) + '」（' + esc(a.amount) + '）</li>';
    }).join('');
    wrap.innerHTML = '<div class="cqb-adj-box"><h4>一键补齐明细</h4>' +
      (items ? '<ul>' + items + '</ul>' : '<p>本次无需调剂，各班已配齐或无可释放名额。</p>') +
      '<button type="button" class="btn btn-primary ok">知道了</button></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.ok').addEventListener('click', function () { wrap.remove(); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
  }

  async function onAutoFill() {
    if (!confirm('仅对当前年级「' + state.grade + '」执行一键名额补齐？\n不会修改全年级统一基础名额，也不会删除内定学生。')) return;
    var btn = document.getElementById('cqbAutoFillBtn');
    if (btn) btn.disabled = true;
    try {
      var data = await apiRequest('POST', '/api/class-quota-board/auto-fill', { grade: state.grade });
      state.rows = data.rows || [];
      renderTable();
      showAdjustments(data.adjustments || []);
      toast('一键补齐完成', 'success');
    } catch (e) {
      toast('补齐失败：' + e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function onRestore() {
    if (!confirm('恢复「' + state.grade + '」全部调剂到初始基础名额？\n保留班级总人数与内定学生数据。')) return;
    try {
      var data = await apiRequest('POST', '/api/class-quota-board/restore', { grade: state.grade });
      state.rows = data.rows || [];
      renderTable();
      toast('已恢复初始配置', 'success');
    } catch (e) {
      toast('恢复失败：' + e.message, 'error');
    }
  }

  function bindEntry() {
    var boardBtn = document.getElementById('openClassQuotaBoardBtn');
    var listBtn = document.getElementById('showCoursesListBtn');
    if (boardBtn) boardBtn.addEventListener('click', showBoard);
    if (listBtn) listBtn.addEventListener('click', showCourses);
    setActiveButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEntry);
  } else {
    bindEntry();
  }

  global.ClassQuotaBoard = {
    open: showBoard,
    showCourses: showCourses,
    close: showCourses,
    reload: loadBoard
  };
})(window);
