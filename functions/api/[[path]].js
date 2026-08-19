// functions/api/[[path]].js
// Cloudflare Pages Functions - API handler using Hono + Neon
// Uses pure JS only (no Node.js Buffer/fs required)
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getSQL, ensureDB } from '../../lib/db.js';
import { createToken } from '../../lib/auth.js';

const app = new Hono();

app.use('*', cors({
  origin: ['*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Parse JSON body
app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    try {
      const text = await c.req.text();
      if (text) {
        c.set('body', JSON.parse(text));
      } else {
        c.set('body', {});
      }
    } catch {
      c.set('body', {});
    }
  }
  await next();
});

// ===== 健康检查 =====
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', time: new Date().toISOString() });
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
    console.error('[LOGIN ERROR]', err);
    return c.json({ error: '登录失败：' + (err.message || '服务器错误') }, 500);
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

// 批量保存课程（前端已解析，直接存 JSON）
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
    await sql`DELETE FROM courses WHERE id = ${id}`;
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ===== 选课管理 =====
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
    return c.json({ success: true, count: body.length });
  } catch (err) {
    return c.json({ error: '保存失败：' + err.message }, 500);
  }
});

app.get('/api/selections', async (c) => {
  const { grade, class: className, course } = c.req.query();
  try {
    await ensureDB();
    const sql = getSQL();
    let rows;
    const conditions = [];
    if (grade && grade !== '全部') conditions.push(`grade = ${grade}`);
    if (className && className !== '全部') conditions.push(`class_name = ${className}`);
    if (course && course !== '全部') conditions.push(`course_name = ${course}`);
    if (conditions.length > 0) {
      rows = await sql`SELECT * FROM selections WHERE ${conditions.join(' AND ')} ORDER BY id DESC`;
    } else {
      rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
    }
    return c.json(rows);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

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

// 导出选课数据为 CSV
app.get('/api/selections/export', async (c) => {
  const { grade, class: className, course } = c.req.query();
  try {
    await ensureDB();
    const sql = getSQL();
    let rows;
    const conditions = [];
    if (grade && grade !== '全部') conditions.push(`grade = ${grade}`);
    if (className && className !== '全部') conditions.push(`class_name = ${className}`);
    if (course && course !== '全部') conditions.push(`course_name = ${course}`);
    if (conditions.length > 0) {
      rows = await sql`SELECT * FROM selections WHERE ${conditions.join(' AND ')} ORDER BY id DESC`;
    } else {
      rows = await sql`SELECT * FROM selections ORDER BY id DESC`;
    }
    // 生成 CSV
    const headers = ['序号', '年级', '班级', '学生姓名', '所选课程', '上传时间'];
    const csvRows = [headers.join(',')];
    rows.forEach((r, i) => {
      csvRows.push([
        i + 1,
        r.grade || '',
        r.class_name || '',
        r.student_name || '',
        r.course_name || '',
        r.upload_time || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    });
    const csv = '\uFEFF' + csvRows.join('\n');
    const filename = encodeURIComponent('选课结果导出_' + Date.now() + '.csv');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
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

// ===== 404 =====
app.notFound((c) => {
  return c.json({ error: 'API 端点不存在' }, 404);
});

app.onError((err, c) => {
  console.error('[ERROR]', err);
  return c.json({ error: '服务器内部错误：' + (err.message || '未知错误') }, 500);
});

export default app;
