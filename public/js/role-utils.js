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
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = p;
      document.head.appendChild(link);
    } catch (_) {}
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
    location.href = getLoginRedirectUrl();
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
        location.href = ROLE_PAGES[role];
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
    prefetchPage: prefetchPage
  };
})(window);
