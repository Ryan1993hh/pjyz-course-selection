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
    course_id INTEGER,
    course_name TEXT DEFAULT '',
    selected_at TEXT DEFAULT (datetime('now'))
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
  )`
];

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
        email: user.email || '',
        phone: user.phone || '',
        status: user.status || 'active'
      }
    });
  } catch (e) {
    return json({ error: '请求格式错误' }, 400);
  }
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

// ---- CSV Upload Parsing ----
async function handleCourseUpload(db, request) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return json({ error: '缺少上传文件' }, 400);
    
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return json({ error: '文件内容为空或格式不正确' }, 400);
    
    const headers = parseCSVLine(lines[0]);
    const colMap = mapCSVHeaders(headers);
    const courses = [];
    
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      courses.push({
        category: row[colMap.category] || '体育健康类',
        name: row[colMap.name] || '',
        description: row[colMap.description] || '',
        teacher: row[colMap.teacher] || '',
        location: row[colMap.location] || '',
        requirement: row[colMap.requirement] || '',
        limit_grade6: parseInt(row[colMap.limit_grade6], 10) || 0,
        limit_grade7: parseInt(row[colMap.limit_grade7], 10) || 0,
        selected_count: 0,
        is_active: true
      });
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

function mapCSVHeaders(headers) {
  const map = { category: -1, name: -1, description: -1, teacher: -1, location: -1, requirement: -1, limit_grade6: -1, limit_grade7: -1 };
  headers.forEach((h, i) => {
    const trimmed = h.replace(/^\uFEFF/, '').trim();
    if (/类别|课程类别|分类/.test(trimmed)) map.category = i;
    else if (/课程名称|名称|课名/.test(trimmed)) map.name = i;
    else if (/简介|描述|课程简介/.test(trimmed)) map.description = i;
    else if (/老师|教师|授课老师|任课/.test(trimmed)) map.teacher = i;
    else if (/地点|位置|授课地点|教室/.test(trimmed)) map.location = i;
    else if (/要求|报名要求|限制|备注/.test(trimmed)) map.requirement = i;
    else if (/六年级.*名额|六年级.*人数|六年级/.test(trimmed)) map.limit_grade6 = i;
    else if (/七年级.*名额|七年级.*人数|七年级/.test(trimmed)) map.limit_grade7 = i;
  });
  return map;
}

// ---- Selections ----
async function handleSelectionsGet(db, request, url) {
  const auth = requireAuth(request, ['admin']);
  if (auth.error) return json({ error: auth.error }, auth.status);
  
  const grade = url.searchParams.get('grade');
  const cls = url.searchParams.get('class');
  const course = url.searchParams.get('course');
  const studentName = url.searchParams.get('student_name');
  
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  
  if (grade) { sql += ' AND grade = ?'; params.push(grade); }
  if (cls) { sql += ' AND class_name = ?'; params.push(cls); }
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
  return json({ selections: results.results });
}

async function handleSelectionsBatchCreate(db, request) {
  try {
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
        
        const result = await db.prepare(
          'INSERT INTO selections (grade, class_name, student_name, course_name, selected_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(grade, className, studentName, courseName, new Date().toISOString()).run();
        
        const courseId = (item.course_id != null && item.course_id !== '') ? (parseInt(item.course_id, 10) || 0) : 0;
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
  const cls = url.searchParams.get('class');
  const course = url.searchParams.get('course');
  
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  
  if (grade) { sql += ' AND grade = ?'; params.push(grade); }
  if (cls) { sql += ' AND class_name = ?'; params.push(cls); }
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
  
  const results = await db.prepare(sql).bind(...params).all();
  const list = results.results;
  
  // Generate CSV
  const headers = ['班级', '姓名', '选课名称'];
  const rows = list.map(s => {
    let className = s.class_name || '';
    if (s.grade && className && className.indexOf(s.grade) === -1) {
      className = s.grade + className;
    } else if (s.grade && !className) {
      className = s.grade;
    }
    return [className, s.student_name || '', s.course_name || ''];
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
  if (cls) { sql += ' AND class_name = ?'; params.push(cls); }
  if (studentName) { sql += ' AND student_name LIKE ?'; params.push('%' + studentName + '%'); }
  
  sql += ' ORDER BY id ASC';
  const results = await db.prepare(sql).bind(...params).all();
  return json({ unselected: results.results });
}

async function handleUnselectedStudentsBatchCreate(db, request) {
  try {
    const text = await request.text();
    const body = JSON.parse(text);
    const arr = Array.isArray(body) ? body : [body];
    if (arr.length === 0) return json({ count: 0 });
    
    let count = 0;
    for (const item of arr) {
      if (!item || !item.student_name) continue;
      await db.prepare(
        'INSERT INTO unselected_students (grade, class_name, student_name, saved_at) VALUES (?, ?, ?, ?)'
      ).bind(
        (item.grade || ''),
        (item.class_name || ''),
        String(item.student_name),
        new Date().toISOString()
      ).run();
      count++;
    }
    return json({ count: count });
  } catch(e) {
    return json({ error: e.message }, 400);
  }
}

async function handleClearUnselectedStudents(db, request) {
  await db.prepare('DELETE FROM unselected_students').run();
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
      
      const rolesRaw = u.roles || u.role || 'teacher';
      const rolesArr = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
      const validRoles = rolesArr.filter(r => ['admin', 'teacher'].includes(r));
      if (validRoles.length === 0) validRoles.push('teacher');
      const rolesStr = validRoles.join(',');
      
      const salt = await generateSalt();
      const passwordHash = await hashPassword(u.password, salt);
      
      const result = await db.prepare(`INSERT INTO users (username, password, password_hash, salt, roles, teacher_name, class_name, email, phone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
        u.username,
        u.password,
        passwordHash,
        salt,
        rolesStr,
        u.teacher_name || '',
        u.class_name || '',
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
  
  const results = await db.prepare("SELECT * FROM users ORDER BY CASE WHEN roles LIKE '%admin%' THEN 0 WHEN roles LIKE '%teacher%' THEN 1 ELSE 2 END, username").all();
  const users = results.results.map(u => ({
    ...u,
    roles: (u.roles || '').split(',').filter(Boolean),
    role: (u.roles || 'teacher').split(',')[0] || 'teacher',
    password: undefined,
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
  
  const rolesRaw = body.roles || body.role || 'teacher';
  const rolesArr = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
  const validRoles = rolesArr.filter(r => ['admin', 'teacher'].includes(r));
  if (validRoles.length === 0) validRoles.push('teacher');
  const rolesStr = validRoles.join(',');
  
  const salt = await generateSalt();
  const passwordHash = await hashPassword(body.password, salt);
  
  const result = await db.prepare(`INSERT INTO users (username, password, password_hash, salt, roles, teacher_name, class_name, email, phone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
    body.username,
    body.password,
    passwordHash,
    salt,
    rolesStr,
    body.teacher_name || '',
    body.class_name || '',
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
    const rolesRaw = body.roles || body.role;
    const rolesArr = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw];
    const validRoles = rolesArr.filter(r => ['admin', 'teacher'].includes(r));
    rolesStr = validRoles.length > 0 ? validRoles.join(',') : existing.roles;
    
    await db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
    for (const r of rolesStr.split(',').filter(Boolean)) {
      await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(id, r).run();
    }
  }
  
  const newPlainPassword = (body.password && String(body.password).trim() !== '') ? String(body.password) : null;
  
  await db.prepare(`UPDATE users SET username=?, password=?, password_hash=?, salt=?, roles=?, teacher_name=?, class_name=?, email=?, phone=?, status=?, updated_at=datetime('now') WHERE id=?`).bind(
    body.username || existing.username,
    newPlainPassword || (existing.password || ''),
    passwordHash,
    salt,
    rolesStr,
    body.teacher_name !== undefined ? body.teacher_name : existing.teacher_name,
    body.class_name !== undefined ? body.class_name : existing.class_name,
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
        { name: 'password', def: "TEXT DEFAULT ''" }
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

  return json({ error: 'API not found', path }, 404);
}
