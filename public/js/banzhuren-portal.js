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
  var clockTimer = null;
  var SKIN_KEY = 'pjyz_teacher_skin';
  var SKIN_LIST = ['teal', 'violet', 'ocean', 'sunset', 'forest', 'ink'];

  var TAB_LABELS = {
    selection: '班级选课',
    leave: '请假报备',
    dashboard: '数据看板',
    profile: '用户信息'
  };

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

  function getTimeGreeting(hour) {
    if (hour >= 5 && hour < 11) return '上午好';
    if (hour >= 11 && hour < 14) return '中午好';
    if (hour >= 14 && hour < 18) return '下午好';
    return '晚上好';
  }

  function formatClockGreeting(name, hour) {
    var raw = String(name || '').trim();
    if (!raw || raw === '—') return '老师，' + getTimeGreeting(hour);
    raw = raw.replace(/老师$/u, '');
    return raw + '老师' + getTimeGreeting(hour);
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
    var dateLine = document.getElementById('dateLine');
    if (dateLine && TAB_LABELS[tab]) dateLine.textContent = TAB_LABELS[tab];

    if (tab === 'leave') loadLeavePage();
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'profile') loadProfile();
  }

  function applySkin(skin) {
    var name = SKIN_LIST.indexOf(skin) > -1 ? skin : 'teal';
    if (name === 'teal') document.documentElement.removeAttribute('data-skin');
    else document.documentElement.setAttribute('data-skin', name);
    try { localStorage.setItem(SKIN_KEY, name); } catch (_) {}
    renderSkinSwatches();
  }

  function renderSkinSwatches() {
    var grid = document.getElementById('skinGrid');
    if (!grid) return;
    var cur = 'teal';
    try { cur = localStorage.getItem(SKIN_KEY) || 'teal'; } catch (_) {}
    grid.querySelectorAll('.skin-swatch').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.skin === cur);
    });
  }

  function initSkin() {
    var cur = 'teal';
    try { cur = localStorage.getItem(SKIN_KEY) || 'teal'; } catch (_) {}
    applySkin(cur);
  }

  function updateClockQuote() {
    var el = document.getElementById('clockQuote');
    if (!el) return;
    if (window.TeacherQuotes && typeof TeacherQuotes.getRandom === 'function') {
      el.textContent = TeacherQuotes.getRandom();
    }
  }

  var clockAbnormalCount = 0;

  function getSelectionStats() {
    var total = 0;
    try {
      if (typeof students !== 'undefined' && Array.isArray(students)) total = students.length;
    } catch (_) {}
    return { total: total };
  }

  function updateClockInfo() {
    var user = getUser();
    var parsed = parseClassFromUser(user || {});
    var displayName = (user && user.teacher_name && String(user.teacher_name).trim()) || (user && user.username) || '—';
    var stats = getSelectionStats();
    var count = bzState.classStudents.length || stats.total;

    var classEl = document.getElementById('clockClass');
    var teacherEl = document.getElementById('clockTeacher');
    var studentsEl = document.getElementById('clockStudents');
    var abnormalEl = document.getElementById('clockAbnormal');
    if (classEl) classEl.textContent = parsed.display || '—';
    if (teacherEl) teacherEl.textContent = displayName;
    if (studentsEl) studentsEl.textContent = String(count);
    if (abnormalEl) abnormalEl.textContent = String(clockAbnormalCount);
  }

  async function refreshClockAbnormalCount() {
    try {
      var data = await apiRequest('GET', '/api/banzhuren/class-dashboard');
      clockAbnormalCount = Number(data && data.today_abnormal_count) || 0;
      if (data && Array.isArray(data.students) && !bzState.classStudents.length) {
        bzState.classStudents = data.students.map(function (s) {
          return { student_name: s.student_name, gender: s.gender || '' };
        });
      }
    } catch (_) {
      clockAbnormalCount = 0;
    }
    updateClockInfo();
  }

  function openClockOverlay() {
    var overlay = document.getElementById('clockOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    updateClockQuote();
    refreshClockAbnormalCount();
    function tick() {
      var now = new Date();
      var hour = now.getHours();
      var timeEl = document.getElementById('clockTime');
      var dateEl = document.getElementById('clockDate');
      var greetEl = document.getElementById('clockGreeting');
      if (timeEl) {
        timeEl.textContent = String(hour).padStart(2, '0') + ':' +
          String(now.getMinutes()).padStart(2, '0') + ':' +
          String(now.getSeconds()).padStart(2, '0');
      }
      if (dateEl) {
        var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        dateEl.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' +
          now.getDate() + '日 ' + weekdays[now.getDay()];
      }
      var user = getUser();
      var name = (user && user.teacher_name) || (user && user.username) || '—';
      if (greetEl) greetEl.textContent = formatClockGreeting(name, hour);
      updateClockInfo();
    }
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  }

  function closeClockOverlay() {
    var overlay = document.getElementById('clockOverlay');
    if (overlay) overlay.classList.remove('show');
    clearInterval(clockTimer);
  }

  async function loadClassStudents() {
    if (!getToken()) return [];
    try {
      var data = await apiRequest('GET', '/api/banzhuren/class-roster');
      if (data && data.revision) lastSyncRevision = Math.max(lastSyncRevision, data.revision);
      var list = (data && data.students) || [];
      if (list.length) return list;
    } catch (e) {
      console.warn('loadClassStudents:', e.message);
    }

    // 回退：使用本页当前班级名单（刚保存尚未同步时）
    try {
      if (typeof students !== 'undefined' && Array.isArray(students) && students.length) {
        return students.map(function (name) {
          var g = '';
          try {
            if (typeof getStudentGender === 'function') g = getStudentGender(name) || '';
          } catch (_) {}
          return { student_name: name, gender: g };
        });
      }
    } catch (_) {}
    return [];
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
      var noteHtml = (l.leave_type === 'personal' && l.note)
        ? '<span class="bz-leave-note">原因：' + escHtml(l.note) + '</span>' : '';
      return '<div class="bz-leave-item">' +
        '<span class="bz-leave-name">' + escHtml(l.student_name) + '</span>' +
        '<span class="bz-leave-type">' + leaveTypeLabel(l.leave_type) + '</span>' +
        noteHtml +
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

  function openPersonalLeaveModal() {
    if (!bzState.selectedStudent) {
      showToast('请先点击选择学生', 'warning');
      return;
    }
    var modal = document.getElementById('bzPersonalLeaveModal');
    var studentEl = document.getElementById('bzPersonalLeaveStudent');
    var noteEl = document.getElementById('bzPersonalLeaveNote');
    if (studentEl) studentEl.textContent = '学生：' + bzState.selectedStudent;
    if (noteEl) {
      var existing = getLeaveForStudent(bzState.selectedStudent);
      noteEl.value = (existing && existing.note) || '';
    }
    if (modal) modal.classList.add('active');
  }

  function closePersonalLeaveModal() {
    var modal = document.getElementById('bzPersonalLeaveModal');
    if (modal) modal.classList.remove('active');
  }

  async function submitLeave(leaveType, note) {
    if (!bzState.selectedStudent) {
      showToast('请先点击选择学生', 'warning');
      return;
    }
    if (leaveType === 'personal') {
      var reason = String(note || '').trim();
      if (!reason) {
        showToast('请填写事假原因', 'warning');
        return;
      }
    }
    try {
      var payload = {
        student_name: bzState.selectedStudent,
        leave_type: leaveType,
        leave_date: todayKey()
      };
      if (leaveType === 'personal') payload.note = String(note || '').trim();
      await apiRequest('POST', '/api/student-leaves', payload);
      showToast('已报备「' + bzState.selectedStudent + '」' + leaveTypeLabel(leaveType), 'success');
      closePersonalLeaveModal();
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

  function emptySessions(n) {
    var cols = [];
    for (var i = 0; i < (n || 18); i++) cols.push({ date: '', dateLabel: '', placeholder: true });
    return cols;
  }

  function normalizeDashboardData(data, fallbackStudents) {
    var students = (data && data.students) || [];
    if (!students.length && fallbackStudents && fallbackStudents.length) {
      students = fallbackStudents.map(function (s) {
        return {
          student_name: s.student_name || s,
          gender: s.gender || '',
          cells: []
        };
      });
    }
    var sessions = (data && data.sessions) || [];
    if (sessions.length < 18) {
      sessions = sessions.slice();
      while (sessions.length < 18) sessions.push({ date: '', dateLabel: '', placeholder: true });
    } else if (sessions.length > 18) {
      sessions = sessions.slice(0, 18);
    }
    if (!sessions.length) sessions = emptySessions(18);

    return Object.assign({}, data || {}, {
      students: students,
      sessions: sessions,
      student_count: students.length,
      class_display: (data && (data.class_display || data.class_name)) || ''
    });
  }

  function renderAttendanceCell(cell) {
    var st = cell && cell.status;
    if (!st || st === 'none') return '';
    if (st === 'present') return '<span class="bz-att-ok">✓</span>';
    if (st === 'absent') return '<span class="bz-att-bad">旷课</span>';
    if (st === 'late') return '<span class="bz-att-warn">迟到</span>';
    if (st === 'sick') return '<span class="bz-att-sick">病假</span>';
    if (st === 'personal') {
      var note = (cell && cell.note) || '';
      var tip = note ? ' title="' + attrEsc(note) + '"' : '';
      return '<span class="bz-att-warn"' + tip + '>事假</span>';
    }
    return escHtml(st);
  }

  function renderDashboard(data) {
    var wrap = document.getElementById('bzDashboardBody');
    if (!wrap) return;

    var sessions = (data && data.sessions) || emptySessions(18);
    var students = (data && data.students) || [];
    var filledSessions = sessions.filter(function (s) { return s && s.date; }).length;

    var summary = document.getElementById('bzDashboardSummary');
    if (summary) {
      summary.innerHTML =
        '<div class="bz-dash-stat"><span class="n">' + (students.length || 0) + '</span><span class="l">班级人数</span></div>' +
        '<div class="bz-dash-stat"><span class="n">' + filledSessions + '/18</span><span class="l">已签到次数</span></div>' +
        '<div class="bz-dash-stat"><span class="n">' + escHtml((data && (data.class_display || data.class_name)) || '—') + '</span><span class="l">负责班级</span></div>';
    }

    if (!students.length) {
      wrap.innerHTML = '<div class="bz-empty">暂无本班学生名单。请先在「班级选课」上传/同步名单并保存，或由管理员导入花名册。</div>';
      return;
    }

    if (data && data.revision) lastSyncRevision = Math.max(lastSyncRevision, data.revision);

    var html = '<div class="bz-att-wrap"><table class="bz-att-table"><thead><tr>' +
      '<th class="bz-att-name">姓名</th>';
    for (var i = 0; i < 18; i++) {
      var s = sessions[i];
      if (s && s.date) {
        html += '<th title="' + attrEsc(s.date) + '">' + escHtml(s.dateLabel || s.date) + '</th>';
      } else {
        html += '<th class="bz-att-ph">' + (i + 1) + '</th>';
      }
    }
    html += '</tr></thead><tbody>';

    students.forEach(function (stu) {
      var cells = stu.cells || [];
      html += '<tr><td class="bz-att-name">' + escHtml(stu.student_name) + '</td>';
      for (var c = 0; c < 18; c++) {
        var cell = cells[c] || { status: '' };
        var sess = sessions[c];
        if (!sess || !sess.date) {
          html += '<td></td>';
        } else {
          html += '<td>' + renderAttendanceCell(cell) + '</td>';
        }
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  async function loadDashboard() {
    var wrap = document.getElementById('bzDashboardBody');
    if (wrap) wrap.innerHTML = '<div class="bz-empty">加载中…</div>';
    var fallback = [];
    try {
      fallback = await loadClassStudents();
    } catch (_) {}

    try {
      var data = await apiRequest('GET', '/api/banzhuren/class-dashboard');
      bzState.dashboard = normalizeDashboardData(data, fallback);
      renderDashboard(bzState.dashboard);
    } catch (e) {
      console.warn('loadDashboard:', e.message);
      bzState.dashboard = normalizeDashboardData({
        students: [],
        sessions: emptySessions(18),
        class_display: (parseClassFromUser(getUser() || {}).display || '')
      }, fallback);
      renderDashboard(bzState.dashboard);
      if (!fallback.length && wrap) {
        wrap.innerHTML = '<div class="bz-empty">加载失败：' + escHtml(e.message) + '</div>';
      }
    }
  }

  async function exportClassRoster() {
    var students = await loadClassStudents();
    if (!students.length) {
      showToast('暂无班级名单可导出', 'error');
      return;
    }
    var user = getUser();
    var parsed = parseClassFromUser(user || {});
    var classLabel = parsed.display || '班级';
    var html = '<html><head><meta charset="UTF-8"></head><body><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:12pt;">';
    html += '<tr><th style="border:1px solid #000;padding:4px 8px;">序号</th>';
    html += '<th style="border:1px solid #000;padding:4px 8px;">班级</th>';
    html += '<th style="border:1px solid #000;padding:4px 8px;">姓名</th>';
    html += '<th style="border:1px solid #000;padding:4px 8px;">性别</th></tr>';
    students.forEach(function (s, i) {
      html += '<tr>';
      html += '<td style="border:1px solid #000;padding:4px 8px;">' + (i + 1) + '</td>';
      html += '<td style="border:1px solid #000;padding:4px 8px;">' + escHtml(classLabel) + '</td>';
      html += '<td style="border:1px solid #000;padding:4px 8px;">' + escHtml(s.student_name) + '</td>';
      html += '<td style="border:1px solid #000;padding:4px 8px;">' + escHtml(s.gender || '') + '</td>';
      html += '</tr>';
    });
    html += '</table></body></html>';
    var blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = classLabel + '学生名单.xls';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出班级名单', 'success');
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
    var accountHint = document.getElementById('bzProfileAccountHint');

    var displayName = (user.teacher_name && String(user.teacher_name).trim()) || user.username || '班主任';
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = '拓展课 · 班主任';
    if (classEl) classEl.textContent = parsed.display || '—';
    if (countEl) countEl.textContent = String(students.length);
    if (accountEl) accountEl.textContent = user.username || '—';
    if (accountHint) accountHint.textContent = user.username || '—';

    var passUser = document.getElementById('bzPassUsername');
    if (passUser) passUser.value = user.username || '';
    renderSkinSwatches();
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

  async function notifyRosterUpdated() {
    try {
      var sync = await apiRequest('GET', '/api/selection-data-sync');
      lastSyncRevision = (sync && sync.revision) || lastSyncRevision;
    } catch (_) {}
    bzState.classStudents = [];
    if (bzState.tab === 'leave') await loadLeavePage();
    else if (bzState.tab === 'dashboard') await loadDashboard();
    else if (bzState.tab === 'profile') await loadProfile();
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
    initSkin();
    if (window.TeacherQuotes && typeof TeacherQuotes.init === 'function') {
      TeacherQuotes.init();
    }

    var topNav = document.querySelector('.bz-subnav') || document.querySelector('.bz-top-nav');
    if (topNav) {
      topNav.addEventListener('click', function (e) {
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
    if (personalBtn) personalBtn.addEventListener('click', openPersonalLeaveModal);

    var plSubmit = document.getElementById('bzPersonalLeaveSubmit');
    var plClose = document.getElementById('bzPersonalLeaveClose');
    var plModal = document.getElementById('bzPersonalLeaveModal');
    if (plSubmit) {
      plSubmit.addEventListener('click', function () {
        var note = (document.getElementById('bzPersonalLeaveNote') || {}).value || '';
        submitLeave('personal', note);
      });
    }
    if (plClose) plClose.addEventListener('click', closePersonalLeaveModal);
    if (plModal) {
      plModal.addEventListener('click', function (e) {
        if (e.target === plModal) closePersonalLeaveModal();
      });
    }

    var refreshDash = document.getElementById('bzRefreshDashboard');
    if (refreshDash) refreshDash.addEventListener('click', loadDashboard);

    var exportRow = document.getElementById('bzExportRosterRow');
    if (exportRow) exportRow.addEventListener('click', exportClassRoster);

    var skinGrid = document.getElementById('skinGrid');
    if (skinGrid) {
      skinGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('.skin-swatch');
        if (!btn) return;
        applySkin(btn.dataset.skin);
        showToast('已切换皮肤', 'success');
      });
    }

    var titleBtn = document.getElementById('headerTitleBtn');
    var clockClose = document.getElementById('clockClose');
    var clockOverlay = document.getElementById('clockOverlay');
    if (titleBtn) titleBtn.addEventListener('click', openClockOverlay);
    if (clockClose) clockClose.addEventListener('click', closeClockOverlay);
    if (clockOverlay) {
      clockOverlay.addEventListener('click', function (e) {
        if (e.target.id === 'clockOverlay') closeClockOverlay();
      });
    }

    bindProfilePassword();

    initSyncRevision();
    setInterval(pollSelectionSync, 15000);
    // 停留在数据看板时更频繁刷新签到表格
    setInterval(function () {
      if (bzState.tab === 'dashboard' && getToken()) loadDashboard();
    }, 20000);

    var logoutBtn = document.getElementById('bzProfileLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        if (typeof window.pjyzLogout === 'function') window.pjyzLogout();
        else window.location.href = 'denglu';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BzPortal = {
    switchTab: switchTab,
    loadLeavePage: loadLeavePage,
    notifyRosterUpdated: notifyRosterUpdated
  };
})();
