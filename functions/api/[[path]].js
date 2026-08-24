/* =======================================================
 * Cloudflare Pages Function - 选课系统 API 网关
 * 使用 D1 数据库持久化存储
 * ======================================================= */

// ---- 默认用户数据（首次部署时初始化） ----
const DEFAULT_USERS = [
  { username: 'admin', password: '123456', roles: ['admin'], teacher_name: '', class_name: '', email: '', phone: '' }
];

// ---- 数据库初始化 SQL ----
const INIT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT '',
    roles TEXT NOT NULL DEFAULT 'teacher',
    teacher_name TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    course_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, role)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role)`,
  `CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT DEFAULT '体育健康类',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    teacher TEXT DEFAULT '',
    location TEXT DEFAULT '',
    requirement TEXT DEFAULT '',
    limit_grade6 INTEGER DEFAULT 0,
    limit_grade7 INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT NOT NULL,
    class_name TEXT NOT NULL,
    teacher_name TEXT DEFAULT '',
    student_count INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS selections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    student_name TEXT NOT NULL,
    gender TEXT DEFAULT '',
    course_id INTEGER,
    course_name TEXT DEFAULT '',
    selected_at TEXT DEFAULT (datetime('now')),
    is_locked INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_selections_grade ON selections(grade)`,
  `CREATE INDEX IF NOT EXISTS idx_selections_class ON selections(class_name)`,
  `CREATE INDEX IF NOT EXISTS idx_selections_course ON selections(course_name)`,
  `CREATE TABLE IF NOT EXISTS import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'user_import',
    operator TEXT DEFAULT '',
    imported_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    details TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS unselected_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    student_name TEXT NOT NULL,
    saved_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_unselected_grade ON unselected_students(grade)`,
  `CREATE INDEX IF NOT EXISTS idx_unselected_class ON unselected_students(class_name)`,
  `CREATE TABLE IF NOT EXISTS data_consistency_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    details TEXT DEFAULT '',
    checked_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '1'
  )`,
  `CREATE TABLE IF NOT EXISTS teacher_classroom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL DEFAULT '',
    course_name TEXT NOT NULL UNIQUE,
    teacher_name TEXT DEFAULT '',
    teacher_user_id INTEGER,
    total_classes INTEGER DEFAULT 0,
    checkin_day TEXT DEFAULT '',
    checkin_done INTEGER DEFAULT 0,
    student_count INTEGER DEFAULT 0,
    present_count INTEGER DEFAULT 0,
    absent_count INTEGER DEFAULT 0,
    abnormal_count INTEGER DEFAULT 0,
    pending_count INTEGER DEFAULT 0,
    flower_total INTEGER DEFAULT 0,
    exam_done_count INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    payload TEXT DEFAULT '{}',
    synced_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_teacher_classroom_teacher ON teacher_classroom(teacher_name)`,
  `CREATE INDEX IF NOT EXISTS idx_teacher_classroom_synced ON teacher_classroom(synced_at)`,
  `CREATE TABLE IF NOT EXISTS course_hour_overrides (
    course_name TEXT NOT NULL,
    session_date TEXT NOT NULL,
    cell_value TEXT NOT NULL DEFAULT '1',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (course_name, session_date)
  )`
];

const SELECTION_STATUS_KEY = 'selection_enabled';
const CLASS_SCHEDULE_KEY = 'class_schedule_control';
const COURSE_HOURS_HIDDEN_DATES_KEY = 'course_hours_hidden_dates';
const COURSE_HOURS_EXTRA_DATES_KEY = 'course_hours_extra_dates';
const CLASS_SCHEDULE_TZ = 'Asia/Shanghai';

function getTodayDateKey(tz = CLASS_SCHEDULE_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function isMondayDate(dateKey, tz = CLASS_SCHEDULE_TZ) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
    new Date(dateKey + 'T12:00:00')
  );
  return weekday === 'Mon';
}

async function getClassScheduleControl(db) {
  const today = getTodayDateKey();
  let control = { date: today, mode: 'default' };
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind(CLASS_SCHEDULE_KEY).first();
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      if (parsed && parsed.date === today && ['default', 'suspended', 'unlocked'].includes(parsed.mode)) {
        control = { date: today, mode: parsed.mode };
      } else if (parsed && parsed.date !== today) {
        await db.prepare(
          'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).bind(CLASS_SCHEDULE_KEY, JSON.stringify({ date: today, mode: 'default' })).run();
      }
    }
  } catch (_) {
    control = { date: today, mode: 'default' };
  }
  return control;
}

async function setClassScheduleControl(db, control) {
  await db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(CLASS_SCHEDULE_KEY, JSON.stringify(control)).run();
}

function evaluateClassSchedule(control) {
  const today = getTodayDateKey();
  const mode = (control && control.date === today && control.mode) ? control.mode : 'default';
  const isMonday = isMondayDate(today);
  let allowed = false;
  if (mode === 'suspended') allowed = false;
  else if (mode === 'unlocked') allowed = true;
  else allowed = isMonday;
  return {
    date: today,
    mode,
    isMonday,
    allowed,
    suspended: mode === 'suspended',
    unlocked: mode === 'unlocked',
    reason: allowed ? '' : '非上课时间 不可使用',
    statusText: mode === 'suspended' ? '停课状态' : '',
    buttonText: mode === 'suspended' ? '解除停课' : '今日停课'
  };
}

async function getClassScheduleStatus(db) {
  const control = await getClassScheduleControl(db);
  return evaluateClassSchedule(control);
}

function authIsTeacherOnly(auth) {
  const roles = auth && auth.roles ? auth.roles : [];
  return roles.includes('teacher') && !roles.includes('admin');
}

function payloadHasCheckinActivity(body, today) {
  if (!body || typeof body !== 'object') return false;
  if (body.checkinDone) return true;
  const history = Array.isArray(body.history) ? body.history : [];
  return history.some((h) => h && String(h.date) === today);
}

async function getSelectionEnabled(db) {
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind(SELECTION_STATUS_KEY).first();
    if (!row) return true;
    return row.value === '1' || row.value === 'true';
  } catch (e) {
    return true;
  }
}

async function setSelectionEnabled(db, enabled) {
  await db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(SELECTION_STATUS_KEY, enabled ? '1' : '0').run();
}

function selectionStatusPayload(enabled) {
  return {
    enabled,
    statusText: enabled ? '当前状态为选课状态' : '当前状态为禁止选课'
  };
}

// ---- 密码哈希工具 (Web Crypto API - SHA-256 + 随机盐) ----
async function generateSalt() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':' + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, salt, hash) {
  const computed = await hashPassword(password, salt);
  return computed === hash;
}

// ---- 辅助函数 ----
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// ---- Token (Web Crypto API) - 支持多角色 ----
async function createToken(userId, roles) {
  const expiry = Date.now() + 8 * 60 * 60 * 1000;
  const rolesStr = Array.isArray(roles) ? roles.join(',') : (roles || '');
  const payload = `${userId}:${rolesStr}:${expiry}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${btoa(payload)}.${hashHex.substring(0, 16)}`;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const decoded = atob(parts[0]);
    const [userId, rolesStr, expiry] = decoded.split(':');
    if (Date.now() > parseInt(expiry)) return null;
    const roles = (rolesStr || '').split(',').filter(Boolean);
    return { userId: parseInt(userId), roles: roles.length ? roles : ['teacher'] };
  } catch (e) { return null; }
}

function getAuthUser(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7));
}

function requireAuth(request, allowedRoles) {
  const user = getAuthUser(request);
  if (!user) return { error: '未登录或Token已过期', status: 401 };
  if (allowedRoles && allowedRoles.length > 0) {
    const hasRole = user.roles.some(r => allowedRoles.includes(r));
    if (!hasRole) return { error: '权限不足', status: 403 };
  }
  return { user };
}

const VALID_USER_ROLES = ['admin', 'banzhuren', 'teacher'];

function normalizeUserRoles(rolesRaw) {
  let rolesArr = [];
  if (Array.isArray(rolesRaw)) rolesArr = rolesRaw;
  else if (typeof rolesRaw === 'string') rolesArr = rolesRaw.split(/[,，、|]/).map(s => s.trim());
  else if (rolesRaw) rolesArr = [rolesRaw];

  const mapped = [];
  for (const r of rolesArr) {
    const v = String(r || '').trim().toLowerCase();
    if (v === 'admin' || v === '管理员') mapped.push('admin');
    else if (v === 'banzhuren' || v === '班主任' || v === 'bzr') mapped.push('banzhuren');
    else if (v === 'teacher' || v === '教师') mapped.push('teacher');
    else if (VALID_USER_ROLES.includes(v) && !mapped.includes(v)) mapped.push(v);
  }
  return mapped.length ? [...new Set(mapped)] : ['teacher'];
}

// =======================================================
// 路由处理
// =======================================================

// ---- Health ----
async function handleHealth(db) {
  try {
    const result = await db.prepare('SELECT COUNT(*) as count FROM users').first();
    return json({ status: 'ok', database: 'D1', users: result.count, time: new Date().toISOString() });
  } catch(e) {
    return json({ status: 'error', message: e.message }, 500);
  }
}

// ---- Login ----
async function handleLogin(db, request) {
  try {
    const body = await request.json();
    const { username, password } = body || {};
    if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
    
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    if (!user) return json({ error: '账号不存在' }, 401);
    
    if (user.status === 'locked') return json({ error: '账号已被锁定，请联系管理员', status: 'locked' }, 403);
    if (user.status === 'disabled') return json({ error: '账号已被禁用，请联系管理员', status: 'disabled' }, 403);
    
    const passwordOk = await verifyPassword(password, user.salt || '', user.password_hash || '');
    if (!passwordOk) return json({ error: '账号或密码错误' }, 401);
    
    const roles = (user.roles || 'teacher').split(',').filter(Boolean);
    const token = await createToken(user.id, roles);
    
    return json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        roles: roles,
        role: roles[0] || 'teacher',
        teacher_name: user.teacher_name || '',
        class_name: user.class_name || '',
        course_name: user.course_name || '',
        email: user.email || '',
        phone: user.phone || '',
        status: user.status || 'active'
      }
    });
  } catch (e) {
    return json({ error: '请求格式错误' }, 400);
  }
}

async function handleAuthMe(db, request) {
  const auth = requireAuth(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const user = await db.prepare(
    'SELECT id, username, roles, teacher_name, class_name, course_name, email, phone, status FROM users WHERE id = ?'
  ).bind(auth.user.userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);
  const roles = (user.roles || '').split(',').filter(Boolean);
  return json({
    user: {
      id: user.id,
      username: user.username,
      roles: roles,
      role: roles[0] || 'teacher',
      teacher_name: user.teacher_name || '',
      class_name: user.class_name || '',
      course_name: user.course_name || '',
      email: user.email || '',
      phone: user.phone || '',
      status: user.status || 'active'
    }
  });
}

/** 当前登录用户查看账号与明文密码（与后台用户管理一致，便于教师自助查看） */
async function handleAccountGet(db, request) {
  const auth = requireAuth(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const user = await db.prepare(
    'SELECT id, username, password, teacher_name, course_name, status FROM users WHERE id = ?'
  ).bind(auth.user.userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);
  return json({
    success: true,
    account: {
      id: user.id,
      username: user.username || '',
      password: user.password || '',
      teacher_name: user.teacher_name || '',
      course_name: user.course_name || '',
      status: user.status || 'active'
    }
  });
}

/** 当前登录用户修改自己的密码，同步更新 password + password_hash（后台可见） */
async function handleAccountPasswordPut(db, request) {
  const auth = requireAuth(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let body;
  try { body = await request.json(); } catch (_) {
    return json({ error: '请求体无效' }, 400);
  }
  const currentPassword = String(body.current_password || body.old_password || '').trim();
  const newPassword = String(body.new_password || body.password || '').trim();
  if (!newPassword) return json({ error: '请输入新密码' }, 400);
  if (newPassword.length < 4) return json({ error: '新密码至少 4 位' }, 400);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(auth.user.userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  // 校验当前密码（若库中有 hash 则验 hash；否则回退明文列）
  let currentOk = false;
  if (user.password_hash && user.salt) {
    currentOk = await verifyPassword(currentPassword, user.salt, user.password_hash);
  }
  if (!currentOk && user.password != null) {
    currentOk = String(user.password) === currentPassword;
  }
  if (!currentOk) return json({ error: '当前密码不正确' }, 400);

  const salt = await generateSalt();
  const passwordHash = await hashPassword(newPassword, salt);
  await db.prepare(
    `UPDATE users SET password=?, password_hash=?, salt=?, updated_at=datetime('now') WHERE id=?`
  ).bind(newPassword, passwordHash, salt, user.id).run();

  return json({
    success: true,
    message: '密码已更新',
    account: {
      id: user.id,
      username: user.username,
      password: newPassword
    }
  });
}

// ---- Courses ----
async function handleCoursesGet(db) {
  const results = await db.prepare('SELECT * FROM courses').all();
  const courses = results.results.map(c => ({
    id: c.id,
    category: c.category || '',
    name: c.name || '',
    description: c.description || '',
    teacher: c.teacher || '',
    location: c.location || '',
    requirement: c.requirement || '',
    limit_grade6: c.limit_grade6 || 0,
    limit_grade7: c.limit_grade7 || 0,
    selected_count: c.selected_count || 0,
    is_active: c.is_active !== 0
  }));
  return json({ courses });
}

async function handleCoursesBatchSave(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json();
    const arr = Array.isArray(body) ? body : (body.courses || []);
    
    // 删除所有旧课程
    await db.prepare('DELETE FROM courses').run();
    
    // 批量插入新课程
    for (const c of arr) {
      const id = (c.id !== undefined && c.id !== null) ? c.id : null;
      if (id) {
        await db.prepare(`INSERT INTO courses (id, category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          id,
          c.category || '体育健康类',
          c.name || '',
          c.description || '',
          c.teacher || '',
          c.location || '',
          c.requirement || '',
          parseInt(c.limit_grade6, 10) || 0,
          parseInt(c.limit_grade7, 10) || 0,
          c.selected_count || 0,
          c.is_active !== false ? 1 : 0
        ).run();
      } else {
        await db.prepare(`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          c.category || '体育健康类',
          c.name || '',
          c.description || '',
          c.teacher || '',
          c.location || '',
          c.requirement || '',
          parseInt(c.limit_grade6, 10) || 0,
          parseInt(c.limit_grade7, 10) || 0,
          c.selected_count || 0,
          c.is_active !== false ? 1 : 0
        ).run();
      }
    }
    
    const results = await db.prepare('SELECT * FROM courses').all();
    return json({ success: true, count: results.results.length, courses: results.results });
  } catch (e) {
    return json({ error: '保存失败：' + e.message }, 400);
  }
}

async function handleCourseCreate(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const result = await db.prepare(`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    body.category || '体育健康类',
    body.name || '',
    body.description || '',
    body.teacher || '',
    body.location || '',
    body.requirement || '',
    parseInt(body.limit_grade6, 10) || 0,
    parseInt(body.limit_grade7, 10) || 0,
    0,
    body.is_active !== false ? 1 : 0
  ).run();
  
  const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(result.meta.last_row_id).first();
  return json({ course });
}

