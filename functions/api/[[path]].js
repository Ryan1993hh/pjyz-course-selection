// functions/api/[[path]].js
// Cloudflare Pages Functions - 浦江一中拓展课选课系统
// 使用 Neon Serverless Driver（HTTP 协议，Cloudflare Workers 兼容）
import { neon } from '@neondatabase/serverless';

let _sql = null;
let _initialized = false;

function getSQL() {
  if (!_sql) {
    const url = getEnv('DATABASE_URL') || '';
    if (!url) throw new Error('DATABASE_URL 未配置');
    _sql = neon(url);
  }
  return _sql;
}

function getEnv(name) {
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

async function ensureDB() {
  if (_initialized) return;
  const sql = getSQL();

  // users 表
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'teacher',
    teacher_name TEXT DEFAULT '',
    class_name TEXT DEFAULT ''
  )`;
  // 兼容旧数据库 - 添加新列
  try { await sql`ALTER TABLE users ADD COLUMN class_name TEXT DEFAULT ''`; } catch(e) { /* 列已存在 */ }

  // courses 表
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

  // selections 表
  await sql`CREATE TABLE IF NOT EXISTS selections (
    id SERIAL PRIMARY KEY,
    grade TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    student_name TEXT DEFAULT '',
    course_id INTEGER,
    course_name TEXT DEFAULT '',
    upload_time TEXT DEFAULT ''
  )`;

  // classes 表（班级管理）
  await sql`CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    grade TEXT DEFAULT '',
    class_name TEXT DEFAULT '',
    teacher_name TEXT DEFAULT ''
  )`;

  // 种子账号
  for (const a of [
    { username: 'admin', password: '123456', role: 'admin' },
    { username: '123456', password: '123456', role: 'teacher' }
  ]) {
    const existing = await sql`SELECT id FROM users WHERE username = ${a.username}`;
    if (existing.length === 0) {
      await sql`INSERT INTO users (username, password, role) VALUES (${a.username}, ${a.password}, ${a.role})`;
    }
  }

  _initialized = true;
}

export async function onRequest(context) {
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
    if (path === '/api/health') {
      return json({ status: 'ok', time: new Date().toISOString() }, corsHeaders);
    }

    if (path === '/api/login' && method === 'POST') {
      return handleLogin(context, corsHeaders);
    }

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
    return json({ error: '服务器错误：' + err.message }, 500, corsHeaders);
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// ============ 认证 ============

async function handleLogin(context, corsHeaders) {
  const body = await context.request.json();
  const { username, password } = body;
  if (!username || !password) {
    return json({ error: '请输入账号和密码' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  const users = await sql`SELECT * FROM users WHERE username = ${username} AND password = ${password}`;
  if (users.length === 0) {
    return json({ error: '账号或密码错误' }, 401, corsHeaders);
  }
  const token = createToken(users[0]);
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

async function handleInit(corsHeaders) {
  await ensureDB();
  return json({ success: true, message: '数据库初始化完成' }, 200, corsHeaders);
}

// ============ 课程管理 ============

async function handleGetCourses(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
  return json(rows, 200, corsHeaders);
}

async function handlePutCourses(context, corsHeaders) {
  try {
    const body = await context.request.json();
    if (!Array.isArray(body)) return json({ error: '请求格式错误' }, 400, corsHeaders);
    await ensureDB();
    const sql = getSQL();

    await sql`DELETE FROM courses`;
    for (const c of body) {
      await sql`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7) VALUES (${c.category || ''}, ${c.name || ''}, ${c.description || ''}, ${c.teacher || ''}, ${c.location || ''}, ${c.requirement || ''}, ${parseInt(c.limit_grade6,10)||0}, ${parseInt(c.limit_grade7,10)||0})`;
    }
    const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
    return json({ success: true, count: rows.length, courses: rows }, 200, corsHeaders);
  } catch(err) {
    return json({ error: '保存失败：' + err.message }, 500, corsHeaders);
  }
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
        message: '检测到二进制文件格式（' + name.split('.').pop().toUpperCase() + '）。请使用 CSV 格式文件，或直接在下方表格中手动添加课程。'
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
  await ensureDB();
  const sql = getSQL();
  await sql`DELETE FROM courses WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

// ============ 选课管理 ============

