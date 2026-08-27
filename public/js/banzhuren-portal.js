/**
 * 班主任用户端：请假报备、数据看板、用户信息
 * 依赖 xuanke.html 中的 apiRequest / showToast / getToken / esc
 */
(function () {
  'use strict';

  var bzState = {
    tab: 'selection',
    classStudents: [],
    selectedStudent: null,
    todayLeaves: [],
    dashboard: null,
    profile: null
  };

  var lastSyncRevision = 0;

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('pjyz_user') || 'null');
    } catch (_) {
      return null;
    }
  }

  function escHtml(str) {
    if (typeof window.esc === 'function') return window.esc(str);
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function attrEsc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function leaveTypeLabel(t) {
    if (t === 'sick') return '病假';
    if (t === 'personal') return '事假';
    return t || '';
  }

  function switchTab(tab) {
    if (!tab) return;
    bzState.tab = tab;
    document.querySelectorAll('.bz-tab-btn').forEach(function (btn) {
      var id = btn.getAttribute('data-bz-tab');
      btn.classList.toggle('active', id === tab);
    });
    document.querySelectorAll('.bz-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'bz-panel-' + tab);
    });
    var resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.style.display = tab === 'selection' ? '' : 'none';

    if (tab === 'leave') loadLeavePage();
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'profile') loadProfile();
  }

  async function loadClassStudents() {
    var user = getUser();
    if (!user || !getToken()) return [];

    try {
      var data = await apiRequest('GET', '/api/banzhuren/class-roster');
      if (data && data.revision) lastSyncRevision = Math.max(lastSyncRevision, data.revision);
      return (data && data.students) || [];
    } catch (e) {
      console.warn('loadClassStudents:', e.message);
      return [];
    }
  }

  function parseClassFromUser(user) {
    var s = String(user.class_name || '').trim();
    var m = s.match(/^(六年级|七年级)\s*[\(（](\d+)[\)）]班$/);
    if (m) return { grade: m[1], classNum: m[2], display: s };
    m = s.match(/^(六年级|七年级)\s*(\d+)\s*班$/);
    if (m) return { grade: m[1], classNum: m[2], display: s };
    return { grade: '', classNum: '', display: s };
  }

  async function loadTodayLeaves() {
    try {
      var data = await apiRequest('GET', '/api/student-leaves?date=' + todayKey());
      bzState.todayLeaves = data.leaves || [];
    } catch (e) {
      bzState.todayLeaves = [];
    }
  }

  function getLeaveForStudent(name) {
    return bzState.todayLeaves.find(function (l) {
      return String(l.student_name || '').trim() === String(name || '').trim();
    });
  }

  function renderLeaveGrid() {
    var grid = document.getElementById('bzLeaveGrid');
    var hint = document.getElementById('bzLeaveHint');
    if (!grid) return;

    if (!bzState.classStudents.length) {
      grid.innerHTML = '';
      if (hint) hint.textContent = '暂无班级学生名单，请先在后台导入选课数据或完成选课';
      return;
    }
    if (hint) hint.textContent = '共 ' + bzState.classStudents.length + ' 名学生 · 点击选择学生后报备请假';

    grid.innerHTML = bzState.classStudents.map(function (s) {
      var name = s.student_name;
      var leave = getLeaveForStudent(name);
      var st = leave ? leave.leave_type : '';
      var cls = 'bz-student-card';
      if (bzState.selectedStudent === name) cls += ' selected';
      if (st === 'sick') cls += ' is-sick';
      if (st === 'personal') cls += ' is-personal';
      var badge = leave ? '<span class="bz-leave-badge">' + leaveTypeLabel(st) + '</span>' : '';
      return '<button type="button" class="' + cls + '" data-name="' + attrEsc(name) + '">' +
        '<span class="bz-stu-name">' + escHtml(name) + '</span>' + badge + '</button>';
    }).join('');

    grid.querySelectorAll('.bz-student-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        bzState.selectedStudent = btn.getAttribute('data-name');
        renderLeaveGrid();
        var selEl = document.getElementById('bzLeaveSelected');
        if (selEl) selEl.textContent = '已选：' + bzState.selectedStudent;
      });
    });
  }

  function renderLeaveList() {
    var list = document.getElementById('bzLeaveList');
    if (!list) return;
    if (!bzState.todayLeaves.length) {
      list.innerHTML = '<div class="bz-empty">今日暂无请假报备</div>';
      return;
    }
    list.innerHTML = bzState.todayLeaves.map(function (l) {
      return '<div class="bz-leave-item">' +
        '<span class="bz-leave-name">' + escHtml(l.student_name) + '</span>' +
        '<span class="bz-leave-type">' + leaveTypeLabel(l.leave_type) + '</span>' +
        '<button type="button" class="bz-leave-cancel" data-id="' + l.id + '">撤销</button>' +
        '</div>';
    }).join('');
    list.querySelectorAll('.bz-leave-cancel').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('确定撤销该请假报备？')) return;
        try {
          await apiRequest('DELETE', '/api/student-leaves/' + id);
          showToast('已撤销请假', 'success');
          await loadTodayLeaves();
          renderLeaveGrid();
          renderLeaveList();
        } catch (e) {
          showToast('撤销失败：' + e.message, 'error');
        }
      });
    });
  }

  async function submitLeave(leaveType) {
    if (!bzState.selectedStudent) {
      showToast('请先点击选择学生', 'warning');
      return;
    }
    try {
      await apiRequest('POST', '/api/student-leaves', {
        student_name: bzState.selectedStudent,
        leave_type: leaveType,
        leave_date: todayKey()
      });
      showToast('已报备「' + bzState.selectedStudent + '」' + leaveTypeLabel(leaveType), 'success');
      await loadTodayLeaves();
      renderLeaveGrid();
      renderLeaveList();
    } catch (e) {
      showToast('报备失败：' + e.message, 'error');
    }
  }

  async function loadLeavePage() {
    bzState.classStudents = await loadClassStudents();
    await loadTodayLeaves();
    renderLeaveGrid();
    renderLeaveList();
    var dateEl = document.getElementById('bzLeaveDate');
    if (dateEl) dateEl.textContent = todayKey();
  }

  function renderDashboard(data) {
    var wrap = document.getElementById('bzDashboardBody');
    if (!wrap) return;
    if (!data || !data.students || !data.students.length) {
      wrap.innerHTML = '<div class="bz-empty">暂无考勤数据，请确保学生已选课且教师端已进行签到</div>';
      return;
    }

    var summary = document.getElementById('bzDashboardSummary');
    if (summary) {
      summary.innerHTML =
        '<div class="bz-dash-stat"><span class="n">' + (data.student_count || 0) + '</span><span class="l">班级人数</span></div>' +
        '<div class="bz-dash-stat"><span class="n">' + (data.course_count || 0) + '</span><span class="l">拓展课程</span></div>' +
        '<div class="bz-dash-stat"><span class="n">' + escHtml(data.class_display || data.class_name || '') + '</span><span class="l">负责班级</span></div>';
    }

    var html = '<div class="table-wrap"><table class="bz-dash-table"><thead><tr>' +
      '<th>姓名</th><th>出勤</th><th>旷课</th><th>病假</th><th>事假</th><th>迟到</th><th>课程明细</th></tr></thead><tbody>';

    data.students.forEach(function (s) {
      var t = s.totals || {};
      var detail = (s.courses || []).map(function (c) {
        return escHtml(c.course_name) + '（' + escHtml(c.teacher_name || '—') + '）出' + c.present + '/旷' + c.absent + '/病' + c.sick + '/事' + c.personal;
      }).join('；') || '—';
      html += '<tr>' +
        '<td>' + escHtml(s.student_name) + '</td>' +
        '<td>' + (t.present || 0) + '</td>' +
        '<td>' + (t.absent || 0) + '</td>' +
        '<td>' + (t.sick || 0) + '</td>' +
        '<td>' + (t.personal || 0) + '</td>' +
        '<td>' + (t.late || 0) + '</td>' +
        '<td class="bz-detail">' + detail + '</td></tr>';
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  async function loadDashboard() {
    var wrap = document.getElementById('bzDashboardBody');
    if (wrap) wrap.innerHTML = '<div class="bz-empty">加载中…</div>';
    try {
      var data = await apiRequest('GET', '/api/banzhuren/class-dashboard');
      bzState.dashboard = data;
      renderDashboard(data);
    } catch (e) {
      if (wrap) wrap.innerHTML = '<div class="bz-empty">加载失败：' + escHtml(e.message) + '</div>';
    }
  }

  async function loadProfile() {
    var user = getUser();
    if (!user) return;
    var parsed = parseClassFromUser(user);
    var students = await loadClassStudents();

    var nameEl = document.getElementById('bzProfileName');
    var roleEl = document.getElementById('bzProfileRole');
    var classEl = document.getElementById('bzProfileClass');
    var countEl = document.getElementById('bzProfileCount');
    var accountEl = document.getElementById('bzProfileAccount');

    var displayName = (user.teacher_name && String(user.teacher_name).trim()) || user.username || '班主任';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = '拓展课 · 班主任';
    if (classEl) classEl.textContent = parsed.display || '—';
    if (countEl) countEl.textContent = String(students.length);
    if (accountEl) accountEl.textContent = user.username || '—';

    var passUser = document.getElementById('bzPassUsername');
    if (passUser) passUser.value = user.username || '';
  }

  function bindProfilePassword() {
    var toggleBtn = document.getElementById('bzTogglePassBtn');
    var panel = document.getElementById('bzPassPanel');
    var currentView = document.getElementById('bzCurrentPass');
    var toggleCurrent = document.getElementById('bzToggleCurrentPass');
    var updateBtn = document.getElementById('bzUpdatePassBtn');

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', function () {
        panel.classList.toggle('open');
        if (panel.classList.contains('open') && currentView) {
          apiRequest('GET', '/api/account').then(function (data) {
            var pwd = (data && data.account && data.account.password) || '';
            currentView.value = pwd;
          }).catch(function () {});
        }
      });
    }
    if (toggleCurrent && currentView) {
      toggleCurrent.addEventListener('click', function () {
        var vis = currentView.type === 'text';
        currentView.type = vis ? 'password' : 'text';
        toggleCurrent.textContent = vis ? '隐藏' : '显示';
      });
    }
    if (updateBtn) {
      updateBtn.addEventListener('click', async function () {
        var newPass = (document.getElementById('bzNewPass') || {}).value || '';
        var confirmPass = (document.getElementById('bzConfirmPass') || {}).value || '';
        if (newPass.length < 4) {
          showToast('新密码至少 4 位', 'error');
          return;
        }
        if (newPass !== confirmPass) {
          showToast('两次密码不一致', 'error');
          return;
        }
        updateBtn.disabled = true;
        try {
          await apiRequest('PUT', '/api/account/password', { password: newPass });
          showToast('密码已更新', 'success');
          if (currentView) currentView.value = newPass;
          document.getElementById('bzNewPass').value = '';
          document.getElementById('bzConfirmPass').value = '';
        } catch (e) {
          showToast('更新失败：' + e.message, 'error');
        } finally {
          updateBtn.disabled = false;
        }
      });
    }
  }

  async function pollSelectionSync() {
    if (!getToken()) return;
    try {
      var data = await apiRequest('GET', '/api/selection-data-sync');
      var rev = data.revision || 0;
      if (rev > lastSyncRevision) {
        lastSyncRevision = rev;
        if (bzState.tab === 'leave') loadLeavePage();
        else if (bzState.tab === 'dashboard') loadDashboard();
        else if (bzState.tab === 'profile') loadProfile();
      }
    } catch (e) { /* ignore */ }
  }

  function initSyncRevision() {
    if (!getToken()) return;
    apiRequest('GET', '/api/selection-data-sync').then(function (data) {
      lastSyncRevision = (data && data.revision) || 0;
    }).catch(function () {});
  }

  function init() {
    var tabbar = document.querySelector('.bz-tabbar');
    if (tabbar) {
      tabbar.addEventListener('click', function (e) {
        var btn = e.target.closest('.bz-tab-btn');
        if (!btn) return;
        e.preventDefault();
        var tab = btn.getAttribute('data-bz-tab');
        if (tab) switchTab(tab);
      });
    }

    document.querySelectorAll('.bz-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var tab = btn.getAttribute('data-bz-tab');
        if (tab) switchTab(tab);
      });
    });

    var sickBtn = document.getElementById('bzLeaveSickBtn');
    var personalBtn = document.getElementById('bzLeavePersonalBtn');
    if (sickBtn) sickBtn.addEventListener('click', function () { submitLeave('sick'); });
    if (personalBtn) personalBtn.addEventListener('click', function () { submitLeave('personal'); });

    var refreshDash = document.getElementById('bzRefreshDashboard');
    if (refreshDash) refreshDash.addEventListener('click', loadDashboard);

    bindProfilePassword();

    initSyncRevision();
    setInterval(pollSelectionSync, 30000);

    var logoutBtn = document.getElementById('bzProfileLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        var mainLogout = document.getElementById('logoutBtn');
        if (mainLogout) mainLogout.click();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BzPortal = { switchTab: switchTab, loadLeavePage: loadLeavePage };
})();
