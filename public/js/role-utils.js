/**
 * 角色与页面路由工具
 * admin → admin, banzhuren → xuanke, teacher → jiaoshi
 * （使用无后缀路径，兼容 Cloudflare Pretty URLs）
 */
(function (global) {
  'use strict';

  var ROLE_PAGES = {
    admin: 'admin',
    banzhuren: 'xuanke',
    teacher: 'jiaoshi'
  };

  var ROLE_LABELS = {
    admin: '管理员',
    banzhuren: '班主任',
    teacher: '教师'
  };

  var ROLE_ORDER = ['admin', 'banzhuren', 'teacher'];

  function injectStyles() {
    if (document.getElementById('pjyz-role-switcher-style')) return;
    var style = document.createElement('style');
    style.id = 'pjyz-role-switcher-style';
    style.textContent =
      '#roleSwitcher { position: relative; z-index: 20; flex-shrink: 0; }' +
      '.role-switcher { position: relative; display: inline-flex; align-items: center; }' +
      '.role-switch-btn { border: 1px solid rgba(13,148,136,0.35); background: rgba(255,255,255,0.95); color: #0f766e; border-radius: 10px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; line-height: 1.2; }' +
      '.role-switch-btn:hover { background: #f0fdfa; }' +
      '.role-switch-menu { position: fixed; min-width: 132px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,0.16); padding: 4px; display: none; z-index: 15000; }' +
      '.role-switch-menu.show { display: block; }' +
      '.role-switch-item { display: block; width: 100%; border: none; background: transparent; text-align: left; padding: 8px 12px; font-size: 13px; border-radius: 8px; cursor: pointer; color: #1f2937; }' +
      '.role-switch-item:hover { background: #f0fdfa; }' +
      '.role-switch-item.active { background: #ccfbf1; color: #0f766e; font-weight: 600; }' +
      '@media (max-width: 768px) { .role-switch-menu { max-height: min(280px, calc(100vh - 16px)); overflow-y: auto; -webkit-overflow-scrolling: touch; } }';
    document.head.appendChild(style);
  }

  function getUserFromStorage() {
    try {
      return JSON.parse(localStorage.getItem('pjyz_user') || 'null');
    } catch (_) {
      return null;
    }
  }

  function getUserRoles(user) {
    user = user || getUserFromStorage();
    if (!user) return [];
    var roles = user.roles && user.roles.length ? user.roles.slice() : (user.role ? [user.role] : []);
    return roles.filter(function (r) { return ROLE_PAGES[r]; });
  }

  function getActiveRole() {
    var roles = getUserRoles();
    if (!roles.length) return null;
    var saved = localStorage.getItem('pjyz_active_role');
    if (saved && roles.indexOf(saved) > -1) return saved;
    return roles[0];
  }

  var LAST_PAGE_KEY = 'pjyz_last_page';

  function setActiveRole(role) {
    localStorage.setItem('pjyz_active_role', role);
    localStorage.setItem('pjyz_login_role', role);
    if (ROLE_PAGES[role]) rememberLastPage(ROLE_PAGES[role]);
  }

  function normalizePagePath(path) {
    return String(path || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/^.*\//, '')
      .replace(/\.html$/i, '')
      .toLowerCase();
  }

  function pageToRole(page) {
    var p = normalizePagePath(page);
    if (p === 'admin') return 'admin';
    if (p === 'xuanke' || p === 'index' || p === '') return 'banzhuren';
    if (p === 'jiaoshi') return 'teacher';
    return null;
  }

  function rememberLastPage(page) {
    var p = normalizePagePath(page || (location.pathname.split('/').pop() || ''));
    if (!p || p === 'denglu' || p === 'login') return;
    if (!pageToRole(p)) return;
    try { localStorage.setItem(LAST_PAGE_KEY, p); } catch (_) {}
  }

  function prefetchPage(page) {
    var p = normalizePagePath(page);
    if (!p || p === 'denglu' || p === 'login') return;
    try {
      if (document.querySelector('link[data-pjyz-prefetch="' + p + '"]')) return;
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = p;
      link.setAttribute('data-pjyz-prefetch', p);
      document.head.appendChild(link);
      // 同步用 fetch 预热缓存，跳转时浏览器更可能命中
      if (window.fetch) {
        fetch(p, { credentials: 'same-origin', priority: 'low' }).catch(function () {});
      }
    } catch (_) {}
  }

  function prefetchRolePages(user) {
    getUserRoles(user).forEach(function (r) {
      prefetchPage(ROLE_PAGES[r]);
    });
  }

  /** 登录页预取全部角色落地页，缩短登录后跳转等待 */
  function prefetchAllRolePages() {
    ROLE_ORDER.forEach(function (r) {
      prefetchPage(ROLE_PAGES[r]);
    });
  }

  function navigateToPage(page) {
    var p = normalizePagePath(page);
    if (!p) return;
    if (normalizePagePath(location.pathname.split('/').pop() || '') === p) return;
    location.replace(p);
  }

  function getApiBase() {
    try {
      if (global.__API_BASE__ && typeof global.__API_BASE__ === 'string') {
        return String(global.__API_BASE__).replace(/\/+$/, '');
      }
      var saved = localStorage.getItem('pjyz_api_base');
      if (saved) return saved.replace(/\/+$/, '');
    } catch (_) {}
    return '';
  }

  function getAuthToken() {
    try {
      return localStorage.getItem('admin_token') || localStorage.getItem('pjyz_token') || '';
    } catch (_) {
      return '';
    }
  }

  function todayDateKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function authFetchJson(path, token) {
    return fetch(getApiBase() + path, {
      credentials: 'same-origin',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      }
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function parseUserClass(user) {
    var s = String((user && user.class_name) || '').trim();
    var m = s.match(/^(六年级|七年级)\s*[\(（](\d+)[\)）]班$/);
    if (m) return { grade: m[1], classNum: m[2], display: s };
    m = s.match(/^(六年级|七年级)\s*(\d+)\s*班$/);
    if (m) return { grade: m[1], classNum: m[2], display: s };
    m = s.match(/^([六七])(?:年级)?[\(（]?(\d+)[\)）]?\s*班?$/);
    if (m) {
      return {
        grade: m[1] === '六' ? '六年级' : '七年级',
        classNum: m[2],
        display: s
      };
    }
    return { grade: '', classNum: '', display: s };
  }

  function stableStudentKey(s) {
    var name = String((s && s.student_name) || '').trim();
    var cls = String((s && (s.class_name || s.grade)) || '').trim().replace(/[()（）\s]/g, '');
    return name + '|' + cls;
  }

  function seedTeacherLocalCache(courseName, classroomData, selectionsData, user) {
    if (!courseName) return;
    var payload = (classroomData && classroomData.payload) || {};
    var students = [];
    var list = (selectionsData && selectionsData.selections) || [];
    if (list.length) {
      var map = new Map();
      list.forEach(function (row) {
        var key = (row.student_name || '') + '|' + (row.class_name || '');
        if (!map.has(key)) map.set(key, row);
      });
      students = Array.from(map.values()).map(function (row, i) {
        var base = {
          id: row.id || (i + 1),
          student_name: row.student_name,
          class_name: row.class_name,
          grade: row.grade,
          gender: row.gender || '',
          course_name: row.course_name,
          course_id: row.course_id
        };
        base.stableId = stableStudentKey(base);
        return base;
      });
    }
    if (!students.length && Array.isArray(payload.students)) students = payload.students;

    var hours = null;
    if (classroomData && classroomData.numeric_hours_total != null) hours = Number(classroomData.numeric_hours_total) || 0;
    else if (classroomData && classroomData.summary && classroomData.summary.numeric_hours_total != null) {
      hours = Number(classroomData.summary.numeric_hours_total) || 0;
    }

    var store = {
      checkin: payload.checkin || {},
      checkinDay: payload.checkinDay || '',
      checkinDone: !!payload.checkinDone,
      rewards: payload.rewards || {},
      exams: payload.exams || {},
      activities: payload.activities || [],
      history: payload.history || [],
      students: students,
      teacher: Object.assign({}, payload.teacher || {}, {
        name: String((user && user.teacher_name) || (payload.teacher && payload.teacher.name) || '').trim(),
        course: courseName,
        location: (payload.teacher && payload.teacher.location) || '',
        totalClasses: hours != null ? hours : (Number(payload.teacher && payload.teacher.totalClasses) || 0)
      }),
      courseId: '',
      courseName: courseName
    };

    var prefix = 'pjyz_teacher_attendance_';
    var json = JSON.stringify(store);
    try {
      localStorage.setItem(prefix + 'name:' + courseName, json);
      localStorage.setItem(prefix + courseName, json);
    } catch (_) {}

    var syncedAt = classroomData && classroomData.summary && classroomData.summary.synced_at
      ? String(classroomData.summary.synced_at)
      : (classroomData && classroomData.synced_at ? String(classroomData.synced_at) : '');
    if (syncedAt) {
      try {
        var meta = JSON.stringify({ syncedAt: syncedAt });
        localStorage.setItem(prefix + 'name:' + courseName + '_sync', meta);
        localStorage.setItem(prefix + courseName + '_sync', meta);
      } catch (_) {}
    }
  }

  /**
   * 登录页跳转前预热落地页 HTML + 首屏接口，写入本地缓存，落地后可秒开。
   */
  function warmRoleBootstrap(opts) {
    opts = opts || {};
    var token = opts.token || getAuthToken();
    var user = opts.user || getUserFromStorage();
    if (opts.user) {
      try { localStorage.setItem('pjyz_user', JSON.stringify(opts.user)); } catch (_) {}
      user = opts.user;
    }
    var page = normalizePagePath(opts.page || getLoginRedirectUrl(user));
    var role = pageToRole(page);
    if (!token || !page || page === 'denglu' || page === 'login' || !role) {
      return Promise.resolve({ page: page, role: role, warmed: false });
    }

    prefetchPage(page);
    try { setActiveRole(role); } catch (_) {}

    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 2800;
    var bag = { role: role, page: page, at: Date.now() };
    var jobs = [];

    function add(p) {
      jobs.push(Promise.resolve(p).catch(function () { return null; }));
    }

    add(authFetchJson('/api/auth/me', token).then(function (d) {
      bag.me = d;
      if (d && d.user) {
        try { localStorage.setItem('pjyz_user', JSON.stringify(d.user)); } catch (_) {}
        user = d.user;
      }
      return d;
    }));
    add(authFetchJson('/api/class-schedule-status', token).then(function (d) {
      bag.schedule = d;
      try {
        sessionStorage.setItem('pjyz_schedule_boot', JSON.stringify({ at: Date.now(), data: d }));
      } catch (_) {}
      return d;
    }));
    add(authFetchJson('/api/selection-data-sync', token).then(function (d) {
      bag.sync = d;
      return d;
    }));

    if (role === 'teacher') {
      var courseName = String((user && user.course_name) || '').trim();
      var coursesP = authFetchJson('/api/courses', token).then(function (d) {
        bag.courses = d;
        try {
          localStorage.setItem('pjyz_courses_cache_v1', JSON.stringify({
            savedAt: Date.now(),
            courses: (d && d.courses) || []
          }));
        } catch (_) {}
        return d;
      });
      add(coursesP);

      if (courseName) {
        var selP = authFetchJson('/api/selections?course=' + encodeURIComponent(courseName), token);
        var roomP = authFetchJson('/api/teacher-classroom?course_name=' + encodeURIComponent(courseName), token);
        add(selP);
        add(roomP);
        add(Promise.all([selP, roomP, coursesP]).then(function (pair) {
          var sel = pair[0];
          var room = pair[1];
          var coursesData = pair[2];
          bag.selections = sel;
          bag.classroom = room;
          if (coursesData && Array.isArray(coursesData.courses)) {
            var hit = coursesData.courses.find(function (c) {
              return c && String(c.name || '').trim() === courseName;
            });
            if (hit && hit.id) {
              try {
                var raw = localStorage.getItem('pjyz_teacher_attendance_name:' + courseName);
                if (raw) {
                  var obj = JSON.parse(raw);
                  obj.courseId = String(hit.id);
                  var json = JSON.stringify(obj);
                  localStorage.setItem('pjyz_teacher_attendance_name:' + courseName, json);
                  localStorage.setItem('pjyz_teacher_attendance_id:' + hit.id, json);
                }
              } catch (_) {}
            }
          }
          seedTeacherLocalCache(courseName, room, sel, user);
          return true;
        }));
        add(authFetchJson('/api/course-hours/total?course_name=' + encodeURIComponent(courseName), token).then(function (d) {
          bag.hoursTotal = d;
          return d;
        }));
        add(authFetchJson(
          '/api/student-leaves?date=' + encodeURIComponent(todayDateKey()) +
          '&course_name=' + encodeURIComponent(courseName),
          token
        ).then(function (d) {
          bag.leaves = d;
          try {
            sessionStorage.setItem('pjyz_teacher_leaves_boot', JSON.stringify({
              at: Date.now(),
              course: courseName,
              data: d
            }));
          } catch (_) {}
          return d;
        }));
        add(authFetchJson('/api/classes', token).then(function (d) {
          bag.classes = d;
          return d;
        }));
      }
    } else if (role === 'banzhuren') {
      var parsed = parseUserClass(user);
      add(authFetchJson('/api/courses', token).then(function (d) {
        bag.courses = d;
        try {
          localStorage.setItem('pjyz_courses_cache_v1', JSON.stringify({
            savedAt: Date.now(),
            courses: (d && d.courses) || []
          }));
        } catch (_) {}
        return d;
      }));
      add(authFetchJson('/api/selection-status', token).then(function (d) {
        bag.selectionStatus = d;
        try {
          sessionStorage.setItem('pjyz_selection_status_boot', JSON.stringify({ at: Date.now(), data: d }));
        } catch (_) {}
        return d;
      }));
      if (parsed.grade && parsed.classNum) {
        var qs = new URLSearchParams();
        qs.set('grade', parsed.grade);
        qs.set('class', parsed.classNum);
        qs.set('class_name', parsed.grade + '(' + parsed.classNum + ')班');
        var uq = new URLSearchParams();
        uq.set('grade', parsed.grade);
        uq.set('class', parsed.classNum + '班');
        var qstr = qs.toString();
        var selP = authFetchJson('/api/selections?' + qstr, token);
        var unP = authFetchJson('/api/unselected-students?' + uq.toString(), token);
        add(selP.then(function (d) { bag.selections = d; return d; }));
        add(unP.then(function (d) { bag.unselected = d; return d; }));
        add(Promise.all([
          selP.catch(function () { return { selections: [] }; }),
          unP.catch(function () { return { unselected: [] }; })
        ]).then(function (pair) {
          try {
            sessionStorage.setItem('pjyz_xuanke_boot_v1', JSON.stringify({
              at: Date.now(),
              grade: parsed.grade,
              classNum: parsed.classNum,
              selections: (pair[0] && pair[0].selections) || [],
              unselected: (pair[1] && pair[1].unselected) || []
            }));
          } catch (_) {}
          return pair;
        }));
        add(authFetchJson('/api/banzhuren/class-roster?' + qstr, token).then(function (d) {
          bag.roster = d;
          try {
            sessionStorage.setItem('bz_class_roster_cache', JSON.stringify({
              students: (d && d.students) || [],
              revision: (d && d.revision) || 0,
              at: Date.now()
            }));
          } catch (_) {}
          return d;
        }));
        add(authFetchJson('/api/banzhuren/class-dashboard?' + qstr, token).then(function (d) {
          bag.dashboard = d;
          try {
            sessionStorage.setItem('bz_dashboard_cache', JSON.stringify({
              at: Date.now(),
              data: d
            }));
          } catch (_) {}
          return d;
        }));
      }
    } else if (role === 'admin') {
      add(authFetchJson('/api/courses', token).then(function (d) {
        bag.courses = d;
        try {
          localStorage.setItem('pjyz_courses_cache_v1', JSON.stringify({
            savedAt: Date.now(),
            courses: (d && d.courses) || []
          }));
        } catch (_) {}
        return d;
      }));
      add(authFetchJson('/api/teacher-classroom', token).then(function (d) {
        bag.classroom = d;
        try {
          sessionStorage.setItem('pjyz_admin_board_cache_v1', JSON.stringify({
            items: (d && d.items) || [],
            overview: (d && d.overview) || {},
            today: (d && d.today) || '',
            at: Date.now()
          }));
        } catch (_) {}
        return d;
      }));
      add(authFetchJson('/api/course-hours', token).then(function (d) {
        bag.hours = d;
        try {
          sessionStorage.setItem('pjyz_admin_hours_boot', JSON.stringify({ at: Date.now(), data: d }));
        } catch (_) {}
        return d;
      }));
      add(authFetchJson('/api/selection-status', token).then(function (d) {
        bag.selectionStatus = d;
        return d;
      }));
    }

    return Promise.race([
      Promise.all(jobs),
      new Promise(function (resolve) { setTimeout(resolve, timeoutMs); })
    ]).then(function () {
      try {
        sessionStorage.setItem('pjyz_role_boot_cache_v1', JSON.stringify({
          role: role,
          page: page,
          at: Date.now()
        }));
      } catch (_) {}
      return { page: page, role: role, warmed: true, bag: bag };
    });
  }

  function getLastPage() {
    try { return normalizePagePath(localStorage.getItem(LAST_PAGE_KEY) || ''); } catch (_) { return ''; }
  }

  function getLoginRedirectUrl(user) {
    var roles = getUserRoles(user);
    if (!roles.length) return 'denglu';

    // 优先跳转到最近打开过的页面（退出登录后仍保留）
    var lastPage = getLastPage();
    var lastRole = pageToRole(lastPage);
    if (lastPage && lastRole && roles.indexOf(lastRole) > -1) {
      return ROLE_PAGES[lastRole] || lastPage;
    }

    var saved = localStorage.getItem('pjyz_active_role');
    if (saved && roles.indexOf(saved) > -1) return ROLE_PAGES[saved];
    return ROLE_PAGES[roles[0]];
  }

  function getCurrentPageRole() {
    var path = (location.pathname.split('/').pop() || '').toLowerCase();
    if (path.indexOf('admin') > -1) return 'admin';
    if (path.indexOf('xuanke') > -1 || path === 'index.html' || path === '') return 'banzhuren';
    if (path.indexOf('jiaoshi') > -1) return 'teacher';
    return null;
  }

  function enforcePageAccess() {
    var roles = getUserRoles();
    var pageRole = getCurrentPageRole();
    if (!pageRole || !roles.length) return;
    if (roles.indexOf(pageRole) > -1) {
      setActiveRole(pageRole);
      rememberLastPage();
      return;
    }
    navigateToPage(getLoginRedirectUrl());
  }

  function positionRoleMenu(btn, menu) {
    var rect = btn.getBoundingClientRect();
    var gap = 6;
    var pad = 8;
    var menuWidth = Math.max(menu.offsetWidth || 0, 132);
    var menuHeight = menu.offsetHeight || 0;

    var left = Math.round(rect.right - menuWidth);
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));

    var topBelow = Math.round(rect.bottom + gap);
    var topAbove = Math.round(rect.top - menuHeight - gap);
    var top = topBelow;
    if (menuHeight && topBelow + menuHeight > window.innerHeight - pad && topAbove >= pad) {
      top = topAbove;
    }
    if (menuHeight) {
      top = Math.max(pad, Math.min(top, window.innerHeight - menuHeight - pad));
    }

    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
  }

  function initRoleSwitcher(mountId) {
    injectStyles();
    var el = document.getElementById(mountId);
    if (!el) return;

    var roles = getUserRoles();
    prefetchRolePages();
    if (roles.length <= 1) {
      el.innerHTML = '';
      return;
    }

    var active = getActiveRole();
    var html = '<div class="role-switcher">' +
      '<button type="button" class="role-switch-btn" id="roleSwitchBtn">' +
      (ROLE_LABELS[active] || '切换角色') + ' ▾</button>' +
      '<div class="role-switch-menu" id="roleSwitchMenu">';
    ROLE_ORDER.forEach(function (r) {
      if (roles.indexOf(r) === -1) return;
      html += '<button type="button" class="role-switch-item' + (r === active ? ' active' : '') + '" data-role="' + r + '">' + ROLE_LABELS[r] + '</button>';
    });
    html += '</div></div>';
    el.innerHTML = html;

    var btn = document.getElementById('roleSwitchBtn');
    var menu = document.getElementById('roleSwitchMenu');
    if (!btn || !menu) return;

    // 挂到 body，避免顶栏 overflow:hidden 裁切下拉项（如「教师」）
    if (menu.parentNode !== document.body) {
      document.body.appendChild(menu);
    }

    function closeMenu() {
      menu.classList.remove('show');
      menu.style.visibility = '';
    }

    function openMenu() {
      menu.classList.add('show');
      menu.style.visibility = 'hidden';
      positionRoleMenu(btn, menu);
      menu.style.visibility = 'visible';
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menu.classList.contains('show')) {
        closeMenu();
        return;
      }
      openMenu();
      setTimeout(function () {
        document.addEventListener('click', onDocClick, true);
      }, 0);
    });

    function onDocClick(e) {
      if (!btn.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
      document.removeEventListener('click', onDocClick, true);
    }

    menu.querySelectorAll('.role-switch-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var role = item.getAttribute('data-role');
        setActiveRole(role);
        rememberLastPage(ROLE_PAGES[role]);
        navigateToPage(ROLE_PAGES[role]);
      });
    });

    window.addEventListener('resize', function () {
      if (menu.classList.contains('show')) positionRoleMenu(btn, menu);
    });
    window.addEventListener('scroll', function () {
      if (menu.classList.contains('show')) positionRoleMenu(btn, menu);
    }, true);
  }

  function parseRoleValue(val) {
    var v = String(val || '').trim().toLowerCase();
    if (!v) return null;
    if (v === 'admin' || v === '管理员') return 'admin';
    if (v === 'banzhuren' || v === '班主任' || v === 'bzr') return 'banzhuren';
    if (v === 'teacher' || v === '教师') return 'teacher';
    if (ROLE_PAGES[v]) return v;
    return null;
  }

  function normalizeRolesInput(rolesRaw) {
    var rolesArr = [];
    if (Array.isArray(rolesRaw)) rolesArr = rolesRaw;
    else if (typeof rolesRaw === 'string') rolesArr = rolesRaw.split(/[,，、|]/);
    else if (rolesRaw) rolesArr = [rolesRaw];
    var mapped = [];
    rolesArr.forEach(function (r) {
      var parsed = parseRoleValue(r);
      if (parsed && mapped.indexOf(parsed) === -1) mapped.push(parsed);
    });
    return mapped;
  }

  function injectDbHealthStyles() {
    if (document.getElementById('pjyz-db-health-style')) return;
    var style = document.createElement('style');
    style.id = 'pjyz-db-health-style';
    style.textContent =
      '#pjyzDbHealthBanner{display:none;position:sticky;top:0;z-index:14000;margin:0;padding:10px 14px;' +
      'background:#fff7ed;border-bottom:1px solid #fdba74;color:#9a3412;font-size:13px;line-height:1.55;}' +
      '#pjyzDbHealthBanner.show{display:block;}' +
      '#pjyzDbHealthBanner strong{font-weight:800;}' +
      '#pjyzDbHealthBanner .pjyz-db-actions{margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;}' +
      '#pjyzDbHealthBanner button{border:1px solid #f97316;background:#fff;color:#c2410c;border-radius:8px;' +
      'padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;}' +
      '#pjyzDbHealthBanner button:hover{background:#ffedd5;}' +
      '@media (max-width:640px){#pjyzDbHealthBanner{font-size:12px;padding:8px 10px;}}';
    document.head.appendChild(style);
  }

  function ensureDbHealthBannerEl() {
    injectDbHealthStyles();
    var el = document.getElementById('pjyzDbHealthBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pjyzDbHealthBanner';
    el.setAttribute('role', 'alert');
    var host = document.body;
    if (host.firstChild) host.insertBefore(el, host.firstChild);
    else host.appendChild(el);
    return el;
  }

  function hideDbHealthBanner() {
    var el = document.getElementById('pjyzDbHealthBanner');
    if (el) el.classList.remove('show');
  }

  function showDbHealthBanner(payload) {
    var el = ensureDbHealthBannerEl();
    var msg = (payload && payload.message) ||
      '数据库今日读取配额已用尽。请明天再试，或升级 Cloudflare D1。数据未丢失。';
    el.innerHTML =
      '<strong>系统提示：</strong>' + msg +
      '<div class="pjyz-db-actions">' +
      '<button type="button" data-act="retry">重新检测</button>' +
      '<button type="button" data-act="dismiss">知道了</button>' +
      '</div>';
    el.classList.add('show');
    var retryBtn = el.querySelector('[data-act="retry"]');
    var dismissBtn = el.querySelector('[data-act="dismiss"]');
    if (retryBtn) retryBtn.onclick = function () { checkDbHealthBanner({ force: true }); };
    if (dismissBtn) dismissBtn.onclick = hideDbHealthBanner;
  }

  function apiBaseForHealth() {
    try {
      if (typeof global.apiBase === 'function') return global.apiBase();
    } catch (_) {}
    return '';
  }

  async function checkDbHealthBanner(opts) {
    opts = opts || {};
    try {
      var res = await fetch(apiBaseForHealth() + '/api/health', { method: 'GET', cache: 'no-store' });
      var data = {};
      try { data = await res.json(); } catch (_) { data = {}; }
      var msg = String((data && (data.message || data.error)) || '');
      var quota = (data && data.code === 'D1_QUOTA_EXCEEDED') ||
        /row read limit|exceeded D1|free tier daily|读取配额/i.test(msg);
      if (!res.ok && quota) {
        showDbHealthBanner(data);
        return false;
      }
      if (opts.force) hideDbHealthBanner();
      return true;
    } catch (_) {
      return true;
    }
  }

  function autoCheckDbHealth() {
    // 登录页也检测，避免一进系统就看到空白/HTML 错误
    var run = function () { checkDbHealthBanner(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  var SKIP_AUTOLOGIN_KEY = 'pjyz_skip_autologin';

  /** 用户主动退出后，回登录页禁止自动登录，需手动点登录 */
  function markManualLogout() {
    try { sessionStorage.setItem(SKIP_AUTOLOGIN_KEY, '1'); } catch (_) {}
  }

  function shouldSkipAutologin() {
    try { return sessionStorage.getItem(SKIP_AUTOLOGIN_KEY) === '1'; } catch (_) { return false; }
  }

  function clearManualLogoutSkip() {
    try { sessionStorage.removeItem(SKIP_AUTOLOGIN_KEY); } catch (_) {}
  }

  global.PjyzRole = {
    ROLE_PAGES: ROLE_PAGES,
    ROLE_LABELS: ROLE_LABELS,
    ROLE_ORDER: ROLE_ORDER,
    getUserFromStorage: getUserFromStorage,
    getUserRoles: getUserRoles,
    getActiveRole: getActiveRole,
    setActiveRole: setActiveRole,
    getLoginRedirectUrl: getLoginRedirectUrl,
    getCurrentPageRole: getCurrentPageRole,
    enforcePageAccess: enforcePageAccess,
    initRoleSwitcher: initRoleSwitcher,
    parseRoleValue: parseRoleValue,
    normalizeRolesInput: normalizeRolesInput,
    prefetchPage: prefetchPage,
    prefetchRolePages: prefetchRolePages,
    prefetchAllRolePages: prefetchAllRolePages,
    warmRoleBootstrap: warmRoleBootstrap,
    navigateToPage: navigateToPage,
    markManualLogout: markManualLogout,
    shouldSkipAutologin: shouldSkipAutologin,
    clearManualLogoutSkip: clearManualLogoutSkip,
    checkDbHealthBanner: checkDbHealthBanner,
    hideDbHealthBanner: hideDbHealthBanner
  };

  autoCheckDbHealth();
})(window);