async function handleCourseUpdate(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '课程不存在' }, 404);
  
  await db.prepare(`UPDATE courses SET category=?, name=?, description=?, teacher=?, location=?, requirement=?, limit_grade6=?, limit_grade7=?, selected_count=?, is_active=? WHERE id=?`).bind(
    body.category !== undefined ? body.category : existing.category,
    body.name !== undefined ? body.name : existing.name,
    body.description !== undefined ? body.description : existing.description,
    body.teacher !== undefined ? body.teacher : existing.teacher,
    body.location !== undefined ? body.location : existing.location,
    body.requirement !== undefined ? body.requirement : existing.requirement,
    body.limit_grade6 !== undefined ? body.limit_grade6 : existing.limit_grade6,
    body.limit_grade7 !== undefined ? body.limit_grade7 : existing.limit_grade7,
    body.selected_count !== undefined ? body.selected_count : existing.selected_count,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
    id
  ).run();
  
  const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
  return json({ course });
}

async function handleCourseDelete(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '课程不存在' }, 404);
  
  await db.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM selections WHERE course_id = ?').bind(id).run();
  return json({ success: true });
}

// ---- CSV / Excel Upload Parsing ----
function cleanHtmlCellText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCourseTableHeader(cells) {
  const joined = cells.join('|');
  return /类别/.test(joined) && (/课程/.test(joined) || /课程名称/.test(joined));
}

function isCategoryCell(text) {
  return text && text.length < 24 && (/类$/.test(text) || text === '类别');
}

function isSerialCell(text) {
  return /^\d+$/.test(String(text || '').trim());
}

/** 解析 Word 表格（支持类别列 rowspan、封面图片列可缺失） */
function parseDocxTableHtml(html) {
  const cleanHtml = String(html).replace(/<img[\s\S]*?>/gi, '');
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const courses = [];
  let currentCategory = '体育健康类';
  let trMatch;

  while ((trMatch = trRegex.exec(cleanHtml)) !== null) {
    const trContent = trMatch[1];
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      cells.push(cleanHtmlCellText(cellMatch[1]));
    }
    if (!cells.length || !cells.some(c => c)) continue;
    if (isCourseTableHeader(cells)) continue;

    let category, name, description, location, teacher, requirement, limit6, limit7;

    if (cells.length >= 10) {
      category = cells[0];
      currentCategory = category || currentCategory;
      name = cells[2];
      description = cells[4] || '';
      location = cells[5] || '';
      teacher = cells[6] || '';
      requirement = cells[7] || '';
      limit6 = cells[8] || '0';
      limit7 = cells[9] || '0';
    } else if (cells.length === 9 && isCategoryCell(cells[0])) {
      category = cells[0];
      currentCategory = category || currentCategory;
      name = cells[2];
      description = cells[3] || '';
      location = cells[4] || '';
      teacher = cells[5] || '';
      requirement = cells[6] || '';
      limit6 = cells[7] || '0';
      limit7 = cells[8] || '0';
    } else if (cells.length === 9 && isSerialCell(cells[0])) {
      category = currentCategory;
      name = cells[1];
      description = cells[2] || '';
      location = cells[3] || '';
      teacher = cells[4] || '';
      requirement = cells[5] || '';
      limit6 = cells[6] || '0';
      limit7 = cells[7] || '0';
    } else if (cells.length === 8 && isSerialCell(cells[0])) {
      category = currentCategory;
      name = cells[1];
      description = cells[2] || '';
      location = cells[3] || '';
      teacher = cells[4] || '';
      requirement = cells[5] || '';
      limit6 = cells[6] || '0';
      limit7 = cells[7] || '0';
    } else {
      continue;
    }

    if (!name || name === '封面' || /^\d+$/.test(name)) continue;

    courses.push({
      category: category || currentCategory || '体育健康类',
      name,
      description,
      teacher,
      location,
      requirement,
      limit_grade6: parseInt(limit6, 10) || 0,
      limit_grade7: parseInt(limit7, 10) || 0,
      selected_count: 0,
      is_active: true
    });
  }

  return courses;
}

function docxCoursesToRows(courses) {
  const header = ['类别', '课程', '简介', '地点', '授课老师', '报名要求', '六年级人数限制', '七年级人数限制'];
  const rows = [header];
  for (const c of courses) {
    rows.push([c.category, c.name, c.description, c.location, c.teacher, c.requirement, String(c.limit_grade6), String(c.limit_grade7)]);
  }
  return rows;
}

function parseHtmlTableToRows(html) {
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1];
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      const text = cellMatch[1]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .trim();
      cells.push(text);
    }
    if (cells.length && cells.some(c => c)) rows.push(cells);
  }
  if (rows.length === 0) throw new Error('未识别 HTML 表格，请将文件另存为 .xlsx 格式');
  return rows;
}

async function parseExcelBufferToRows(buffer, filename) {
  const bytes = new Uint8Array(buffer);
  const previewLen = Math.min(bytes.length, 512);
  let head = '';
  for (let i = 0; i < previewLen; i++) head += String.fromCharCode(bytes[i]);
  const lowerName = (filename || '').toLowerCase();

  if (lowerName.endsWith('.xls') && (/^\s*</.test(head) || head.toLowerCase().includes('<html') || head.includes('MIME-Version'))) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return parseHtmlTableToRows(text);
  }

  const XLSX = await import('xlsx');
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: false, cellStyles: false });
  } catch (e1) {
    try {
      wb = XLSX.read(buffer, { type: 'binary', codepage: 936, cellNF: false, cellStyles: false });
    } catch (e2) {
      throw new Error('无法识别 Excel 文件，请另存为 .xlsx 或 .csv 后重新上传');
    }
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) throw new Error('文件中未找到工作表');
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('无法读取工作表内容');
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

async function parseDocxBufferToRows(buffer) {
  const mammoth = await import('mammoth');
  const convertOpts = {
    convertImage: mammoth.images.imgElement(function() {
      return { src: '' };
    })
  };
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer: buffer }, convertOpts);
  const html = htmlResult.value || '';

  if (html.includes('<table')) {
    const courses = parseDocxTableHtml(html);
    if (courses.length > 0) return docxCoursesToRows(courses);
  }

  throw new Error('Word 文件中未找到有效课程表格，请确认文档为表格格式');
}

function mapHeaderToField(trimmed) {
  if (!trimmed || /^序号$/.test(trimmed)) return null;
  if (/类别|课程类别|分类/.test(trimmed)) return 'category';
  if (/课程名称|课程名/.test(trimmed)) return 'name';
  if (trimmed === '课程') return 'name';
  if (/简介|描述|课程简介/.test(trimmed)) return 'description';
  if (/授课老师|任课老师|教师|老师/.test(trimmed)) return 'teacher';
  if (/授课地点|教室|地点|位置/.test(trimmed)) return 'location';
  if (/报名要求/.test(trimmed) || trimmed === '要求' || trimmed === '备注') return 'requirement';
  if (/六年级人数限制|六年级.*名额|六年级.*人数/.test(trimmed)) return 'limit_grade6';
  if (/七年级人数限制|七年级.*名额|七年级.*人数/.test(trimmed)) return 'limit_grade7';
  if (/名称|课名/.test(trimmed)) return 'name';
  if (/^六年级$/.test(trimmed)) return 'limit_grade6';
  if (/^七年级$/.test(trimmed)) return 'limit_grade7';
  return null;
}

function mapCSVHeaders(headers) {
  const map = { category: -1, name: -1, description: -1, teacher: -1, location: -1, requirement: -1, limit_grade6: -1, limit_grade7: -1 };
  headers.forEach((h, i) => {
    const trimmed = String(h || '').replace(/^\uFEFF/, '').trim();
    const field = mapHeaderToField(trimmed);
    if (field && map[field] < 0) map[field] = i;
  });
  return map;
}

const COURSE_HEADER_HINT = '类别、序号、课程、简介、地点、授课老师、报名要求、六年级人数限制、七年级人数限制';

function rowsToCourses(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h || '').trim().replace(/^\uFEFF/, ''));
  const colMap = mapCSVHeaders(headers);
  if (colMap.name < 0) {
    throw new Error('未找到「课程」列，请检查表头是否包含：' + COURSE_HEADER_HINT);
  }
  const courses = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const getCol = (idx) => (idx >= 0 && row[idx] != null) ? String(row[idx]).trim() : '';
    const name = getCol(colMap.name);
    if (!name) continue;
    courses.push({
      category: getCol(colMap.category) || '体育健康类',
      name,
      description: getCol(colMap.description),
      teacher: getCol(colMap.teacher),
      location: getCol(colMap.location),
      requirement: getCol(colMap.requirement),
      limit_grade6: parseInt(getCol(colMap.limit_grade6), 10) || 0,
      limit_grade7: parseInt(getCol(colMap.limit_grade7), 10) || 0,
      selected_count: 0,
      is_active: true
    });
  }
  return courses;
}

