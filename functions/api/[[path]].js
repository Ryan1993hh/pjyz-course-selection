// functions/api/[[path]].js
// Cloudflare Pages Functions - 浦江一中拓展课选课系统
// 支持 Neon Serverless Driver（HTTP 协议）及内存降级模式

// ============ 环境变量 ============
let _env = null;

function setEnv(env) {
  _env = env || {};
}

function getEnv(name) {
  if (_env && _env[name]) return _env[name];
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

// ============ 动态加载 Neon 驱动 ============
let _neonModule = null;
let _neonLoadAttempted = false;
let _neonAvailable = false;

async function tryLoadNeon() {
  if (_neonLoadAttempted) return _neonAvailable;
  _neonLoadAttempted = true;
  try {
    _neonModule = await import('@neondatabase/serverless');
    _neonAvailable = true;
  } catch (e) {
    console.warn('[neon] 驱动加载失败，使用内存模式:', e.message);
    _neonAvailable = false;
  }
  return _neonAvailable;
}

let _sql = null;
let _dbInitialized = false;

function getSQL() {
  if (!_neonAvailable || !_neonModule) return null;
  if (!_sql) {
    const url = getEnv('DATABASE_URL') || '';
    if (!url) return null;
    _sql = _neonModule.neon(url);
  }
  return _sql;
}

async function ensureDB() {
  if (!_neonAvailable) return false;
  if (_dbInitialized) return true;
  const sql = getSQL();
  if (!sql) return false;

  try {
    await sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'teacher',
      teacher_name TEXT DEFAULT '',
      class_name TEXT DEFAULT ''
    )`;
    try { await sql`ALTER TABLE users ADD COLUMN class_name TEXT DEFAULT ''`; } catch(e) {}

    await sql`CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      category TEXT DEFAULT '',
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      teacher TEXT DEFAULT '',
      location TEXT DEFAULT '',
      requirement TEXT DEFAULT '',
      limit_grade6 INTEGER DEFAULT 0,
      limit_grade7 INTEGER DEFAULT 0
    )`;

    await sql`CREATE TABLE IF NOT EXISTS selections (
      id SERIAL PRIMARY KEY,
      grade TEXT DEFAULT '',
      class_name TEXT DEFAULT '',
      student_name TEXT DEFAULT '',
      course_id INTEGER,
      course_name TEXT DEFAULT '',
      upload_time TEXT DEFAULT ''
    )`;

    await sql`CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      grade TEXT DEFAULT '',
      class_name TEXT DEFAULT '',
      teacher_name TEXT DEFAULT ''
    )`;

    for (const a of [
      { username: 'admin', password: '123456', role: 'admin' },
      { username: '123456', password: '123456', role: 'teacher' }
    ]) {
      const existing = await sql`SELECT id FROM users WHERE username = ${a.username}`;
      if (existing.length === 0) {
        await sql`INSERT INTO users (username, password, role) VALUES (${a.username}, ${a.password}, ${a.role})`;
      }
    }

    _dbInitialized = true;
    return true;
  } catch (e) {
    console.warn('[db] 初始化失败，使用内存模式:', e.message);
    _neonAvailable = false;
    return false;
  }
}

// ============ 内存存储（降级模式） ============
const mem = {
  users: [
    { id: 1, username: 'admin', password: '123456', role: 'admin', teacher_name: '', class_name: '' },
    { id: 2, username: '123456', password: '123456', role: 'teacher', teacher_name: '', class_name: '' }
  ],
  courses: [],
  selections: [],
  classes: [],
  userIdCounter: 3,
  courseIdCounter: 1,
  selectionIdCounter: 1,
  classIdCounter: 1
};

// ============ 主入口 ============
export async function onRequest(context) {
  setEnv(context.env);
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders });
  }

  try {
    // 懒加载 Neon 驱动（首次请求时尝试，不阻塞）
    if (!_neonLoadAttempted) {
      tryLoadNeon().catch(() => {});
    }

    // ===== 健康检查 =====
    if (path === '/api/health') {
      const dbStatus = _neonAvailable ? (_dbInitialized ? 'connected' : 'configured') : 'memory';
      return json({ status: 'ok', database: dbStatus, time: new Date().toISOString() }, corsHeaders);
    }

    // ===== 登录 =====
    if (path === '/api/login' && method === 'POST') {
      return handleLogin(context, corsHeaders);
    }

    // ===== 初始化 =====
    if (path === '/api/init' && method === 'POST') {
      return handleInit(corsHeaders);
    }

    // ===== 课程管理 =====
    if (path === '/api/courses' && method === 'GET') {
      return handleGetCourses(corsHeaders);
    }
    if (path === '/api/courses' && method === 'PUT') {
      return handlePutCourses(context, corsHeaders);
    }
    if (path === '/api/courses/upload' && method === 'POST') {
      return handleUploadCourses(context, corsHeaders);
    }
    if (path.match(/^\/api\/courses\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop(), 10);
      return handleDeleteCourse(id, corsHeaders);
    }

    // ===== 选课管理 =====
    if (path === '/api/selections' && method === 'GET') {
      return handleGetSelections(url, corsHeaders);
    }
    if (path === '/api/selections' && method === 'POST') {
      return handlePostSelections(context, corsHeaders);
    }
    if (path.match(/^\/api\/selections\/\d+$/) && method === 'PUT') {
      const id = parseInt(path.split('/').pop(), 10);
      return handlePutSelection(id, context, corsHeaders);
    }
    if (path === '/api/selections/export' && method === 'GET') {
      return handleExportSelections(url, corsHeaders);
    }

    // ===== 班级管理 =====
    if (path === '/api/classes' && method === 'GET') {
      return handleGetClasses(corsHeaders);
    }
    if (path === '/api/classes' && method === 'POST') {
      return handlePostClass(context, corsHeaders);
    }
    if (path.match(/^\/api\/classes\/\d+$/) && method === 'PUT') {
      const id = parseInt(path.split('/').pop(), 10);
      return handlePutClass(id, context, corsHeaders);
    }
    if (path.match(/^\/api\/classes\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop(), 10);
      return handleDeleteClass(id, corsHeaders);
    }
    if (path === '/api/classes/batch-delete' && method === 'POST') {
      return handleBatchDeleteClasses(context, corsHeaders);
    }
    if (path === '/api/grades' && method === 'GET') {
      return handleGetGrades(corsHeaders);
    }
    if (path === '/api/teachers' && method === 'GET') {
      return handleGetTeachers(corsHeaders);
    }

    // ===== 用户管理 =====
    if (path === '/api/users' && method === 'GET') {
      return handleGetUsers(corsHeaders);
    }
    if (path === '/api/users' && method === 'POST') {
      return handlePostUsers(context, corsHeaders);
    }
    if (path.match(/^\/api\/users\/\d+$/) && method === 'PUT') {
      const id = parseInt(path.split('/').pop(), 10);
      return handlePutUser(id, context, corsHeaders);
    }
    if (path.match(/^\/api\/users\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop(), 10);
      return handleDeleteUser(id, corsHeaders);
    }
    if (path === '/api/users/import' && method === 'POST') {
      return handleImportUsers(context, corsHeaders);
    }

    return json({ error: 'API 端点不存在', path }, 404, corsHeaders);
  } catch (err) {
    console.error('[ERROR]', err);
    return json({ error: '服务器错误：' + (err.message || '未知错误') }, 500, corsHeaders);
  }
}

// ============ 通用工具 ============
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

const HARDCODED_ACCOUNTS = {
  'admin':  { password: '123456', role: 'admin',  id: 1 },
  '123456': { password: '123456', role: 'teacher', id: 2 }
};

// ============ 认证 ============
async function handleLogin(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { username, password } = body || {};
  if (!username || !password) {
    return json({ error: '请输入账号和密码' }, 400, corsHeaders);
  }

  // 尝试数据库登录
  try {
    const dbOk = await ensureDB();
    if (dbOk) {
      const sql = getSQL();
      const users = await sql`SELECT * FROM users WHERE username = ${username} AND password = ${password}`;
      if (users.length > 0) {
        const token = await createToken(users[0]);
        return json({
          success: true,
          token,
          user: {
            id: users[0].id,
            username: users[0].username,
            role: users[0].role,
            teacher_name: users[0].teacher_name || '',
            class_name: users[0].class_name || ''
          }
        }, 200, corsHeaders);
      }
    }
  } catch (dbErr) {
    console.warn('[login] DB 查询失败，使用降级模式:', dbErr.message);
  }

  // 内存账户验证
  const dbUser = mem.users.find(u => u.username === username && u.password === password);
  if (dbUser) {
    const token = await createToken(dbUser);
    return json({
      success: true,
      token,
      user: {
        id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
        teacher_name: dbUser.teacher_name || '',
        class_name: dbUser.class_name || ''
      }
    }, 200, corsHeaders);
  }

  // 硬编码账户验证
  const hardcoded = HARDCODED_ACCOUNTS[username];
  if (hardcoded && hardcoded.password === password) {
    const token = await createToken({ id: hardcoded.id, username, role: hardcoded.role });
    return json({
      success: true,
      token,
      user: {
        id: hardcoded.id,
        username,
        role: hardcoded.role,
        teacher_name: '',
        class_name: ''
      }
    }, 200, corsHeaders);
  }

  return json({ error: '账号或密码错误' }, 401, corsHeaders);
}

async function handleInit(corsHeaders) {
  await tryLoadNeon();
  const ok = await ensureDB();
  if (ok) {
    return json({ success: true, message: '数据库初始化完成' }, 200, corsHeaders);
  }
  return json({ success: true, message: '内存模式就绪（数据库未连接）' }, 200, corsHeaders);
}

// ============ 课程管理 ============
async function handleGetCourses(corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
      return json(rows, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getCourses] DB 不可用:', e.message);
  }
  return json(mem.courses, 200, corsHeaders);
}

async function handlePutCourses(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  if (!Array.isArray(body)) return json({ error: '请求格式错误' }, 400, corsHeaders);

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      await sql`DELETE FROM courses`;
      for (const c of body) {
        await sql`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7) VALUES (${c.category || ''}, ${c.name || ''}, ${c.description || ''}, ${c.teacher || ''}, ${c.location || ''}, ${c.requirement || ''}, ${parseInt(c.limit_grade6,10)||0}, ${parseInt(c.limit_grade7,10)||0})`;
      }
      const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
      return json({ success: true, count: rows.length, courses: rows }, 200, corsHeaders);
    }
  } catch (err) {
    console.warn('[putCourses] DB 保存失败，使用内存:', err.message);
  }

  // 内存模式
  mem.courses = [];
  for (const c of body) {
    mem.courses.push({
      id: mem.courseIdCounter++,
      category: c.category || '',
      name: c.name || '',
      description: c.description || '',
      teacher: c.teacher || '',
      location: c.location || '',
      requirement: c.requirement || '',
      limit_grade6: parseInt(c.limit_grade6, 10) || 0,
      limit_grade7: parseInt(c.limit_grade7, 10) || 0
    });
  }
  return json({ success: true, count: mem.courses.length, courses: mem.courses }, 200, corsHeaders);
}

async function handleUploadCourses(context, corsHeaders) {
  try {
    const formData = await context.request.formData();
    const file = formData.get('file');
    if (!file) {
      return json({ error: '未找到上传文件' }, 400, corsHeaders);
    }
    const name = (file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(buf);

    let courses = [];
    if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      courses = parseDelimited(text, name.endsWith('.tsv') ? '\t' : ',');
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.docx')) {
      return json({
        success: true,
        count: 0,
        courses: [],
        message: '检测到二进制文件格式（' + name.split('.').pop().toUpperCase() + '）。请使用 CSV 格式文件。'
      }, 200, corsHeaders);
    } else {
      courses = parseDelimited(text, ',');
    }
    courses = courses.filter(c => c.name && c.name.trim());
    return json({ success: true, count: courses.length, courses }, 200, corsHeaders);
  } catch (err) {
    return json({ error: '文件解析失败：' + err.message }, 500, corsHeaders);
  }
}

function parseDelimited(text, delimiter) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0], delimiter);
  const headerMap = {};
  headers.forEach((h, i) => {
    const trimmed = (h || '').trim();
    if (trimmed.includes('类别') || trimmed.includes('分类')) headerMap.category = i;
    else if (trimmed.includes('课程') && (trimmed.includes('名') || trimmed === '课程')) headerMap.name = i;
    else if (trimmed.includes('简介') || trimmed.includes('描述')) headerMap.description = i;
    else if (trimmed.includes('老师') || trimmed.includes('教师')) headerMap.teacher = i;
    else if (trimmed.includes('地点') || trimmed.includes('位置')) headerMap.location = i;
    else if (trimmed.includes('要求') || trimmed.includes('备注')) headerMap.requirement = i;
    else if (trimmed.includes('六年级') && trimmed.includes('名额')) headerMap.limit_grade6 = i;
    else if (trimmed.includes('七年级') && trimmed.includes('名额')) headerMap.limit_grade7 = i;
    else if (trimmed === '六年级' || trimmed === '预初') headerMap.limit_grade6 = i;
    else if (trimmed === '七年级' || trimmed === '初一') headerMap.limit_grade7 = i;
  });
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], delimiter);
    const course = {
      category: getCol(cols, headerMap.category, ''),
      name: getCol(cols, headerMap.name, ''),
      description: getCol(cols, headerMap.description, ''),
      teacher: getCol(cols, headerMap.teacher, ''),
      location: getCol(cols, headerMap.location, ''),
      requirement: getCol(cols, headerMap.requirement, ''),
      limit_grade6: parseInt(getCol(cols, headerMap.limit_grade6, '0'), 10) || 0,
      limit_grade7: parseInt(getCol(cols, headerMap.limit_grade7, '0'), 10) || 0
    };
    if (course.name) result.push(course);
  }
  return result;
}

function getCol(cols, idx, defaultVal) {
  if (idx == null) return defaultVal;
  return (cols[idx] || '').trim() || defaultVal;
}

function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function handleDeleteCourse(id, corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      await sql`DELETE FROM courses WHERE id = ${id}`;
    }
  } catch (e) {
    // 内存模式
    const idx = mem.courses.findIndex(c => c.id === id);
    if (idx >= 0) mem.courses.splice(idx, 1);
  }
  // 内存模式兜底
  const idx = mem.courses.findIndex(c => c.id === id);
  if (idx >= 0) mem.courses.splice(idx, 1);
  return json({ success: true }, 200, corsHeaders);
}

// ============ 选课管理 ============
async function handleGetSelections(url, corsHeaders) {
  const grade = url.searchParams.get('grade');
  const className = url.searchParams.get('class');
  const course = url.searchParams.get('course');

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const conditions = [];
      const params = [];
      if (grade && grade !== '全部') { conditions.push('grade = '); params.push(grade); }
      if (className && className !== '全部') { conditions.push('class_name = '); params.push(className); }
      if (course && course !== '全部') { conditions.push('course_name = '); params.push(course); }

      let rows;
      if (conditions.length > 0) {
        let template = `SELECT * FROM selections WHERE `;
        const values = [];
        conditions.forEach((c, i) => {
          if (i > 0) template += ' AND ';
          template += c + '$' + (values.length + 1);
          values.push(params[i]);
        });
        template += ' ORDER BY id DESC';
        rows = await sql(template, values);
      } else {
        rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
      }
      return json(rows || [], 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getSelections] DB 不可用:', e.message);
  }

  // 内存模式过滤
  let rows = [...mem.selections];
  if (grade && grade !== '全部') rows = rows.filter(r => r.grade === grade);
  if (className && className !== '全部') rows = rows.filter(r => r.class_name === className);
  if (course && course !== '全部') rows = rows.filter(r => r.course_name === course);
  rows.sort((a, b) => b.id - a.id);
  return json(rows, 200, corsHeaders);
}

async function handlePostSelections(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  if (!Array.isArray(body)) return json({ error: '请求格式错误' }, 400, corsHeaders);
  const now = new Date().toLocaleString('zh-CN', { hour12: false });

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      for (const s of body) {
        await sql`INSERT INTO selections (grade, class_name, student_name, course_id, course_name, upload_time) VALUES (${s.grade||''}, ${s.class_name||''}, ${s.student_name||''}, ${parseInt(s.course_id,10)||null}, ${s.course_name||''}, ${now})`;
      }
      return json({ success: true, count: body.length }, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[postSelections] DB 保存失败，使用内存:', e.message);
  }

  // 内存模式
  for (const s of body) {
    mem.selections.push({
      id: mem.selectionIdCounter++,
      grade: s.grade || '',
      class_name: s.class_name || '',
      student_name: s.student_name || '',
      course_id: parseInt(s.course_id, 10) || null,
      course_name: s.course_name || '',
      upload_time: now
    });
  }
  return json({ success: true, count: body.length }, 200, corsHeaders);
}

async function handlePutSelection(id, context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { course_id, course_name } = body;
  if (!course_id || !course_name) return json({ error: '缺少课程信息' }, 400, corsHeaders);

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      await sql`UPDATE selections SET course_id = ${parseInt(course_id,10)}, course_name = ${course_name} WHERE id = ${id}`;
      return json({ success: true }, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[putSelection] DB 更新失败，使用内存:', e.message);
  }

  // 内存模式
  const sel = mem.selections.find(s => s.id === id);
  if (sel) {
    sel.course_id = parseInt(course_id, 10);
    sel.course_name = course_name;
  }
  return json({ success: true }, 200, corsHeaders);
}

async function handleExportSelections(url, corsHeaders) {
  const grade = url.searchParams.get('grade');
  const className = url.searchParams.get('class');
  const course = url.searchParams.get('course');

  let rows = [];
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const conditions = [];
      const values = [];
      if (grade && grade !== '全部') { conditions.push('grade = '); values.push(grade); }
      if (className && className !== '全部') { conditions.push('class_name = '); values.push(className); }
      if (course && course !== '全部') { conditions.push('course_name = '); values.push(course); }

      if (conditions.length > 0) {
        let template = 'SELECT * FROM selections WHERE ';
        conditions.forEach((c, i) => {
          if (i > 0) template += ' AND ';
          template += c + '$' + (values.length + 1);
        });
        template += ' ORDER BY id DESC';
        rows = await sql(template, values);
      } else {
        rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
      }
    }
  } catch (e) {
    console.warn('[exportSelections] DB 不可用:', e.message);
  }

  // 内存模式过滤
  if (rows.length === 0) {
    rows = [...mem.selections];
    if (grade && grade !== '全部') rows = rows.filter(r => r.grade === grade);
    if (className && className !== '全部') rows = rows.filter(r => r.class_name === className);
    if (course && course !== '全部') rows = rows.filter(r => r.course_name === course);
    rows.sort((a, b) => b.id - a.id);
  }

  const headers = ['序号', '年级', '班级', '学生姓名', '所选课程', '上传时间'];
  const csvRows = [headers.join(',')];
  rows.forEach((r, i) => {
    csvRows.push([i+1, r.grade||'', r.class_name||'', r.student_name||'', r.course_name||'', r.upload_time||''].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  });
  const csv = '\uFEFF' + csvRows.join('\n');
  const filename = encodeURIComponent('选课结果_' + Date.now() + '.csv');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      ...corsHeaders
    }
  });
}

// ============ 班级管理 ============
async function handleGetClasses(corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const rows = await sql`SELECT * FROM classes ORDER BY grade ASC, class_name ASC`;
      return json(rows, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getClasses] DB 不可用:', e.message);
  }
  return json(mem.classes, 200, corsHeaders);
}

async function handlePostClass(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { grade, class_name, teacher_name } = body;
  if (!grade || !class_name) {
    return json({ error: '年级和班级名称不能为空' }, 400, corsHeaders);
  }

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const existing = await sql`SELECT id FROM classes WHERE grade = ${grade} AND class_name = ${class_name}`;
      if (existing.length > 0) {
        return json({ error: '该年级下已存在同名班级' }, 400, corsHeaders);
      }
      const result = await sql`INSERT INTO classes (grade, class_name, teacher_name) VALUES (${grade}, ${class_name}, ${teacher_name || ''}) RETURNING id, grade, class_name, teacher_name`;
      return json({ success: true, class: result[0] }, 201, corsHeaders);
    }
  } catch (e) {
    console.warn('[postClass] DB 保存失败，使用内存:', e.message);
  }

  // 内存模式
  const exists = mem.classes.find(c => c.grade === grade && c.class_name === class_name);
  if (exists) return json({ error: '该年级下已存在同名班级' }, 400, corsHeaders);
  const cls = { id: mem.classIdCounter++, grade, class_name, teacher_name: teacher_name || '' };
  mem.classes.push(cls);
  return json({ success: true, class: cls }, 201, corsHeaders);
}

async function handlePutClass(id, context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { grade, class_name, teacher_name } = body;
  if (!grade || !class_name) {
    return json({ error: '年级和班级名称不能为空' }, 400, corsHeaders);
  }

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const existing = await sql`SELECT id FROM classes WHERE grade = ${grade} AND class_name = ${class_name} AND id != ${id}`;
      if (existing.length > 0) {
        return json({ error: '该年级下已存在同名班级' }, 400, corsHeaders);
      }
      await sql`UPDATE classes SET grade = ${grade}, class_name = ${class_name}, teacher_name = ${teacher_name || ''} WHERE id = ${id}`;
      return json({ success: true }, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[putClass] DB 更新失败，使用内存:', e.message);
  }

  // 内存模式
  const cls = mem.classes.find(c => c.id === id);
  if (cls) {
    cls.grade = grade;
    cls.class_name = class_name;
    cls.teacher_name = teacher_name || '';
  }
  return json({ success: true }, 200, corsHeaders);
}

async function handleDeleteClass(id, corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      await sql`DELETE FROM classes WHERE id = ${id}`;
    }
  } catch (e) {
    // 内存模式兜底
  }
  const idx = mem.classes.findIndex(c => c.id === id);
  if (idx >= 0) mem.classes.splice(idx, 1);
  return json({ success: true }, 200, corsHeaders);
}

async function handleBatchDeleteClasses(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: '请提供要删除的班级ID数组' }, 400, corsHeaders);
  }

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      for (const cid of ids) {
        await sql`DELETE FROM classes WHERE id = ${parseInt(cid,10)}`;
      }
    }
  } catch (e) {
    console.warn('[batchDeleteClasses] DB 删除失败，使用内存:', e.message);
  }

  // 内存模式
  for (const cid of ids) {
    const idx = mem.classes.findIndex(c => c.id === parseInt(cid, 10));
    if (idx >= 0) mem.classes.splice(idx, 1);
  }
  return json({ success: true, deleted: ids.length }, 200, corsHeaders);
}

async function handleGetGrades(corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const rows = await sql`SELECT DISTINCT grade FROM classes WHERE grade != '' ORDER BY grade ASC`;
      return json(rows.map(r => r.grade), 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getGrades] DB 不可用:', e.message);
  }
  const grades = [...new Set(mem.classes.map(c => c.grade).filter(g => g && g.trim()))].sort();
  return json(grades, 200, corsHeaders);
}

async function handleGetTeachers(corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const userTeachers = await sql`SELECT DISTINCT teacher_name FROM users WHERE teacher_name != ''`;
      const classTeachers = await sql`SELECT DISTINCT teacher_name FROM classes WHERE teacher_name != ''`;
      const all = new Set([
        ...userTeachers.map(r => r.teacher_name),
        ...classTeachers.map(r => r.teacher_name)
      ]);
      return json(Array.from(all).sort(), 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getTeachers] DB 不可用:', e.message);
  }
  const teacherSet = new Set();
  mem.users.forEach(u => { if (u.teacher_name && u.teacher_name.trim()) teacherSet.add(u.teacher_name); });
  mem.classes.forEach(c => { if (c.teacher_name && c.teacher_name.trim()) teacherSet.add(c.teacher_name); });
  return json(Array.from(teacherSet).sort(), 200, corsHeaders);
}

// ============ 用户管理 ============
async function handleGetUsers(corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const rows = await sql`SELECT id, username, role, teacher_name, class_name FROM users ORDER BY id ASC`;
      return json(rows, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[getUsers] DB 不可用:', e.message);
  }
  const safe = mem.users.map(({ password, ...rest }) => rest);
  return json(safe, 200, corsHeaders);
}

async function handlePostUsers(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { username, password, role, teacher_name, class_name } = body;
  if (!username || !password) {
    return json({ error: '账号和密码不能为空' }, 400, corsHeaders);
  }

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      const result = await sql`INSERT INTO users (username, password, role, teacher_name, class_name) VALUES (${username}, ${password}, ${role || 'teacher'}, ${teacher_name || ''}, ${class_name || ''}) RETURNING id, username, role, teacher_name, class_name`;
      return json({ success: true, user: result[0] }, 201, corsHeaders);
    }
  } catch (err) {
    console.warn('[postUsers] DB 保存失败，使用内存:', err.message);
  }

  // 内存模式
  if (mem.users.find(u => u.username === username)) {
    return json({ error: '账号可能已存在' }, 400, corsHeaders);
  }
  const user = { id: mem.userIdCounter++, username, password, role: role || 'teacher', teacher_name: teacher_name || '', class_name: class_name || '' };
  mem.users.push(user);
  const { password: _, ...safe } = user;
  return json({ success: true, user: safe }, 201, corsHeaders);
}

async function handlePutUser(id, context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const { username, password, role, teacher_name, class_name } = body;
  if (!username) {
    return json({ error: '账号不能为空' }, 400, corsHeaders);
  }

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      if (password) {
        await sql`UPDATE users SET username = ${username}, password = ${password}, role = ${role || 'teacher'}, teacher_name = ${teacher_name || ''}, class_name = ${class_name || ''} WHERE id = ${id}`;
      } else {
        await sql`UPDATE users SET username = ${username}, role = ${role || 'teacher'}, teacher_name = ${teacher_name || ''}, class_name = ${class_name || ''} WHERE id = ${id}`;
      }
      return json({ success: true }, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[putUser] DB 更新失败，使用内存:', e.message);
  }

  // 内存模式
  const user = mem.users.find(u => u.id === id);
  if (user) {
    user.username = username;
    if (password) user.password = password;
    user.role = role || 'teacher';
    user.teacher_name = teacher_name || '';
    user.class_name = class_name || '';
  }
  return json({ success: true }, 200, corsHeaders);
}

async function handleDeleteUser(id, corsHeaders) {
  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      await sql`DELETE FROM users WHERE id = ${id}`;
    }
  } catch (e) {
    // 内存模式兜底
  }
  const idx = mem.users.findIndex(u => u.id === id);
  if (idx >= 0) mem.users.splice(idx, 1);
  return json({ success: true }, 200, corsHeaders);
}

async function handleImportUsers(context, corsHeaders) {
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: '请求格式错误' }, 400, corsHeaders);
  }
  const users = body.users;
  if (!Array.isArray(users) || users.length === 0) {
    return json({ error: '请提供用户数据数组' }, 400, corsHeaders);
  }

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  try {
    const ok = await ensureDB();
    if (ok) {
      const sql = getSQL();
      for (const u of users) {
        const { username, password, role, teacher_name, class_name } = u;
        if (!username || !password) {
          failCount++;
          errors.push(`用户 ${username || '(空)'}: 账号或密码为空`);
          continue;
        }
        try {
          await sql`INSERT INTO users (username, password, role, teacher_name, class_name) VALUES (${username}, ${password}, ${role || 'teacher'}, ${teacher_name || ''}, ${class_name || ''})`;
          successCount++;
        } catch (err) {
          failCount++;
          errors.push(`用户 ${username}: ${err.message || '账号可能已存在'}`);
        }
      }
      return json({ success: true, imported: successCount, failed: failCount, errors }, 200, corsHeaders);
    }
  } catch (e) {
    console.warn('[importUsers] DB 不可用，使用内存:', e.message);
  }

  // 内存模式
  for (const u of users) {
    const { username, password, role, teacher_name, class_name } = u;
    if (!username || !password) {
      failCount++;
      errors.push(`用户 ${username || '(空)'}: 账号或密码为空`);
      continue;
    }
    if (mem.users.find(x => x.username === username)) {
      failCount++;
      errors.push(`用户 ${username}: 账号可能已存在`);
      continue;
    }
    mem.users.push({ id: mem.userIdCounter++, username, password, role: role || 'teacher', teacher_name: teacher_name || '', class_name: class_name || '' });
    successCount++;
  }
  return json({ success: true, imported: successCount, failed: failCount, errors }, 200, corsHeaders);
}

// ============ JWT ============
async function createToken(user) {
  const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key';
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const payload = enc({ id: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now()/1000) + 7*86400 });
  const signing = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signing));
  const sigEnc = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `${signing}.${sigEnc}`;
}
