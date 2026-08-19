// functions/api/[[path]].js
// Cloudflare Pages Functions - 最小化测试版本
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
  // 初始化表
  await sql`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'teacher')`;
  await sql`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, category TEXT DEFAULT '', name TEXT DEFAULT '', description TEXT DEFAULT '', teacher TEXT DEFAULT '', location TEXT DEFAULT '', requirement TEXT DEFAULT '', limit_grade6 INTEGER DEFAULT 0, limit_grade7 INTEGER DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS selections (id SERIAL PRIMARY KEY, grade TEXT DEFAULT '', class_name TEXT DEFAULT '', student_name TEXT DEFAULT '', course_id INTEGER, course_name TEXT DEFAULT '', upload_time TEXT DEFAULT '')`;
  // 种子账号
  for (const a of [{ username: 'admin', password: '123456', role: 'admin' }, { username: '123456', password: '123456', role: 'teacher' }]) {
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

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
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

    // 初始化数据库（管理用）
    if (path === '/api/init' && method === 'POST') {
      return handleInit(corsHeaders);
    }

    // 课程管理
    if (path === '/api/courses' && method === 'GET') {
      return handleGetCourses(corsHeaders);
    }
    if (path === '/api/courses' && method === 'PUT') {
      return handlePutCourses(context, corsHeaders);
    }
    if (path.match(/^\/api\/courses\/\d+$/) && method === 'DELETE') {
      const id = parseInt(path.split('/').pop(), 10);
      return handleDeleteCourse(id, corsHeaders);
    }

    // 选课管理
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

    // 班级列表
    if (path === '/api/classes' && method === 'GET') {
      return handleGetClasses(corsHeaders);
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
  return json({ success: true, token, user: { id: users[0].id, username: users[0].username, role: users[0].role } }, 200, corsHeaders);
}

async function handleInit(corsHeaders) {
  await ensureDB();
  return json({ success: true, message: '数据库初始化完成' }, 200, corsHeaders);
}

async function handleGetCourses(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
  return json(rows, 200, corsHeaders);
}

async function handlePutCourses(context, corsHeaders) {
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
}

async function handleDeleteCourse(id, corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  await sql`DELETE FROM courses WHERE id = ${id}`;
  return json({ success: true }, 200, corsHeaders);
}

async function handleGetSelections(url, corsHeaders) {
  const grade = url.searchParams.get('grade');
  const className = url.searchParams.get('class');
  const course = url.searchParams.get('course');
  await ensureDB();
  const sql = getSQL();
  const conditions = [];
  if (grade && grade !== '全部') conditions.push(`grade = ${grade}`);
  if (className && className !== '全部') conditions.push(`class_name = ${className}`);
  if (course && course !== '全部') conditions.push(`course_name = ${course}`);
  let rows;
  if (conditions.length > 0) {
    const where = conditions.map((_, i) => {
      if (i === 0) return `WHERE ${conditions[0]}`;
      return '';
    }).filter(Boolean).join(' AND ');
    // Use parameterized query
    const parts = conditions[0].split(' ');
    const field = parts[0];
    const val = parts[2].startsWith("'") ? parts[2].slice(1, -1) : parts[2];
    rows = await sql`SELECT * FROM selections WHERE ${field} = ${val} ORDER BY id DESC`;
    if (conditions.length > 1) {
      const field2 = conditions[1].split(' ')[0];
      const val2 = conditions[1].split(' ')[2].startsWith("'") ? conditions[1].split(' ')[2].slice(1, -1) : conditions[1].split(' ')[2];
      rows = rows.filter(r => r[field2] === val2);
    }
  } else {
    rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
  }
  return json(rows, 200, corsHeaders);
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

async function handleGetClasses(corsHeaders) {
  await ensureDB();
  const sql = getSQL();
  const rows = await sql`SELECT DISTINCT class_name FROM selections WHERE class_name != '' ORDER BY class_name ASC`;
  return json(rows.map(r => r.class_name), 200, corsHeaders);
}

// JWT using Web Crypto
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