async function handleCourseUpload(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return json({ error: '缺少上传文件' }, 400);

    const name = (file.name || '').toLowerCase();
    const buffer = await file.arrayBuffer();
    let rows = [];

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseExcelBufferToRows(buffer, name);
    } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return json({ error: '文件内容为空或格式不正确' }, 400);
      rows = lines.map(parseCSVLine);
    } else if (name.endsWith('.docx')) {
      rows = await parseDocxBufferToRows(buffer);
    } else {
      return json({ error: '不支持的文件格式，请使用 .xlsx / .xls / .csv / .docx' }, 400);
    }

    const courses = rowsToCourses(rows);
    if (courses.length === 0) {
      return json({ error: '未能解析出课程数据，请检查表头是否包含：' + COURSE_HEADER_HINT }, 400);
    }

    return json({ success: true, count: courses.length, courses });
  } catch (e) {
    return json({ error: '解析失败：' + e.message }, 400);
  }
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}

// mapCSVHeaders defined above (uses mapHeaderToField)

// ---- Selections ----
function parseGradeClassFields(grade, className) {
  const gIn = String(grade || '').trim();
  const cIn = String(className || '').trim();
  let g = gIn;
  let n = '';
  let m = cIn.match(/^(六年级|七年级)\s*[\(（]?(\d+)[\)）]?\s*班$/);
  if (m) {
    g = m[1];
    n = m[2];
  } else {
    m = cIn.match(/^[\(（]?(\d+)[\)）]?\s*班$/);
    if (m) n = m[1];
    else {
      m = cIn.match(/(\d+)/);
      if (m) n = m[1];
    }
    if (!g) {
      const gm = (gIn + cIn).match(/(六年级|七年级)/);
      if (gm) g = gm[1];
    }
  }
  if (!g && gIn) g = gIn;
  const normalizedClass = g && n ? `${g}(${n})班` : cIn;
  return { grade: g, classNum: n, class_name: normalizedClass };
}

function selectionStudentKey(grade, className, studentName) {
  const parsed = parseGradeClassFields(grade, className);
  // 一人一课：同年级同姓名只保留一条
  return `${parsed.grade}|${String(studentName || '').trim()}`;
}

function preferSelectionRow(a, b) {
  const aLock = Number(a && a.is_locked) === 1 ? 1 : 0;
  const bLock = Number(b && b.is_locked) === 1 ? 1 : 0;
  if (aLock !== bLock) return aLock > bLock ? a : b;
  return ((a && a.id) || 0) >= ((b && b.id) || 0) ? a : b;
}

function dedupeSelectionRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = selectionStudentKey(row.grade, row.class_name, row.student_name);
    const existing = map.get(key);
    if (!existing) map.set(key, row);
    else map.set(key, preferSelectionRow(existing, row));
  }
  return sortSelectionsByClass(Array.from(map.values()));
}

function sortSelectionsByClass(rows) {
  const gradeRank = { '六年级': 6, '七年级': 7 };
  return (rows || []).slice().sort((a, b) => {
    const pa = parseGradeClassFields(a.grade, a.class_name);
    const pb = parseGradeClassFields(b.grade, b.class_name);
    const ga = gradeRank[pa.grade] || 99;
    const gb = gradeRank[pb.grade] || 99;
    if (ga !== gb) return ga - gb;
    const na = parseInt(pa.classNum, 10) || 999;
    const nb = parseInt(pb.classNum, 10) || 999;
    if (na !== nb) return na - nb;
    const nameCmp = String(a.student_name || '').localeCompare(String(b.student_name || ''), 'zh');
    if (nameCmp) return nameCmp;
    // 同班同名时内定优先靠前一点（通常只剩一条）
    return (Number(b.is_locked) === 1 ? 1 : 0) - (Number(a.is_locked) === 1 ? 1 : 0);
  });
}

async function removeSelectionsForStudent(db, grade, className, studentName, opts) {
  opts = opts || {};
  const existing = await db.prepare(
    'SELECT * FROM selections WHERE student_name = ?'
  ).bind(studentName).all();

  const wantGrade = parseGradeClassFields(grade, className).grade;
  let deleted = 0;
  for (const row of (existing.results || [])) {
    if (!opts.includeLocked && Number(row.is_locked) === 1) continue;
    if (String(row.student_name || '').trim() !== String(studentName || '').trim()) continue;
    if (wantGrade) {
      const rowGrade = parseGradeClassFields(row.grade, row.class_name).grade;
      if (rowGrade && rowGrade !== wantGrade) continue;
    }
    if (row.course_id) {
      await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(row.course_id).run();
    }
    await db.prepare('DELETE FROM selections WHERE id = ?').bind(row.id).run();
    deleted++;
  }
  return deleted;
}

async function cleanupDuplicateSelections(db) {
  const all = await db.prepare('SELECT * FROM selections ORDER BY id ASC').all();
  const keepByKey = new Map();
  const toDelete = [];

  for (const row of (all.results || [])) {
    const key = selectionStudentKey(row.grade, row.class_name, row.student_name);
    const kept = keepByKey.get(key);
    if (!kept) {
      keepByKey.set(key, row);
    } else {
      const winner = preferSelectionRow(kept, row);
      const loser = winner === kept ? row : kept;
      toDelete.push(loser);
      keepByKey.set(key, winner);
    }
  }

  for (const row of toDelete) {
    if (row.course_id) {
      await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(row.course_id).run();
    }
    await db.prepare('DELETE FROM selections WHERE id = ?').bind(row.id).run();
  }
  return toDelete.length;
}

