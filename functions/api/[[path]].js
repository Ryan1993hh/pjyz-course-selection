// functions/api/[[path]].js
// Cloudflare Pages Functions - 所有 /api/* 请求的 catch-all 处理器
// 使用 Hono 框架 + Neon Serverless PostgreSQL
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getSQL, ensureDB } from '../../lib/db.js';
import { createToken, verifyToken } from '../../lib/auth.js';
import * as XLSX from 'xlsx';

const app = new Hono();

// CORS
app.use('*', cors({
  origin: ['*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// JSON body parser
app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    try {
      const body = await c.req.raw.clone().json();
      c.set('body', body);
    } catch {}
  }
  await next();
});

// ===== 健康检查 =====
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', time: new Date().toISOString(), uptime: Math.floor(performance.now() / 1000) });
});

app.get('/api', (c) => {
  return c.json({
    status: 'ok',
    service: '浦江一中拓展课选课系统 API',
    version: '2.0',
    endpoints: ['POST /api/login', 'GET /api/courses', 'POST /api/courses/upload', 'PUT /api/courses', 'DELETE /api/courses/:id', 'GET /api/selections', 'POST /api/selections', 'PUT /api/selections/:id', 'GET /api/selections/export', 'GET /api/classes']
  });
});

// ===== 登录 =====
app.post('/api/login', async (c) => {
  const body = c.get('body') || {};
  const { username, password } = body;
  if (!username || !password) {
    return c.json({ error: '请输入账号和密码' }, 400);
  }
  try {
    await ensureDB();
    const sql = getSQL();
    const users = await sql`SELECT * FROM users WHERE username = ${username} AND password = ${password}`;
    if (users.length === 0) {
      return c.json({ error: '账号或密码错误' }, 401);
    }
    const token = await createToken(users[0]);
    return c.json({
      success: true,
      token,
      user: { id: users[0].id, username: users[0].username, role: users[0].role }
    });
  } catch (err) {
    return c.json({ error: '登录失败：' + err.message }, 500);
  }
});

// ===== 课程管理 =====
app.get('/api/courses', async (c) => {
  try {
    await ensureDB();
    const sql = getSQL();
    const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
    return c.json(rows);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 字段名映射
const FIELD_ALIASES = {
  category: ['课程类别', '类别', 'category', '课程分类'],
  name: ['课程名称', '名称', '课程名', 'name'],
  description: ['课程简介', '简介', '课程描述', 'description', '介绍'],
  teacher: ['授课老师', '教师', '老师', 'teacher', '授课教师'],
  location: ['授课地点', '地点', '教室', 'location'],
  requirement: ['报名要求', '要求', '限制', 'requirement'],
  limit_grade6: ['六年级人数限制', '六年级名额', '六年级', 'limit_grade6'],
  limit_grade7: ['七年级人数限制', '七年级名额', '七年级', 'limit_grade7']
};

function normalizeHeader(header) {
  const h = String(header || '').trim();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some(a => h === a || h.includes(a))) return field;
  }
  return null;
}

function rowToCourse(row, headerMap) {
  const course = {
    category: '体育健康类', name: '', description: '', teacher: '',
    location: '', requirement: '', limit_grade6: 0, limit_grade7: 0
  };
  for (const key of Object.keys(row)) {
    const field = headerMap[key];
    if (!field) continue;
    const val = String(row[key] ?? '').trim();
    if (field === 'limit_grade6' || field === 'limit_grade7') {
      course[field] = parseInt(val, 10) || 0;
    } else {
      course[field] = val;
    }
  }
  return course;
}

function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return [];
  const headerMap = {};
  for (const h of Object.keys(rows[0])) {
    const f = normalizeHeader(h);
    if (f) headerMap[h] = f;
  }
  return rows.map(r => rowToCourse(r, headerMap)).filter(c => c.name);
}