async function handleGetSelections(url, corsHeaders) {
  const grade = url.searchParams.get('grade');
  const className = url.searchParams.get('class');
  const course = url.searchParams.get('course');
  await ensureDB();
  const sql = getSQL();

  let query = `SELECT * FROM selections`;
  const conditions = [];
  const params = [];

  if (grade && grade !== '全部') {
    conditions.push(`grade = $${params.length + 1}`);
    params.push(grade);
  }
  if (className && className !== '全部') {
    conditions.push(`class_name = $${params.length + 1}`);
    params.push(className);
  }
  if (course && course !== '全部') {
    conditions.push(`course_name = $${params.length + 1}`);
    params.push(course);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY id DESC';

  const rows = await sql.query(query, params);
  return json(rows.rows || [], 200, corsHeaders);
}

async function handlePostSelections(context, corsHeaders) {
  const body = await context.request.json();
  if (!Array.isArray(body)) return json({ error: '请求格式错误' }, 400, corsHeaders);
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  await ensureDB();
  const sql = getSQL();
  for (const s of body) {
    await sql`INSERT INTO selections (grade, class_name, student_name, course_id, course_name, upload_time) VALUES (${s.grade||''}, ${s.class_name||''}, ${s.student_name||''}, ${parseInt(s.course_id,10)||null}, ${s.course_name||''}, ${now})`;
  }
  return json({ success: true, count: body.length }, 200, corsHeaders);
}

async function handlePutSelection(id, context, corsHeaders) {
  const body = await context.request.json();
  const { course_id, course_name } = body;
  if (!course_id || !course_name) return json({ error: '缺少课程信息' }, 400, corsHeaders);
  await ensureDB();
  const sql = getSQL();
  await sql`UPDATE selections SET course_id = ${parseInt(course_id,10)}, course_name = ${course_name} WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

async function handleExportSelections(url, corsHeaders) {
  const grade = url.searchParams.get('grade');
  const className = url.searchParams.get('class');
  const course = url.searchParams.get('course');
  await ensureDB();
  const sql = getSQL();
  let rows;
  if (grade && grade !== '全部') {
    rows = await sql`SELECT * FROM selections WHERE grade = ${grade} ORDER BY id DESC`;
  } else {
    rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
  }
  if (className && className !== '全部') rows = rows.filter(r => r.class_name === className);
  if (course && course !== '全部') rows = rows.filter(r => r.course_name === course);

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
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT * FROM classes ORDER BY grade ASC, class_name ASC`;
  return json(rows, 200, corsHeaders);
}

async function handlePostClass(context, corsHeaders) {
  const body = await context.request.json();
  const { grade, class_name, teacher_name } = body;
  if (!grade || !class_name) {
    return json({ error: '年级和班级名称不能为空' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  // 检查重复
  const existing = await sql`SELECT id FROM classes WHERE grade = ${grade} AND class_name = ${class_name}`;
  if (existing.length > 0) {
    return json({ error: '该年级下已存在同名班级' }, 400, corsHeaders);
  }
  const result = await sql`INSERT INTO classes (grade, class_name, teacher_name) VALUES (${grade}, ${class_name}, ${teacher_name || ''}) RETURNING id, grade, class_name, teacher_name`;
  return json({ success: true, class: result[0] }, 201, corsHeaders);
}

async function handlePutClass(id, context, corsHeaders) {
  const body = await context.request.json();
  const { grade, class_name, teacher_name } = body;
  if (!grade || !class_name) {
    return json({ error: '年级和班级名称不能为空' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  // 检查重复（排除自身）
  const existing = await sql`SELECT id FROM classes WHERE grade = ${grade} AND class_name = ${class_name} AND id != ${id}`;
  if (existing.length > 0) {
    return json({ error: '该年级下已存在同名班级' }, 400, corsHeaders);
  }
  await sql`UPDATE classes SET grade = ${grade}, class_name = ${class_name}, teacher_name = ${teacher_name || ''} WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

async function handleDeleteClass(id, corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  await sql`DELETE FROM classes WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

async function handleBatchDeleteClasses(context, corsHeaders) {
  const body = await context.request.json();
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: '请提供要删除的班级ID数组' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  for (const id of ids) {
    await sql`DELETE FROM classes WHERE id = ${parseInt(id,10)}`;
  }
  return json({ success: true, deleted: ids.length }, 200, corsHeaders);
}

async function handleGetGrades(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT DISTINCT grade FROM classes WHERE grade != '' ORDER BY grade ASC`;
  return json(rows.map(r => r.grade), 200, corsHeaders);
}

async function handleGetTeachers(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const userTeachers = await sql`SELECT DISTINCT teacher_name FROM users WHERE teacher_name != ''`;
  const classTeachers = await sql`SELECT DISTINCT teacher_name FROM classes WHERE teacher_name != ''`;
  const all = new Set([
    ...userTeachers.map(r => r.teacher_name),
    ...classTeachers.map(r => r.teacher_name)
  ]);
  return json(Array.from(all).sort(), 200, corsHeaders);
}

// ============ 用户管理 ============

async function handleGetUsers(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT id, username, role, teacher_name, class_name FROM users ORDER BY id ASC`;
  return json(rows, 200, corsHeaders);
}

async function handlePostUsers(context, corsHeaders) {
  const body = await context.request.json();
  const { username, password, role, teacher_name, class_name } = body;
  if (!username || !password) {
    return json({ error: '账号和密码不能为空' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  try {
    const result = await sql`INSERT INTO users (username, password, role, teacher_name, class_name) VALUES (${username}, ${password}, ${role || 'teacher'}, ${teacher_name || ''}, ${class_name || ''}) RETURNING id, username, role, teacher_name, class_name`;
    return json({ success: true, user: result[0] }, 201, corsHeaders);
  } catch (err) {
    return json({ error: '添加失败：' + (err.message || '账号可能已存在') }, 400, corsHeaders);
  }
}

async function handlePutUser(id, context, corsHeaders) {
  const body = await context.request.json();
  const { username, password, role, teacher_name, class_name } = body;
  if (!username) {
    return json({ error: '账号不能为空' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  if (password) {
    await sql`UPDATE users SET username = ${username}, password = ${password}, role = ${role || 'teacher'}, teacher_name = ${teacher_name || ''}, class_name = ${class_name || ''} WHERE id = ${id}`;
  } else {
    await sql`UPDATE users SET username = ${username}, role = ${role || 'teacher'}, teacher_name = ${teacher_name || ''}, class_name = ${class_name || ''} WHERE id = ${id}`;
  }
  return json({ success: true }, 200, corsHeaders);
}

async function handleDeleteUser(id, corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  await sql`DELETE FROM users WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

async function handleImportUsers(context, corsHeaders) {
  const body = await context.request.json();
  const users = body.users;
  if (!Array.isArray(users) || users.length === 0) {
    return json({ error: '请提供用户数据数组' }, 400, corsHeaders);
  }
  await ensureDB();
  const sql = getSQL();
  let successCount = 0;
  let failCount = 0;
  const errors = [];
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