async function handleSelectionsGet(db, request, url) {
  const auth = requireAuth(request, ['admin', 'banzhuren', 'teacher']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const isAdmin = auth.user.roles.includes('admin');
  const isBanzhuren = auth.user.roles.includes('banzhuren');
  const grade = url.searchParams.get('grade');
  const cls = url.searchParams.get('class') || url.searchParams.get('class_name');
  const course = url.searchParams.get('course');
  const studentName = url.searchParams.get('student_name');
  const lockedOnly = url.searchParams.get('locked') === '1' || url.searchParams.get('locked') === 'true';

  // 管理员全量；班主任可按年级/班级拉取；其他需指定课程或仅拉内定
  if (!isAdmin && !course && !lockedOnly && !(isBanzhuren && (grade || cls))) {
    return json({ error: '请指定课程名称或课程ID' }, 400);
  }
  
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  
  if (lockedOnly) { sql += ' AND is_locked = 1'; }
  if (grade) { sql += ' AND (grade = ? OR class_name LIKE ?)'; params.push(grade, '%' + grade + '%'); }
  // 班级精确匹配放到下方 JS 过滤，兼容「六年级1班 / 六年级(1)班」
  if (course) {
    const courseNum = parseInt(course);
    if (!isNaN(courseNum)) {
      sql += ' AND course_id = ?';
      params.push(courseNum);
    } else {
      sql += ' AND course_name = ?';
      params.push(course);
    }
  }
  if (studentName) { sql += ' AND student_name = ?'; params.push(studentName); }
  
  sql += ' ORDER BY id ASC';
  const results = await db.prepare(sql).bind(...params).all();
  if (!lockedOnly) await cleanupDuplicateSelections(db);
  let list = lockedOnly ? sortSelectionsByClass(results.results || []) : dedupeSelectionRows(results.results);
  if (cls) {
    const want = parseGradeClassFields(grade, cls);
    list = list.filter((row) => {
      const got = parseGradeClassFields(row.grade, row.class_name);
      if (want.classNum) return got.classNum === want.classNum && (!want.grade || !got.grade || got.grade === want.grade);
      const raw = String(row.class_name || '');
      return raw.includes(cls) || raw.replace(/[()（）\s]/g, '').includes(String(cls).replace(/[()（）\s]/g, ''));
    });
    list = sortSelectionsByClass(list);
  }
  return json({ selections: list });
}

async function handleSelectionsBatchCreate(db, request) {
  try {
    if (!await getSelectionEnabled(db)) {
      return json({ error: '当前状态禁止选课，无法保存', code: 'SELECTION_DISABLED' }, 403);
    }
    // Use text() + JSON.parse() instead of request.json() to avoid D1_TYPE_ERROR
    const text = await request.text();
    const body = JSON.parse(text);
    const arr = Array.isArray(body) ? body : [body];
    if (arr.length === 0) return json({ error: '没有可保存的选课数据' }, 400);
    
    const results = [];
    const errors = [];
    
    for (const item of arr) {
      if (!item || !item.student_name) {
        errors.push(`缺少学生姓名`);
        continue;
      }
      
      try {
        const grade = (item.grade != null && item.grade !== '') ? String(item.grade) : '';
        const className = (item.class_name != null && item.class_name !== '') ? String(item.class_name) : '';
        const studentName = (item.student_name != null && item.student_name !== '') ? String(item.student_name) : '';
        const courseName = (item.course_name != null && item.course_name !== '') ? String(item.course_name) : '';
        const courseId = (item.course_id != null && item.course_id !== '') ? (parseInt(item.course_id, 10) || 0) : 0;
        const gender = (item.gender != null && item.gender !== '') ? String(item.gender) : '';

        // 提前录课锁定学生：仅同步年级/班级/性别，不允许改课程；并清除冲突的未锁定记录
        const lockedRows = await db.prepare(
          'SELECT * FROM selections WHERE student_name = ? AND is_locked = 1'
        ).bind(studentName).all();
        if ((lockedRows.results || []).length > 0) {
          await removeSelectionsForStudent(db, grade, className, studentName);
          for (const row of lockedRows.results) {
            const parsed = parseGradeClassFields(grade || row.grade, className || row.class_name);
            await db.prepare(
              'UPDATE selections SET grade = ?, class_name = ?, gender = ? WHERE id = ?'
            ).bind(
              parsed.grade || row.grade || '',
              parsed.class_name || row.class_name || '',
              gender || row.gender || '',
              row.id
            ).run();
            const updated = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(row.id).first();
            results.push(updated);
          }
          continue;
        }

        // 同一学生只保留最新一条：先删除该学生已有未锁定选课记录
        await removeSelectionsForStudent(db, grade, className, studentName);

        const parsedSave = parseGradeClassFields(grade, className);
        const result = await db.prepare(
          'INSERT INTO selections (grade, class_name, student_name, gender, course_id, course_name, selected_at, is_locked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
        ).bind(
          parsedSave.grade || grade,
          parsedSave.class_name || className,
          studentName,
          gender,
          courseId > 0 ? courseId : null,
          courseName,
          new Date().toISOString()
        ).run();

        if (courseId > 0) {
          await db.prepare('UPDATE courses SET selected_count = selected_count + 1 WHERE id = ?').bind(courseId).run();
        }
        
        const selection = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(result.meta.last_row_id).first();
        results.push(selection);
      } catch(innerErr) {
        errors.push('插入失败: ' + innerErr.message);
      }
    }
    
    const countResult = await db.prepare('SELECT COUNT(*) as count FROM selections').first();
    
    return json({
      success: true,
      count: results.length,
      total: countResult.count,
      selections: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e) {
    return json({ error: '保存失败：' + e.message }, 400);
  }
}

/** 管理员提前录课：写入锁定选课记录，班主任端自动占位且不可改 */
async function handlePreEnrollBatch(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let body;
  try {
    const text = await request.text();
    body = JSON.parse(text);
  } catch (_) {
    return json({ error: '请求体无效' }, 400);
  }
  const arr = Array.isArray(body) ? body : (body.selections || body.items || [body]);
  if (!arr.length) return json({ error: '没有可录入的数据' }, 400);

  const coursesRes = await db.prepare('SELECT id, name FROM courses').all();
  const courseByName = {};
  (coursesRes.results || []).forEach((c) => {
    if (c && c.name) courseByName[String(c.name).trim()] = c;
  });

  const results = [];
  const errors = [];
  let success = 0;

  for (const item of arr) {
    if (!item || !item.student_name) {
      errors.push('缺少学生姓名');
      continue;
    }
    const studentName = String(item.student_name).trim();
    const courseName = String(item.course_name || item.course || '').trim();
    if (!courseName) {
      errors.push(studentName + '：缺少课程名称');
      continue;
    }
    const gradeRaw = String(item.grade || '').trim();
    const classRaw = String(item.class_name || item.class || '').trim();
    const parsedClass = parseGradeClassFields(gradeRaw, classRaw);
    const grade = parsedClass.grade;
    const className = parsedClass.class_name;
    const gender = String(item.gender || '').trim();
    let courseId = item.course_id != null && item.course_id !== '' ? (parseInt(item.course_id, 10) || 0) : 0;
    const matched = courseByName[courseName];
    if (!courseId && matched) courseId = matched.id;
    if (!matched && !courseId) {
      errors.push(studentName + '：课程不存在「' + courseName + '」');
      continue;
    }
    const finalCourseName = matched ? matched.name : courseName;

    try {
      // 内定优先、一人一课：清除该生全部旧记录（含未锁定的其他课程）
      const existing = await db.prepare(
        'SELECT * FROM selections WHERE student_name = ?'
      ).bind(studentName).all();
      for (const row of (existing.results || [])) {
        if (row.course_id) {
          await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?')
            .bind(row.course_id).run();
        }
        await db.prepare('DELETE FROM selections WHERE id = ?').bind(row.id).run();
      }

      const result = await db.prepare(
        `INSERT INTO selections (grade, class_name, student_name, gender, course_id, course_name, selected_at, is_locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(
        grade,
        className,
        studentName,
        gender,
        courseId > 0 ? courseId : null,
        finalCourseName,
        new Date().toISOString()
      ).run();

      if (courseId > 0) {
        await db.prepare('UPDATE courses SET selected_count = selected_count + 1 WHERE id = ?').bind(courseId).run();
      }
      const selection = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(result.meta.last_row_id).first();
      results.push(selection);
      success++;
    } catch (e) {
      errors.push(studentName + '：' + e.message);
    }
  }

  return json({
    success: true,
    count: success,
    selections: results,
    errors: errors.length ? errors : undefined
  });
}

async function handleSelectionUpdate(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '选课记录不存在' }, 404);
  
  if (body.course_id) {
    const newCourseId = parseInt(body.course_id);
    // 减少旧课程的已选人数
    if (existing.course_id) {
      await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(existing.course_id).run();
    }
    // 增加新课程的已选人数
    await db.prepare('UPDATE courses SET selected_count = selected_count + 1 WHERE id = ?').bind(newCourseId).run();
    
    const course = await db.prepare('SELECT * FROM courses WHERE id = ?').bind(newCourseId).first();
    const newCourseName = body.course_name || (course ? course.name : existing.course_name);
    
    await db.prepare('UPDATE selections SET course_id = ?, course_name = ? WHERE id = ?').bind(newCourseId, newCourseName, id).run();
  }
  
  const selection = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(id).first();
  return json({ selection });
}

async function handleSelectionDelete(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '选课记录不存在' }, 404);
  
  // 减少课程已选人数
  if (existing.course_id) {
    await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(existing.course_id).run();
  }
  
  await db.prepare('DELETE FROM selections WHERE id = ?').bind(id).run();
  return json({ success: true });
}

async function handleSelectionBatchDelete(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const { ids } = body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return json({ error: '请提供要删除的ID列表' }, 400);
  }
  let deleted = 0;
  for (const id of ids) {
    const existing = await db.prepare('SELECT * FROM selections WHERE id = ?').bind(id).first();
    if (existing) {
      if (existing.course_id) {
        await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(existing.course_id).run();
      }
      await db.prepare('DELETE FROM selections WHERE id = ?').bind(id).run();
      deleted++;
    }
  }
  return json({ success: true, deleted });
}

async function handleSelectionsExport(db, request, url) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const grade = url.searchParams.get('grade');
  const cls = url.searchParams.get('class') || url.searchParams.get('class_name');
  const course = url.searchParams.get('course');
  const studentName = url.searchParams.get('student_name');
  
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  
  if (grade) { sql += ' AND (grade = ? OR class_name LIKE ?)'; params.push(grade, '%' + grade + '%'); }
  if (course) {
    const courseNum = parseInt(course);
    if (!isNaN(courseNum)) {
      sql += ' AND course_id = ?';
      params.push(courseNum);
    } else {
      sql += ' AND course_name = ?';
      params.push(course);
    }
  }
  if (studentName) { sql += ' AND student_name = ?'; params.push(studentName); }
  
  const results = await db.prepare(sql).bind(...params).all();
  await cleanupDuplicateSelections(db);
  let list = dedupeSelectionRows(results.results);
  if (cls) {
    const want = parseGradeClassFields(grade, cls);
    list = list.filter((row) => {
      const got = parseGradeClassFields(row.grade, row.class_name);
      if (want.classNum) return got.classNum === want.classNum && (!want.grade || !got.grade || got.grade === want.grade);
      const raw = String(row.class_name || '');
      return raw.includes(cls) || raw.replace(/[()（）\s]/g, '').includes(String(cls).replace(/[()（）\s]/g, ''));
    });
    list = sortSelectionsByClass(list);
  }
  
  // Generate CSV
  const headers = ['班级', '姓名', '性别', '选课名称'];
  const rows = list.map(s => {
    let className = s.class_name || '';
    if (s.grade && className && className.indexOf(s.grade) === -1) {
      className = s.grade + className;
    } else if (s.grade && !className) {
      className = s.grade;
    }
    return [className, s.student_name || '', s.gender || '', s.course_name || ''];
  });
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const bom = '\uFEFF';
  return new Response(bom + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="selections.csv"',
      ...corsHeaders()
    }
  });
}

async function handleClearSelections(db, request) {
  const url = new URL(request.url);
  const grade = url.searchParams.get('grade');
  const cls = url.searchParams.get('class_name');

  if (grade || cls) {
    const auth = requireAuth(request, ['admin', 'banzhuren']);
    if (auth.error) return json({ error: auth.error }, auth.status);

    let sql = 'SELECT * FROM selections WHERE 1=1';
    const params = [];
    if (grade) { sql += ' AND grade = ?'; params.push(grade); }
    if (cls) { sql += ' AND class_name = ?'; params.push(cls); }

    const toDelete = await db.prepare(sql).bind(...params).all();
    for (const row of toDelete.results) {
      if (Number(row.is_locked) === 1) continue;
      if (row.course_id) {
        await db.prepare('UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?').bind(row.course_id).run();
      }
    }

    let delSql = 'DELETE FROM selections WHERE 1=1 AND (is_locked IS NULL OR is_locked = 0)';
    const delParams = [];
    if (grade) { delSql += ' AND grade = ?'; delParams.push(grade); }
    if (cls) { delSql += ' AND class_name = ?'; delParams.push(cls); }
    await db.prepare(delSql).bind(...delParams).run();

    return json({
      success: true,
      deleted: (toDelete.results || []).filter((r) => Number(r.is_locked) !== 1).length
    });
  }

  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  await db.prepare('DELETE FROM selections').run();
  await db.prepare('UPDATE courses SET selected_count = 0').run();
  return json({ success: true });
}

// ---- Unselected Students ----
async function handleUnselectedStudentsGet(db, request) {
  const url = new URL(request.url);
  const grade = url.searchParams.get('grade');
  const cls = url.searchParams.get('class');
  const studentName = url.searchParams.get('student_name');
  
  let sql = 'SELECT * FROM unselected_students WHERE 1=1';
  const params = [];
  
  if (grade) { sql += ' AND grade = ?'; params.push(grade); }
  if (cls) { sql += ' AND class_name LIKE ?'; params.push('%' + cls + '%'); }
  if (studentName) { sql += ' AND student_name LIKE ?'; params.push('%' + studentName + '%'); }
  
  sql += ' ORDER BY id ASC';
  const results = await db.prepare(sql).bind(...params).all();
  return json({ unselected: results.results });
}

async function handleUnselectedStudentsBatchCreate(db, request) {
  try {
    if (!await getSelectionEnabled(db)) {
      return json({ error: '当前状态禁止选课，无法保存', code: 'SELECTION_DISABLED' }, 403);
    }
    const text = await request.text();
    const body = JSON.parse(text);
    const arr = Array.isArray(body) ? body : [body];
    if (arr.length === 0) return json({ count: 0 });
    
    // 获取用户信息（从请求头或body中获取）
    let userId = null;
    let username = '';
    try {
      const authHeader = request.headers.get('Authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const tokenData = await verifyToken(token);
        if (tokenData && tokenData.userId) {
          userId = tokenData.userId;
          const user = await db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first();
          if (user) username = user.username;
        }
      }
    } catch(e) {
      // 无用户信息时继续保存，user_id 为 null
    }
    
    const uploadedAt = new Date().toISOString();
    let count = 0;
    for (const item of arr) {
      if (!item || !item.student_name) continue;
      await db.prepare(
        'INSERT INTO unselected_students (grade, class_name, student_name, saved_at, user_id, username, user_uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        (item.grade || ''),
        (item.class_name || ''),
        String(item.student_name),
        uploadedAt,
        userId,
        username,
        uploadedAt
      ).run();
      count++;
    }
    return json({ count: count });
  } catch(e) {
    return json({ error: e.message }, 400);
  }
}

async function handleClearUnselectedStudents(db, request) {
  // 支持按用户删除
  const url = new URL(request.url);
  const userIdStr = url.searchParams.get('user_id');
  
  if (userIdStr) {
    const userId = parseInt(userIdStr);
    await db.prepare('DELETE FROM unselected_students WHERE user_id = ?').bind(userId).run();
  } else {
    await db.prepare('DELETE FROM unselected_students').run();
  }
  return json({ success: true });
}

// ---- Classes ----
async function handleClassesGet(db) {
  const results = await db.prepare('SELECT * FROM classes ORDER BY grade, class_name').all();
  return json(results.results);
}

async function handleClassCreate(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  if (!body.grade || !body.class_name) return json({ error: '缺少必填字段（年级/班级名称）' }, 400);
  
  let sc = 0;
  if (body.student_count !== null && body.student_count !== undefined && body.student_count !== '') {
    const n = parseInt(body.student_count, 10);
    if (!isNaN(n) && n >= 0) sc = n;
  }
  
  const result = await db.prepare(`INSERT INTO classes (grade, class_name, teacher_name, student_count)
    VALUES (?, ?, ?, ?)`).bind(
    body.grade,
    body.class_name,
    body.teacher_name || '',
    sc
  ).run();
  
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').bind(result.meta.last_row_id).first();
  return json({ class: cls });
}

async function handleClassUpdate(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '班级不存在' }, 404);
  
  let studentCount = existing.student_count;
  if (body.student_count !== undefined) {
    if (body.student_count === null || body.student_count === '') {
      studentCount = 0;
    } else {
      const n = parseInt(body.student_count, 10);
      studentCount = isNaN(n) ? 0 : Math.max(0, n);
    }
  }
  
  await db.prepare(`UPDATE classes SET grade=?, class_name=?, teacher_name=?, student_count=? WHERE id=?`).bind(
    body.grade || existing.grade,
    body.class_name || existing.class_name,
    body.teacher_name !== undefined ? body.teacher_name : existing.teacher_name,
    studentCount,
    id
  ).run();
  
  const cls = await db.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first();
  return json({ class: cls });
}

async function handleClassDelete(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '班级不存在' }, 404);
  
  await db.prepare('DELETE FROM classes WHERE id = ?').bind(id).run();
  return json({ success: true });
}

// ---- Teachers ----
async function handleTeachersGet(db) {
  const results = await db.prepare("SELECT id, username, teacher_name FROM users WHERE roles LIKE ?").bind('%teacher%').all();
  return json(results.results);
}

// ---- Users Import ----
async function handleUsersImport(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json();
    const users = body.users || [];
    let imported = 0, failed = 0;
    const errors = [];
    
    for (const u of users) {
      if (!u.username || !u.password) { failed++; errors.push(`用户 ${u.username} 缺少必填字段`); continue; }
      
      const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(u.username).first();
      if (existing) { failed++; errors.push(`账号 ${u.username} 已存在`); continue; }
      
      const validRoles = normalizeUserRoles(u.roles || u.role || 'teacher');
      const rolesStr = validRoles.join(',');
      
      const salt = await generateSalt();
      const passwordHash = await hashPassword(u.password, salt);
      
      const result = await db.prepare(`INSERT INTO users (username, password, password_hash, salt, roles, teacher_name, class_name, course_name, email, phone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
        u.username,
        u.password,
        passwordHash,
        salt,
        rolesStr,
        u.teacher_name || '',
        u.class_name || '',
        u.course_name || '',
        u.email || '',
        u.phone || ''
      ).run();
      
      const userId = result.meta.last_row_id;
      for (const r of validRoles) {
        await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(userId, r).run();
      }
      imported++;
    }

    // Record import history
    try {
      const details = errors.slice(0, 20).join('; ');
      await db.prepare(`INSERT INTO import_history (type, operator, imported_count, failed_count, total_count, details)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
        'user_import',
        auth.user ? String(auth.user.userId || '') : 'admin',
        imported,
        failed,
        users.length,
        details
      ).run();
    } catch(histErr) {
      console.error('Failed to record import history:', histErr.message);
    }
    
    return json({ success: true, imported, failed, errors });
  } catch (e) {
    return json({ error: '导入失败：' + e.message }, 400);
  }
}

// ---- Import History ----
async function handleImportHistoryGet(db) {
  const results = await db.prepare('SELECT * FROM import_history ORDER BY created_at DESC LIMIT 100').all();
  const list = results.results.map(h => ({
    id: h.id,
    type: h.type || 'user_import',
    operator: h.operator || '',
    imported_count: h.imported_count || 0,
    failed_count: h.failed_count || 0,
    total_count: h.total_count || 0,
    details: h.details || '',
    created_at: h.created_at || ''
  }));
  return json({ history: list });
}

// ---- Users ----
async function handleUsersGet(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const results = await db.prepare("SELECT * FROM users ORDER BY CASE WHEN roles LIKE '%admin%' THEN 0 WHEN roles LIKE '%banzhuren%' THEN 1 WHEN roles LIKE '%teacher%' THEN 2 ELSE 3 END, username").all();
  const users = results.results.map(u => ({
    ...u,
    roles: (u.roles || '').split(',').filter(Boolean),
    role: (u.roles || 'teacher').split(',')[0] || 'teacher',
    password_hash: undefined,
    salt: undefined
  }));
  return json({ users });
}

async function handleUserCreate(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  if (!body.username || !body.password) return json({ error: '缺少必填字段' }, 400);
  
  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(body.username).first();
  if (existing) return json({ error: '账号已存在' }, 400);
  
  const validRoles = normalizeUserRoles(body.roles || body.role || 'teacher');
  const rolesStr = validRoles.join(',');
  
  const salt = await generateSalt();
  const passwordHash = await hashPassword(body.password, salt);
  
  const result = await db.prepare(`INSERT INTO users (username, password, password_hash, salt, roles, teacher_name, class_name, course_name, email, phone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
    body.username,
    body.password,
    passwordHash,
    salt,
    rolesStr,
    body.teacher_name || '',
    body.class_name || '',
    body.course_name || '',
    body.email || '',
    body.phone || ''
  ).run();
  
  const userId = result.meta.last_row_id;
  for (const r of validRoles) {
    await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(userId, r).run();
  }
  
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json({ success: true, user: { ...user, roles: validRoles, role: validRoles[0] } });
}

async function handleUserUpdate(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '用户不存在' }, 404);
  
  if (body.username && body.username !== existing.username) {
    const duplicate = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(body.username, id).first();
    if (duplicate) return json({ error: '账号已存在' }, 400);
  }
  
  let passwordHash = existing.password_hash;
  let salt = existing.salt;
  if (body.password && String(body.password).trim() !== '') {
    salt = await generateSalt();
    passwordHash = await hashPassword(body.password, salt);
  }
  
  let rolesStr = existing.roles;
  if (body.roles || body.role) {
    const validRoles = normalizeUserRoles(body.roles || body.role);
    rolesStr = validRoles.length > 0 ? validRoles.join(',') : existing.roles;
    
    await db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
    for (const r of rolesStr.split(',').filter(Boolean)) {
      await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(id, r).run();
    }
  }
  
  const newPlainPassword = (body.password && String(body.password).trim() !== '') ? String(body.password) : null;
  
  await db.prepare(`UPDATE users SET username=?, password=?, password_hash=?, salt=?, roles=?, teacher_name=?, class_name=?, course_name=?, email=?, phone=?, status=?, updated_at=datetime('now') WHERE id=?`).bind(
    body.username || existing.username,
    newPlainPassword || (existing.password || ''),
    passwordHash,
    salt,
    rolesStr,
    body.teacher_name !== undefined ? body.teacher_name : existing.teacher_name,
    body.class_name !== undefined ? body.class_name : existing.class_name,
    body.course_name !== undefined ? body.course_name : (existing.course_name || ''),
    body.email !== undefined ? body.email : (existing.email || ''),
    body.phone !== undefined ? body.phone : (existing.phone || ''),
    body.status || existing.status || 'active',
    id
  ).run();
  
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return json({ success: true, user: { ...user, roles: (rolesStr || '').split(',').filter(Boolean), role: (rolesStr || 'teacher').split(',')[0] } });
}

async function handleUserDelete(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '用户不存在' }, 404);
  
  await db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return json({ success: true });
}

// ---- User Status Toggle ----
async function handleUserStatusUpdate(db, request, id) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: '用户不存在' }, 404);
  
  const newStatus = body.status || 'active';
  if (!['active', 'disabled', 'locked'].includes(newStatus)) {
    return json({ error: '无效的状态值' }, 400);
  }
  
  await db.prepare("UPDATE users SET status=?, updated_at=datetime('now') WHERE id=?").bind(newStatus, id).run();
  return json({ success: true, status: newStatus });
}