// 文件上传解析
app.post('/api/courses/upload', async (c) => {
  try {
    const formData = await c.req.raw.formData();
    const file = formData.get('file');
    if (!file) {
      return c.json({ error: '未接收到文件' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    let courses = [];
    if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      courses = parseSheet(sheet);
    } else if (ext === 'docx') {
      return c.json({ error: 'docx 解析暂不支持，请转换为 xlsx 格式上传' }, 400);
    } else {
      return c.json({ error: '不支持的文件格式，仅支持 xlsx、xls' }, 400);
    }
    if (courses.length === 0) {
      return c.json({ error: '未能从文件中解析出课程数据' }, 400);
    }
    return c.json({ success: true, count: courses.length, courses });
  } catch (err) {
    return c.json({ error: '文件解析失败：' + err.message }, 500);
  }
});

// 批量保存课程
app.put('/api/courses', async (c) => {
  const body = c.get('body');
  if (!Array.isArray(body)) {
    return c.json({ error: '请求数据格式错误，应为课程数组' }, 400);
  }
  try {
    await ensureDB();
    const sql = getSQL();
    await sql`DELETE FROM courses`;
    for (const course of body) {
      await sql`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7) VALUES (${course.category || '体育健康类'}, ${course.name || ''}, ${course.description || ''}, ${course.teacher || ''}, ${course.location || ''}, ${course.requirement || ''}, ${parseInt(course.limit_grade6, 10) || 0}, ${parseInt(course.limit_grade7, 10) || 0})`;
    }
    const rows = await sql`SELECT * FROM courses ORDER BY id ASC`;
    return c.json({ success: true, count: rows.length, courses: rows });
  } catch (err) {
    return c.json({ error: '保存失败：' + err.message }, 500);
  }
});

// 删除单门课程
app.delete('/api/courses/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  try {
    await ensureDB();
    const sql = getSQL();
    const result = await sql`DELETE FROM courses WHERE id = ${id}`;
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ===== 选课管理 =====
// 提交选课（同时返回 Excel 下载）
app.post('/api/selections', async (c) => {
  const body = c.get('body');
  if (!Array.isArray(body)) {
    return c.json({ error: '请求数据格式错误，应为选课数组' }, 400);
  }
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  try {
    await ensureDB();
    const sql = getSQL();
    for (const s of body) {
      await sql`INSERT INTO selections (grade, class_name, student_name, course_id, course_name, upload_time) VALUES (${s.grade || ''}, ${s.class_name || ''}, ${s.student_name || ''}, ${parseInt(s.course_id, 10) || null}, ${s.course_name || ''}, ${now})`;
    }
    // 生成 Excel
    const data = body.map((s, i) => ({
      '序号': i + 1,
      '年级': s.grade || '',
      '班级': s.class_name || '',
      '学生姓名': s.student_name || '',
      '课程ID': s.course_id || '',
      '所选课程': s.course_name || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '选课结果');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const filename = encodeURIComponent('选课结果_' + Date.now() + '.xlsx');
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
      }
    });
  } catch (err) {
    return c.json({ error: '保存失败：' + err.message }, 500);
  }
});

// 查询选课
app.get('/api/selections', async (c) => {
  const { grade, class: className, course } = c.req.query();
  try {
    await ensureDB();
    const sql = getSQL();
    let rows;
    if ((!grade || grade === '全部') && (!className || className === '全部') && (!course || course === '全部')) {
      rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
    } else {
      const conditions = [];
      const params = {};
      if (grade && grade !== '全部') { conditions.push(`grade = ${grade}`); }
      if (className && className !== '全部') { conditions.push(`class_name = ${className}`); }
      if (course && course !== '全部') { conditions.push(`course_name = ${course}`); }
      const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      rows = await sql`SELECT * FROM selections WHERE ${whereClause} ORDER BY id DESC`;
    }
    return c.json(rows);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 修改选课记录
app.put('/api/selections/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = c.get('body') || {};
  const { course_id, course_name } = body;
  if (!course_id || !course_name) {
    return c.json({ error: '缺少课程信息' }, 400);
  }
  try {
    await ensureDB();
    const sql = getSQL();
    await sql`UPDATE selections SET course_id = ${parseInt(course_id, 10)}, course_name = ${course_name} WHERE id = ${id}`;
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 导出选课 Excel
app.get('/api/selections/export', async (c) => {
  const { grade, class: className, course } = c.req.query();
  try {
    await ensureDB();
    const sql = getSQL();
    let rows;
    if ((!grade || grade === '全部') && (!className || className === '全部') && (!course || course === '全部')) {
      rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
    } else {
      const conditions = [];
      if (grade && grade !== '全部') { conditions.push(`grade = ${grade}`); }
      if (className && className !== '全部') { conditions.push(`class_name = ${className}`); }
      if (course && course !== '全部') { conditions.push(`course_name = ${course}`); }
      const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';
      rows = await sql`SELECT * FROM selections WHERE ${whereClause} ORDER BY id DESC`;
    }
    const data = rows.map((s, i) => ({
      '序号': i + 1,
      '年级': s.grade || '',
      '班级': s.class_name || '',
      '学生姓名': s.student_name || '',
      '所选课程': s.course_name || '',
      '上传时间': s.upload_time || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '选课结果');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const filename = encodeURIComponent('选课结果导出_' + Date.now() + '.xlsx');
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`
      }
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// 获取班级列表
app.get('/api/classes', async (c) => {
  try {
    await ensureDB();
    const sql = getSQL();
    const rows = await sql`SELECT DISTINCT class_name FROM selections WHERE class_name != '' ORDER BY class_name ASC`;
    return c.json(rows.map(r => r.class_name));
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ===== 用户管理 =====
app.get('/api/users', async (c) => {
  try {
    await ensureDB();
    const sql = getSQL();
    const rows = await sql`SELECT id, username, role FROM users ORDER BY id ASC`;
    return c.json(rows);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ===== 404 兜底 =====
app.notFound((c) => {
  return c.json({ error: 'API 端点不存在' }, 404);
});

// ===== 错误处理 =====
app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({ error: '服务器内部错误：' + err.message }, 500);
});

export default app;