// ---- Data Consistency Check ----
async function handleConsistencyCheck(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const issues = [];
  const warnings = [];
  
  // Check 1: Users with role field but no password_hash (legacy data)
  const legacyUsers = await db.prepare("SELECT * FROM users WHERE password_hash IS NULL OR password_hash = ''").all();
  for (const u of legacyUsers.results) {
    issues.push({ type: 'legacy_password', user_id: u.id, username: u.username, message: '用户使用旧密码格式，需要迁移密码' });
  }
  
  // Check 2: Users without any role
  const noRoleUsers = await db.prepare("SELECT * FROM users WHERE roles IS NULL OR roles = ''").all();
  for (const u of noRoleUsers.results) {
    issues.push({ type: 'no_role', user_id: u.id, username: u.username, message: '用户没有分配任何角色' });
  }
  
  // Check 3: Orphaned user_roles entries
  const orphanedRoles = await db.prepare(`SELECT ur.* FROM user_roles ur LEFT JOIN users u ON ur.user_id = u.id WHERE u.id IS NULL`).all();
  for (const r of orphanedRoles.results) {
    warnings.push({ type: 'orphan_role', id: r.id, message: `孤立的角色记录: user_id=${r.user_id}` });
  }
  
  // Check 4: Duplicate usernames
  const dupes = await db.prepare(`SELECT username, COUNT(*) as cnt FROM users GROUP BY username HAVING cnt > 1`).all();
  for (const d of dupes.results) {
    issues.push({ type: 'duplicate_username', username: d.username, count: d.cnt, message: `用户名重复: ${d.username}` });
  }
  
  // Check 5: Users with role column inconsistent with user_roles table
  const allUsers = await db.prepare('SELECT * FROM users').all();
  for (const u of allUsers.results) {
    const roleCount = await db.prepare('SELECT COUNT(*) as cnt FROM user_roles WHERE user_id = ?').bind(u.id).first();
    const rolesFromCol = (u.roles || '').split(',').filter(Boolean).length;
    if (roleCount.cnt !== rolesFromCol) {
      warnings.push({ type: 'role_mismatch', user_id: u.id, username: u.username, message: `用户角色表与角色字段不一致` });
    }
  }
  
  const status = issues.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'ok');
  
  // Log the check
  try {
    await db.prepare(`INSERT INTO data_consistency_logs (check_type, status, details) VALUES (?, ?, ?)`).bind(
      'user_consistency',
      status,
      JSON.stringify({ issues, warnings })
    ).run();
  } catch(e) { console.error('Failed to log consistency check:', e.message); }
  
  return json({
    status,
    summary: { issues: issues.length, warnings: warnings.length },
    issues,
    warnings,
    timestamp: new Date().toISOString()
  });
}

// ---- Fix Legacy Passwords ----
async function handleFixLegacyPasswords(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const body = await request.json();
  const defaultPassword = body.default_password || '123456';
  
  const legacyUsers = await db.prepare("SELECT * FROM users WHERE password_hash IS NULL OR password_hash = ''").all();
  let fixed = 0;
  
  for (const u of legacyUsers.results) {
    const salt = await generateSalt();
    const passwordHash = await hashPassword(u.password || defaultPassword, salt);
    await db.prepare("UPDATE users SET password_hash=?, salt=?, updated_at=datetime('now') WHERE id=?").bind(passwordHash, salt, u.id).run();
    fixed++;
  }
  
  return json({ success: true, fixed });
}

// ---- Stats ----
async function handleSelectionStatusGet(db) {
  const enabled = await getSelectionEnabled(db);
  return json(selectionStatusPayload(enabled));
}

async function handleSelectionStatusToggle(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const enabled = !await getSelectionEnabled(db);
  await setSelectionEnabled(db, enabled);
  return json(selectionStatusPayload(enabled));
}

async function handleClassScheduleStatusGet(db, request) {
  const auth = requireAuth(request, ['admin', 'teacher', 'banzhuren']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const status = await getClassScheduleStatus(db);
  return json(status);
}

async function handleClassScheduleToggle(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const today = getTodayDateKey();
  const control = await getClassScheduleControl(db);
  const nextMode = control.mode === 'suspended' ? 'unlocked' : 'suspended';
  await setClassScheduleControl(db, { date: today, mode: nextMode });
  const status = evaluateClassSchedule({ date: today, mode: nextMode });
  return json(Object.assign({ success: true }, status));
}

async function handleStats(db) {
  const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').first();
  const courseCount = await db.prepare('SELECT COUNT(*) as count FROM courses').first();
  const selectionCount = await db.prepare('SELECT COUNT(*) as count FROM selections').first();
  const classCount = await db.prepare('SELECT COUNT(*) as count FROM classes').first();
  
  return json({
    courses: courseCount.count,
    users: userCount.count,
    selections: selectionCount.count,
    classes: classCount.count
  });
}

function countUniqueHistoryDays(history) {
  const dates = new Set();
  (history || []).forEach((h) => { if (h && h.date) dates.add(h.date); });
  return dates.size;
}

function summarizeClassroomPayload(body) {
  const students = Array.isArray(body.students) ? body.students : [];
  const checkin = body.checkin || {};
  const rewards = body.rewards || {};
  const exams = body.exams || {};
  const history = Array.isArray(body.history) ? body.history : [];
  let present = 0, absent = 0, abnormal = 0, pending = 0;

  function studentKeys(s) {
    const name = String((s && s.student_name) || '').trim();
    const cls = String((s && (s.class_name || s.grade)) || '').trim().replace(/[()（）\s]/g, '');
    return [
      s && s.stableId,
      name && (name + '|' + cls),
      s && s.id != null ? String(s.id) : '',
      name
    ].filter(Boolean).map(String);
  }
  function lookup(mapObj, s) {
    const keys = studentKeys(s);
    for (const k of keys) {
      if (mapObj[k] != null) return mapObj[k];
    }
    return undefined;
  }

  students.forEach((s) => {
    const st = lookup(checkin, s);
    const status = st == null ? 'none' : st;
    if (status === 'present') present++;
    else if (status === 'none') pending++;
    else {
      abnormal++;
      if (status === 'absent') absent++;
    }
  });
  let flowerTotal = 0;
  students.forEach((s) => {
    const v = lookup(rewards, s);
    flowerTotal += Number(v) || 0;
  });
  let examDone = 0;
  students.forEach((s) => {
    if ((Number(lookup(exams, s)) || 0) > 0) examDone++;
  });
  const teacher = body.teacher || {};
  const uniqueDays = countUniqueHistoryDays(history);
  const totalClasses = Number(teacher.totalClasses) || uniqueDays || 0;
  return {
    total_classes: totalClasses,
    checkin_day: String(body.checkinDay || ''),
    checkin_done: body.checkinDone ? 1 : 0,
    student_count: students.length,
    present_count: present,
    absent_count: absent,
    abnormal_count: abnormal,
    pending_count: pending,
    flower_total: flowerTotal,
    exam_done_count: examDone,
    session_count: history.length
  };
}

async function handleTeacherClassroomPut(db, request) {
  const auth = requireAuth(request, ['teacher', 'admin', 'banzhuren']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let body;
  try { body = await request.json(); } catch (_) {
    return json({ error: '请求体无效' }, 400);
  }

  const scheduleStatus = await getClassScheduleStatus(db);
  if (authIsTeacherOnly(auth) && !scheduleStatus.allowed) {
    if (payloadHasCheckinActivity(body, scheduleStatus.date)) {
      return json({ error: scheduleStatus.reason || '非上课时间 不可使用' }, 403);
    }
  }

  const courseName = String(body.course_name || body.courseName || '').trim();
  if (!courseName) return json({ error: '缺少课程名称' }, 400);

  const courseId = String(body.course_id || body.courseId || '');
  const teacherName = String(
    (body.teacher && body.teacher.name) || body.teacher_name || body.teacherName || ''
  ).trim();

  // 规范化学生稳定 ID，保证后台与教师端键一致
  const normalizedStudents = (Array.isArray(body.students) ? body.students : []).map((s, i) => {
    const name = String((s && s.student_name) || '').trim();
    const cls = String((s && (s.class_name || s.grade)) || '').trim().replace(/[()（）\s]/g, '');
    const stableId = String((s && s.stableId) || (name ? (name + '|' + cls) : '') || (s && s.id) || (i + 1));
    return Object.assign({}, s, { stableId: stableId, id: s && s.id != null ? s.id : stableId });
  });

  function studentKeyList(s) {
    const name = String((s && s.student_name) || '').trim();
    const cls = String((s && (s.class_name || s.grade)) || '').trim().replace(/[()（）\s]/g, '');
    return [s.stableId, name + '|' + cls, s.id != null ? String(s.id) : '', name].filter(Boolean).map(String);
  }
  function remapToStable(mapObj) {
    const src = mapObj && typeof mapObj === 'object' ? mapObj : {};
    const out = {};
    const used = new Set();
    normalizedStudents.forEach((s) => {
      for (const k of studentKeyList(s)) {
        if (src[k] != null) {
          out[s.stableId] = src[k];
          used.add(k);
          return;
        }
      }
    });
    // 仅保留未能匹配到学生的键（防止误删），已映射的旧数字 id 不再保留
    Object.keys(src).forEach((k) => {
      if (used.has(k) || out[k] != null) return;
      // 若该键能对应某位学生（已写入 out），跳过
      const matched = normalizedStudents.some((s) => studentKeyList(s).includes(String(k)));
      if (matched) return;
      out[k] = src[k];
    });
    return out;
  }

  const normalizedBody = Object.assign({}, body, {
    students: normalizedStudents,
    checkin: remapToStable(body.checkin),
    rewards: remapToStable(body.rewards),
    exams: remapToStable(body.exams),
    history: (Array.isArray(body.history) ? body.history : []).map((h) =>
      Object.assign({}, h, { checkin: remapToStable(h && h.checkin) })
    )
  });
  const summary = summarizeClassroomPayload(normalizedBody);

  // 不落库密码等敏感字段
  const payload = {
    students: normalizedStudents,
    checkin: normalizedBody.checkin,
    checkinDay: body.checkinDay || '',
    checkinDone: !!body.checkinDone,
    rewards: normalizedBody.rewards,
    exams: normalizedBody.exams,
    history: normalizedBody.history,
    activities: body.activities || [],
    teacher: {
      name: teacherName,
      course: courseName,
      location: (body.teacher && body.teacher.location) || body.location || '',
      totalClasses: summary.total_classes
    }
  };

  if (auth.user.roles.includes('admin') && body.total_classes != null) {
    const n = Math.max(0, Number(body.total_classes) || 0);
    summary.total_classes = n;
    payload.teacher.totalClasses = n;
  }

  await db.prepare(
    `INSERT INTO teacher_classroom (
      course_id, course_name, teacher_name, teacher_user_id,
      total_classes, checkin_day, checkin_done,
      student_count, present_count, absent_count, abnormal_count, pending_count,
      flower_total, exam_done_count, session_count, payload, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(course_name) DO UPDATE SET
      course_id = excluded.course_id,
      teacher_name = excluded.teacher_name,
      teacher_user_id = excluded.teacher_user_id,
      total_classes = excluded.total_classes,
      checkin_day = excluded.checkin_day,
      checkin_done = excluded.checkin_done,
      student_count = excluded.student_count,
      present_count = excluded.present_count,
      absent_count = excluded.absent_count,
      abnormal_count = excluded.abnormal_count,
      pending_count = excluded.pending_count,
      flower_total = excluded.flower_total,
      exam_done_count = excluded.exam_done_count,
      session_count = excluded.session_count,
      payload = excluded.payload,
      synced_at = datetime('now')`
  ).bind(
    courseId,
    courseName,
    teacherName,
    auth.user.userId || null,
    summary.total_classes,
    summary.checkin_day,
    summary.checkin_done,
    summary.student_count,
    summary.present_count,
    summary.absent_count,
    summary.abnormal_count,
    summary.pending_count,
    summary.flower_total,
    summary.exam_done_count,
    summary.session_count,
    JSON.stringify(payload)
  ).run();

  return json({ success: true, course_name: courseName, synced_at: new Date().toISOString() });
}

async function handleTeacherClassroomList(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const coursesRes = await db.prepare(
    'SELECT id, name, teacher, location, category, selected_count FROM courses WHERE is_active = 1 ORDER BY category, name'
  ).all();
  const courses = coursesRes.results || [];

  const classRes = await db.prepare('SELECT * FROM teacher_classroom ORDER BY synced_at DESC').all();
  const classroomMap = {};
  (classRes.results || []).forEach((row) => {
    classroomMap[row.course_name] = row;
  });

  const today = new Date();
  const todayKey = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  const items = courses.map((c) => {
    const synced = classroomMap[c.name] || null;
    let todayStatus = '未上报';
    if (synced) {
      if (synced.checkin_day === todayKey && synced.checkin_done) todayStatus = '今日已完成';
      else if (synced.checkin_day === todayKey) todayStatus = '进行中';
      else todayStatus = '待签到';
    }
    return {
      course_id: String(c.id),
      course_name: c.name,
      teacher_name: (synced && synced.teacher_name) || c.teacher || '',
      location: c.location || '',
      category: c.category || '',
      selected_count: c.selected_count || 0,
      synced: !!synced,
      today_status: todayStatus,
      total_classes: synced ? synced.total_classes : 0,
      student_count: synced ? synced.student_count : (c.selected_count || 0),
      present_count: synced ? synced.present_count : 0,
      absent_count: synced ? synced.absent_count : 0,
      abnormal_count: synced ? synced.abnormal_count : 0,
      pending_count: synced ? synced.pending_count : 0,
      flower_total: synced ? synced.flower_total : 0,
      exam_done_count: synced ? synced.exam_done_count : 0,
      session_count: synced ? synced.session_count : 0,
      checkin_day: synced ? synced.checkin_day : '',
      checkin_done: synced ? !!synced.checkin_done : false,
      synced_at: synced ? synced.synced_at : null
    };
  });

  // 也纳入：有同步记录但课程表已删的
  Object.keys(classroomMap).forEach((name) => {
    if (items.some((i) => i.course_name === name)) return;
    const synced = classroomMap[name];
    let todayStatus = '待签到';
    if (synced.checkin_day === todayKey && synced.checkin_done) todayStatus = '今日已完成';
    else if (synced.checkin_day === todayKey) todayStatus = '进行中';
    items.push({
      course_id: synced.course_id || '',
      course_name: name,
      teacher_name: synced.teacher_name || '',
      location: '',
      category: '',
      selected_count: synced.student_count || 0,
      synced: true,
      today_status: todayStatus,
      total_classes: synced.total_classes || 0,
      student_count: synced.student_count || 0,
      present_count: synced.present_count || 0,
      absent_count: synced.absent_count || 0,
      abnormal_count: synced.abnormal_count || 0,
      pending_count: synced.pending_count || 0,
      flower_total: synced.flower_total || 0,
      exam_done_count: synced.exam_done_count || 0,
      session_count: synced.session_count || 0,
      checkin_day: synced.checkin_day || '',
      checkin_done: !!synced.checkin_done,
      synced_at: synced.synced_at || null
    });
  });

  const overview = {
    course_total: items.length,
    synced_total: items.filter((i) => i.synced).length,
    today_done: items.filter((i) => i.today_status === '今日已完成').length,
    today_doing: items.filter((i) => i.today_status === '进行中').length,
    total_classes: items.reduce((s, i) => s + (Number(i.total_classes) || 0), 0),
    absent_total: items.reduce((s, i) => s + (Number(i.absent_count) || 0), 0),
    flower_total: items.reduce((s, i) => s + (Number(i.flower_total) || 0), 0)
  };

  return json({ overview, items, today: todayKey });
}

async function handleTeacherClassroomDetail(db, request, courseName) {
  const auth = requireAuth(request, ['admin', 'teacher', 'banzhuren']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const name = decodeURIComponent(courseName || '').trim();
  if (!name) return json({ error: '缺少课程名称' }, 400);

  if (!auth.user.roles.includes('admin')) {
    const userRow = await db.prepare(
      'SELECT course_name FROM users WHERE id = ?'
    ).bind(auth.user.userId).first();
    const bound = String(userRow && userRow.course_name || '').trim();
    if (bound && bound !== name) {
      return json({ error: '无权查看该课程' }, 403);
    }
  }

  const row = await db.prepare('SELECT * FROM teacher_classroom WHERE course_name = ?').bind(name).first();
  const course = await db.prepare(
    'SELECT id, name, teacher, location, category, selected_count FROM courses WHERE name = ?'
  ).bind(name).first();

  if (!row && !course) return json({ error: '未找到该课程' }, 404);

  let payload = null;
  if (row && row.payload) {
    try { payload = JSON.parse(row.payload); } catch (_) { payload = null; }
  }

  // 若上报 payload 缺学生名单，从选课表补全，保证后台可展示
  if (payload && (!Array.isArray(payload.students) || !payload.students.length)) {
    const selRes = await db.prepare(
      'SELECT id, student_name, class_name, grade, gender, course_id, course_name FROM selections WHERE course_name = ? ORDER BY id ASC'
    ).bind(name).all();
    const seen = new Set();
    payload.students = [];
    (selRes.results || []).forEach((rowSel, i) => {
      const key = String(rowSel.student_name || '') + '|' + String(rowSel.class_name || '');
      if (seen.has(key)) return;
      seen.add(key);
      const stableId = key.replace(/[()（）\s]/g, '');
      payload.students.push({
        id: rowSel.id || (i + 1),
        stableId: stableId,
        student_name: rowSel.student_name,
        class_name: rowSel.class_name,
        grade: rowSel.grade,
        gender: rowSel.gender || '',
        course_name: rowSel.course_name,
        course_id: rowSel.course_id
      });
    });
  }

  const numericHoursTotal = await getNumericHoursTotalForCourse(db, name);

  return json({
    course: course || { name, teacher: (row && row.teacher_name) || '', location: '', selected_count: 0 },
    summary: row ? {
      course_id: row.course_id,
      course_name: row.course_name,
      teacher_name: row.teacher_name,
      total_classes: row.total_classes,
      checkin_day: row.checkin_day,
      checkin_done: !!row.checkin_done,
      student_count: row.student_count || ((payload && payload.students && payload.students.length) || 0),
      present_count: row.present_count,
      absent_count: row.absent_count,
      abnormal_count: row.abnormal_count,
      pending_count: row.pending_count,
      flower_total: row.flower_total,
      exam_done_count: row.exam_done_count,
      session_count: row.session_count,
      synced_at: row.synced_at,
      numeric_hours_total: numericHoursTotal
    } : null,
    numeric_hours_total: numericHoursTotal,
    payload,
    synced: !!row
  });
}

async function getHiddenCourseHourDates(db) {
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?')
      .bind(COURSE_HOURS_HIDDEN_DATES_KEY).first();
    if (!row || !row.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed)
      ? parsed.map((d) => String(d || '').trim()).filter(Boolean)
      : [];
  } catch (_) {
    return [];
  }
}

async function setHiddenCourseHourDates(db, dates) {
  const unique = Array.from(new Set(
    (dates || []).map((d) => String(d || '').trim()).filter(Boolean)
  )).sort();
  await db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(COURSE_HOURS_HIDDEN_DATES_KEY, JSON.stringify(unique)).run();
  return unique;
}

async function getExtraCourseHourDates(db) {
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?')
      .bind(COURSE_HOURS_EXTRA_DATES_KEY).first();
    if (!row || !row.value) return [];
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed)
      ? parsed.map((d) => String(d || '').trim()).filter(Boolean)
      : [];
  } catch (_) {
    return [];
  }
}

async function setExtraCourseHourDates(db, dates) {
  const unique = Array.from(new Set(
    (dates || []).map((d) => String(d || '').trim()).filter(Boolean)
  )).sort();
  await db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(COURSE_HOURS_EXTRA_DATES_KEY, JSON.stringify(unique)).run();
  return unique;
}

function formatCourseHourDateLabel(dateStr) {
  const s = String(dateStr || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return parseInt(m[2], 10) + '月' + parseInt(m[3], 10) + '日';
  return s;
}

/** 课时单元格仅累加纯数字（文本如「张娜代课」不计入） */
function sumNumericCourseHourCells(cells) {
  let sum = 0;
  Object.values(cells || {}).forEach((v) => {
    const s = String(v ?? '').trim();
    if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return;
    sum += Number(s);
  });
  return sum;
}

function buildCourseHourCellsForCourse(name, dates, signedDatesByCourse, overrideMap) {
  const signed = signedDatesByCourse[name] || new Set();
  const cells = {};
  dates.forEach((d) => {
    if (overrideMap[name] && overrideMap[name][d] != null) {
      cells[d] = overrideMap[name][d];
    } else if (signed.has(d)) {
      cells[d] = '1';
    } else {
      cells[d] = '';
    }
  });
  return cells;
}

async function buildCourseHoursMatrix(db) {
  const coursesRes = await db.prepare(
    'SELECT id, name, teacher FROM courses WHERE is_active = 1 ORDER BY category, name'
  ).all();
  const courses = coursesRes.results || [];

  const classRes = await db.prepare('SELECT course_name, teacher_name, payload FROM teacher_classroom').all();
  const classroomMap = {};
  const dateSet = new Set();
  const signedDatesByCourse = {};

  (classRes.results || []).forEach((row) => {
    classroomMap[row.course_name] = row;
    signedDatesByCourse[row.course_name] = new Set();
    let payload = null;
    try { payload = row.payload ? JSON.parse(row.payload) : null; } catch (_) { payload = null; }
    const history = (payload && Array.isArray(payload.history)) ? payload.history : [];
    history.forEach((h) => {
      const d = h && h.date ? String(h.date).trim() : '';
      if (!d) return;
      dateSet.add(d);
      signedDatesByCourse[row.course_name].add(d);
    });
  });

  const overrideRes = await db.prepare('SELECT course_name, session_date, cell_value FROM course_hour_overrides').all();
  const overrideMap = {};
  (overrideRes.results || []).forEach((o) => {
    const cn = String(o.course_name || '').trim();
    const dt = String(o.session_date || '').trim();
    if (!cn || !dt) return;
    if (!overrideMap[cn]) overrideMap[cn] = {};
    overrideMap[cn][dt] = String(o.cell_value ?? '');
    dateSet.add(dt);
  });

  const hiddenDates = new Set(await getHiddenCourseHourDates(db));
  const extraDates = await getExtraCourseHourDates(db);
  extraDates.forEach((d) => {
    if (d && !hiddenDates.has(d)) dateSet.add(d);
  });
  const dates = Array.from(dateSet).filter((d) => !hiddenDates.has(d)).sort();

  const rows = courses.map((c) => {
    const name = c.name;
    const synced = classroomMap[name];
    const cells = buildCourseHourCellsForCourse(name, dates, signedDatesByCourse, overrideMap);
    return {
      course_name: name,
      teacher_name: (synced && synced.teacher_name) || c.teacher || '',
      cells,
      numeric_total: sumNumericCourseHourCells(cells)
    };
  });

  Object.keys(classroomMap).forEach((name) => {
    if (rows.some((r) => r.course_name === name)) return;
    const synced = classroomMap[name];
    const cells = buildCourseHourCellsForCourse(name, dates, signedDatesByCourse, overrideMap);
    rows.push({
      course_name: name,
      teacher_name: synced.teacher_name || '',
      cells,
      numeric_total: sumNumericCourseHourCells(cells)
    });
  });

  rows.sort((a, b) => String(a.course_name).localeCompare(String(b.course_name), 'zh'));

  return {
    dates: dates.map((d) => ({ key: d, label: formatCourseHourDateLabel(d) })),
    rows
  };
}

async function getNumericHoursTotalForCourse(db, courseName) {
  const name = String(courseName || '').trim();
  if (!name) return 0;
  const matrix = await buildCourseHoursMatrix(db);
  const row = matrix.rows.find((r) => r.course_name === name);
  return row ? (row.numeric_total || 0) : 0;
}

/** 管理员：全课程课时矩阵（来自教师签到 history + 可编辑覆盖值） */
async function handleCourseHoursGet(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const matrix = await buildCourseHoursMatrix(db);
  return json(matrix);
}

async function handleCourseHoursTotalGet(db, request, url) {
  const auth = requireAuth(request, ['admin', 'teacher', 'banzhuren']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const courseName = String(url.searchParams.get('course_name') || url.searchParams.get('name') || '').trim();
  if (!courseName) return json({ error: '缺少课程名称' }, 400);

  if (!auth.user.roles.includes('admin')) {
    const userRow = await db.prepare('SELECT course_name FROM users WHERE id = ?').bind(auth.user.userId).first();
    const bound = String(userRow && userRow.course_name || '').trim();
    if (bound && bound !== courseName) {
      return json({ error: '无权查看该课程' }, 403);
    }
  }

  const total = await getNumericHoursTotalForCourse(db, courseName);
  return json({ course_name: courseName, total });
}

async function handleCourseHoursPut(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let body;
  try { body = await request.json(); } catch (_) {
    return json({ error: '请求体无效' }, 400);
  }
  const updates = Array.isArray(body.updates) ? body.updates : (Array.isArray(body) ? body : []);
  const deleteDates = Array.isArray(body.delete_dates)
    ? body.delete_dates.map((d) => String(d || '').trim()).filter(Boolean)
    : [];
  const addDates = Array.isArray(body.add_dates)
    ? body.add_dates.map((d) => String(d || '').trim()).filter(Boolean)
    : [];

  if (!updates.length && !deleteDates.length && !addDates.length) {
    return json({ success: true, count: 0 });
  }

  let count = 0;
  for (const item of updates) {
    const courseName = String(item.course_name || '').trim();
    const sessionDate = String(item.session_date || item.date || '').trim();
    if (!courseName || !sessionDate) continue;
    const cellValue = item.cell_value != null ? String(item.cell_value) : '';
    if (cellValue === '') {
      await db.prepare('DELETE FROM course_hour_overrides WHERE course_name = ? AND session_date = ?')
        .bind(courseName, sessionDate).run();
      count++;
      continue;
    }
    await db.prepare(
      `INSERT INTO course_hour_overrides (course_name, session_date, cell_value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(course_name, session_date) DO UPDATE SET
         cell_value = excluded.cell_value,
         updated_at = datetime('now')`
    ).bind(courseName, sessionDate, cellValue).run();
    count++;
  }

  let hidden = await getHiddenCourseHourDates(db);
  let extra = await getExtraCourseHourDates(db);

  if (deleteDates.length) {
    hidden = Array.from(new Set(hidden.concat(deleteDates)));
    extra = extra.filter((d) => deleteDates.indexOf(d) === -1);
    for (const dt of deleteDates) {
      await db.prepare('DELETE FROM course_hour_overrides WHERE session_date = ?').bind(dt).run();
      count++;
    }
  }

  if (addDates.length) {
    extra = Array.from(new Set(extra.concat(addDates)));
    hidden = hidden.filter((d) => addDates.indexOf(d) === -1);
    count += addDates.length;
  }

  if (deleteDates.length || addDates.length) {
    await setHiddenCourseHourDates(db, hidden);
    await setExtraCourseHourDates(db, extra);
  }

  return json({ success: true, count, deleted_dates: deleteDates, added_dates: addDates });
}

// =======================================================
// 主路由入口
// =======================================================

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  const db = context.env.DB;
  
  // 初始化数据库表（幂等）
  try {
    for (const sql of INIT_STATEMENTS) {
      await db.prepare(sql).run();
    }
    
    // 数据库结构迁移：确保users表有新字段
    try {
      const columnsRes = await db.prepare("PRAGMA table_info(users)").all();
      const colNames = (columnsRes.results || []).map(c => c.name);
      const requiredCols = [
        { name: 'password_hash', def: "TEXT NOT NULL DEFAULT ''" },
        { name: 'salt', def: "TEXT NOT NULL DEFAULT ''" },
        { name: 'roles', def: "TEXT NOT NULL DEFAULT 'teacher'" },
        { name: 'status', def: "TEXT NOT NULL DEFAULT 'active'" },
        { name: 'email', def: "TEXT DEFAULT ''" },
        { name: 'phone', def: "TEXT DEFAULT ''" },
        { name: 'created_at', def: "TEXT DEFAULT ''" },
        { name: 'updated_at', def: "TEXT DEFAULT ''" },
        { name: 'password', def: "TEXT DEFAULT ''" },
        { name: 'course_name', def: "TEXT DEFAULT ''" }
      ];
      for (const col of requiredCols) {
        if (!colNames.includes(col.name)) {
          try {
            await db.prepare(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`).run();
          } catch(alterErr) {
            console.warn(`Alter table add ${col.name} skipped:`, alterErr.message);
          }
        }
      }
      // Handle old password column NOT NULL constraint
      if (colNames.includes('password')) {
        try {
          await db.prepare("UPDATE users SET password='' WHERE password IS NULL OR password = ''").run();
        } catch(e) {}
      }
      // Set created_at for existing rows
      if (!colNames.includes('created_at')) {
        try {
          await db.prepare("UPDATE users SET created_at=datetime('now') WHERE created_at='' OR created_at IS NULL").run();
        } catch(e) {}
      }
    } catch(schemaErr) {
      console.warn('Schema migration check error:', schemaErr.message);
    }

    // selections 表：gender / is_locked 字段
    try {
      const selColsRes = await db.prepare('PRAGMA table_info(selections)').all();
      const selColNames = (selColsRes.results || []).map(c => c.name);
      if (!selColNames.includes('gender')) {
        await db.prepare("ALTER TABLE selections ADD COLUMN gender TEXT DEFAULT ''").run();
      }
      if (!selColNames.includes('is_locked')) {
        await db.prepare('ALTER TABLE selections ADD COLUMN is_locked INTEGER DEFAULT 0').run();
      }
    } catch (selSchemaErr) {
      console.warn('Selections schema migration error:', selSchemaErr.message);
    }
    
    // 检查是否需要初始化默认用户
    const adminCheck = await db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').bind('admin').first();
    if (adminCheck.count === 0) {
      const salt = await generateSalt();
      const passwordHash = await hashPassword('123456', salt);
      const result = await db.prepare(`INSERT INTO users (username, password, password_hash, salt, roles, teacher_name, class_name, status)
        VALUES (?, ?, ?, ?, 'admin', '', '', 'active')`).bind('admin', '123456', passwordHash, salt).run();
      const userId = result.meta.last_row_id;
      await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(userId, 'admin').run();
    }

    await db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)').bind(SELECTION_STATUS_KEY, '1').run();
    
    // 迁移旧数据：检查是否有使用旧密码格式的用户
    try {
      const legacyCheck = await db.prepare("SELECT COUNT(*) as count FROM users WHERE password_hash IS NULL OR password_hash = ''").first();
      if (legacyCheck.count > 0) {
        const legacyUsers = await db.prepare("SELECT * FROM users WHERE password_hash IS NULL OR password_hash = ''").all();
        for (const u of legacyUsers.results) {
          const oldPassword = u.password || '123456';
          const oldRole = u.role || u.roles || 'teacher';
          const rolesList = String(oldRole).split(',').filter(Boolean);
          if (rolesList.length === 0) rolesList.push('teacher');
          const rolesStr = rolesList.join(',');
          
          const salt = await generateSalt();
          const passwordHash = await hashPassword(oldPassword, salt);
          await db.prepare(`UPDATE users SET password_hash=?, salt=?, roles=?, status='active', updated_at=datetime('now') WHERE id=?`).bind(passwordHash, salt, rolesStr, u.id).run();
          
          for (const r of rolesList) {
            await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(u.id, r).run();
          }
        }
        console.log(`Migrated ${legacyCheck.count} legacy users to new password format`);
      }
    } catch(migrateErr) {
      console.warn('Password migration error:', migrateErr.message);
    }
    
    // 迁移 unselected_students 表：添加 user_id 和 username 字段
    try {
      const usColsRes = await db.prepare("PRAGMA table_info(unselected_students)").all();
      const usColNames = (usColsRes.results || []).map(c => c.name);
      if (!usColNames.includes('user_id')) {
        await db.prepare("ALTER TABLE unselected_students ADD COLUMN user_id INTEGER DEFAULT NULL").run();
      }
      if (!usColNames.includes('username')) {
        await db.prepare("ALTER TABLE unselected_students ADD COLUMN username TEXT DEFAULT ''").run();
      }
      if (!usColNames.includes('user_uploaded_at')) {
        await db.prepare("ALTER TABLE unselected_students ADD COLUMN user_uploaded_at TEXT DEFAULT ''").run();
      }
    } catch(usMigrateErr) {
      console.warn('Unselected students migration error:', usMigrateErr.message);
    }
  } catch(e) {
    console.error('DB init error:', e);
  }

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // /api/health
  if (path === '/api/health') {
    return handleHealth(db);
  }
  
  // /api/debug/migrate-passwords (migrate ALL users' passwords from old column)
  if (path === '/api/debug/migrate-passwords' && method === 'POST') {
    try {
      const colsRes = await db.prepare("PRAGMA table_info(users)").all();
      const colNames = (colsRes.results || []).map(c => c.name);
      const hasOldPassword = colNames.includes('password');
      const hasNewHash = colNames.includes('password_hash');
      
      if (!hasNewHash) {
        return json({ error: 'No password_hash column found' }, 500);
      }
      
      // Ensure updated_at column exists
      if (!colNames.includes('updated_at')) {
        try {
          await db.prepare("ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT ''").run();
        } catch(e) {}
      }
      if (!colNames.includes('created_at')) {
        try {
          await db.prepare("ALTER TABLE users ADD COLUMN created_at TEXT DEFAULT ''").run();
        } catch(e) {}
      }
      
      const allUsers = await db.prepare('SELECT * FROM users').all();
      const results = [];
      let migrated = 0;
      let errors = 0;
      
      for (const u of allUsers.results) {
        try {
          let plainPassword = null;
          
          if (hasOldPassword && u.password && u.password.length > 0) {
            plainPassword = u.password;
          } else if (u.password_hash && u.password_hash.length > 0 && u.salt && u.salt.length > 0) {
            results.push({ id: u.id, username: u.username, status: 'skipped (already migrated)' });
            continue;
          } else {
            plainPassword = '123456';
          }
          
          if (!plainPassword) plainPassword = '123456';
          
          const salt = await generateSalt();
          const passwordHash = await hashPassword(plainPassword, salt);
          const role = u.roles || u.role || 'teacher';
          
          await db.prepare(`UPDATE users SET password_hash=?, salt=?, roles=?, status='active' WHERE id=?`)
            .bind(passwordHash, salt, role, u.id).run();
          
          const roleList = String(role).split(',').filter(Boolean);
          for (const r of roleList) {
            await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(u.id, r).run();
          }
          
          results.push({ id: u.id, username: u.username, status: 'migrated', password_was: plainPassword });
          migrated++;
        } catch(innerErr) {
          results.push({ id: u.id, username: u.username, status: 'error', message: innerErr.message });
          errors++;
        }
      }
      
      return json({
        success: true,
        total: allUsers.results.length,
        migrated: migrated,
        errors: errors,
        results: results
      });
    } catch(e) {
      return json({ error: e.message, stack: e.stack }, 500);
    }
  }

  // /api/login
  if (path === '/api/login' && method === 'POST') {
    return handleLogin(db, request);
  }

  // /api/auth/me
  if (path === '/api/auth/me' && method === 'GET') {
    return handleAuthMe(db, request);
  }

  // /api/account — 当前用户账号信息（含可查看密码）
  if (path === '/api/account') {
    if (method === 'GET') return handleAccountGet(db, request);
  }
  // /api/account/password — 当前用户修改密码
  if (path === '/api/account/password' && (method === 'PUT' || method === 'POST')) {
    return handleAccountPasswordPut(db, request);
  }

  // /api/courses/upload (CSV parsing)
  if (path === '/api/courses/upload' && method === 'POST') {
    return handleCourseUpload(db, request);
  }

  // /api/courses (batch save or list or create)
  if (path === '/api/courses') {
    if (method === 'GET') return handleCoursesGet(db);
    if (method === 'PUT') return handleCoursesBatchSave(db, request);
    if (method === 'POST') return handleCourseCreate(db, request);
  }

  // /api/courses/:id
  const courseMatch = path.match(/^\/api\/courses\/(\d+)$/);
  if (courseMatch) {
    const id = parseInt(courseMatch[1]);
    if (method === 'PUT') return handleCourseUpdate(db, request, id);
    if (method === 'DELETE') return handleCourseDelete(db, request, id);
  }

  // /api/selections (batch create or list)
  if (path === '/api/selections') {
    if (method === 'GET') return handleSelectionsGet(db, request, url);
    if (method === 'POST') return handleSelectionsBatchCreate(db, request);
    if (method === 'DELETE') return handleClearSelections(db, request);
  }

  // /api/selections/pre-enroll — 管理员提前录课（须在 :id 路由之前）
  if (path === '/api/selections/pre-enroll' && method === 'POST') {
    return handlePreEnrollBatch(db, request);
  }

  // /api/unselected-students
  if (path === '/api/unselected-students') {
    if (method === 'GET') return handleUnselectedStudentsGet(db, request);
    if (method === 'POST') return handleUnselectedStudentsBatchCreate(db, request);
    if (method === 'DELETE') return handleClearUnselectedStudents(db, request);
  }

  // /api/unselected-students/:id
  const unselectedMatch = path.match(/^\/api\/unselected-students\/(\d+)$/);
  if (unselectedMatch) {
    const id = parseInt(unselectedMatch[1]);
    if (method === 'DELETE') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      await db.prepare('DELETE FROM unselected_students WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
  }

  // /api/selections/batch-delete
  if (path === '/api/selections/batch-delete' && method === 'POST') {
    return handleSelectionBatchDelete(db, request);
  }

  // /api/selections/export
  if (path === '/api/selections/export' && method === 'GET') {
    return handleSelectionsExport(db, request, url);
  }

  // /api/selections/:id
  const selectionMatch = path.match(/^\/api\/selections\/(\d+)$/);
  if (selectionMatch) {
    const id = parseInt(selectionMatch[1]);
    if (method === 'PUT') return handleSelectionUpdate(db, request, id);
    if (method === 'DELETE') return handleSelectionDelete(db, request, id);
  }

  // /api/classes
  if (path === '/api/classes') {
    if (method === 'GET') return handleClassesGet(db);
    if (method === 'POST') return handleClassCreate(db, request);
  }
  const classMatch = path.match(/^\/api\/classes\/(\d+)$/);
  if (classMatch) {
    const id = parseInt(classMatch[1]);
    if (method === 'PUT') return handleClassUpdate(db, request, id);
    if (method === 'DELETE') return handleClassDelete(db, request, id);
  }

  // /api/teachers
  if (path === '/api/teachers' && method === 'GET') {
    return handleTeachersGet(db);
  }

  // /api/users/import
  if (path === '/api/users/import' && method === 'POST') {
    return handleUsersImport(db, request);
  }

  // /api/import-history
  if (path === '/api/import-history' && method === 'GET') {
    return handleImportHistoryGet(db);
  }

  // /api/users
  if (path === '/api/users') {
    if (method === 'GET') return handleUsersGet(db, request);
    if (method === 'POST') return handleUserCreate(db, request);
  }
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const id = parseInt(userMatch[1]);
    if (method === 'PUT') return handleUserUpdate(db, request, id);
    if (method === 'DELETE') return handleUserDelete(db, request, id);
  }

  // /api/users/:id/status
  const userStatusMatch = path.match(/^\/api\/users\/(\d+)\/status$/);
  if (userStatusMatch) {
    const id = parseInt(userStatusMatch[1]);
    if (method === 'PUT') return handleUserStatusUpdate(db, request, id);
  }

  // /api/users/consistency-check
  if (path === '/api/users/consistency-check' && method === 'GET') {
    return handleConsistencyCheck(db, request);
  }

  // /api/users/fix-legacy-passwords
  if (path === '/api/users/fix-legacy-passwords' && method === 'POST') {
    return handleFixLegacyPasswords(db, request);
  }

  // /api/stats
  if (path === '/api/stats') {
    return handleStats(db);
  }

  // /api/course-hours — 全课程课时矩阵
  if (path === '/api/course-hours/total' && method === 'GET') {
    return handleCourseHoursTotalGet(db, request, url);
  }
  if (path === '/api/course-hours') {
    if (method === 'GET') return handleCourseHoursGet(db, request);
    if (method === 'PUT') return handleCourseHoursPut(db, request);
  }

  // /api/teacher-classroom
  if (path === '/api/teacher-classroom') {
    if (method === 'PUT' || method === 'POST') return handleTeacherClassroomPut(db, request);
    if (method === 'GET') {
      const courseName = url.searchParams.get('course_name') || url.searchParams.get('name') || '';
      if (courseName) return handleTeacherClassroomDetail(db, request, courseName);
      return handleTeacherClassroomList(db, request);
    }
  }

  // /api/teacher-classroom/:courseName
  const classroomDetailMatch = path.match(/^\/api\/teacher-classroom\/(.+)$/);
  if (classroomDetailMatch && method === 'GET') {
    return handleTeacherClassroomDetail(db, request, classroomDetailMatch[1]);
  }

  // /api/selection-status
  if (path === '/api/selection-status') {
    if (method === 'GET') return handleSelectionStatusGet(db);
  }

  // /api/selection-status/toggle
  if (path === '/api/selection-status/toggle' && method === 'POST') {
    return handleSelectionStatusToggle(db, request);
  }

  // /api/class-schedule-status — 今日停课 / 解除停课与上课权限
  if (path === '/api/class-schedule-status') {
    if (method === 'GET') return handleClassScheduleStatusGet(db, request);
  }

  if (path === '/api/class-schedule/toggle' && method === 'POST') {
    return handleClassScheduleToggle(db, request);
  }

  return json({ error: 'API not found', path }, 404);
}
