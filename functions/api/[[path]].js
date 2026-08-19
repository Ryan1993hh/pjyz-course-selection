/* =======================================================
 * Cloudflare Pages Function - 选课系统 API 网关
 * 路由: functions/api/[[path]].js
 * 支持: 内存降级模式 + Neon Serverless (动态加载)
 * ======================================================= */

// ---- 环境变量 ----
let _DATABASE_URL = '';

function setEnv(env) {
  _DATABASE_URL = env?.DATABASE_URL || '';
}

// ---- 内存存储 ----
const mem = {
  users: [
    { id: 1, username: 'admin', password: '123456', role: 'admin', teacher_name: '', class_name: '' },
    { id: 2, username: '123456', password: '123456', role: 'teacher', teacher_name: '张老师', class_name: '' },
    { id: 3, username: '12345678', password: '12345678', role: 'teacher', teacher_name: '王老师', class_name: '' }
  ],
  courses: [],
  selections: [],
  classes: [],
  userIdCounter: 4,
  courseIdCounter: 1,
  selectionIdCounter: 1,
  classIdCounter: 1
};

// ---- 数据库动态加载 ----
let _neonModule = null;
let _neonPool = null;
let _neonAvailable = false;
let _neonLoadAttempted = false;

async function tryLoadNeon() {
  if (_neonLoadAttempted) return _neonAvailable;
  _neonLoadAttempted = true;
  if (!_DATABASE_URL) { _neonAvailable = false; return false; }
  try {
    _neonModule = await import('@neondatabase/serverless');
    const { neon } = _neonModule;
    _neonPool = neon(_DATABASE_URL);
    _neonAvailable = true;
  } catch (e) {
    _neonAvailable = false;
  }
  return _neonAvailable;
}

function getPool() { return _neonPool; }
function isDBReady() { return _neonAvailable; }

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

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple token: base64(userId:role:expiry)
async function createToken(userId, role) {
  const expiry = Date.now() + 8 * 60 * 60 * 1000;
  const payload = `${userId}:${role}:${expiry}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const tokenPayload = `${btoa(payload)}.${hashHex.substring(0, 16)}`;
  return tokenPayload;
}

function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const decoded = atob(parts[0]);
    const [userId, role, expiry] = decoded.split(':');
    if (Date.now() > parseInt(expiry)) return null;
    return { userId: parseInt(userId), role };
  } catch (e) { return null; }
}

function getAuthUser(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return verifyToken(token);
}

// ---- 鉴权中间件 ----
function requireAuth(request, allowedRoles) {
  const user = getAuthUser(request);
  if (!user) return { error: '未登录或Token已过期', status: 401 };
  if (allowedRoles.length && !allowedRoles.includes(user.role)) return { error: '权限不足', status: 403 };
  return { user };
}

// =======================================================
// 路由处理
// =======================================================

async function handleHealth(path) {
  const dbStatus = _neonAvailable ? 'connected' : 'memory';
  return json({ status: 'ok', database: dbStatus, time: new Date().toISOString() });
}

async function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function handleLogin(request) {
  try {
    const body = await request.json();
    const { username, password } = body || {};
    if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);

    // Check memory users first
    const user = mem.users.find(u => u.username === username);
    if (!user) return json({ error: '账号不存在' }, 401);
    if (user.password !== password) return json({ error: '账号或密码错误' }, 401);

    const token = await createToken(user.id, user.role);
    return json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role, teacher_name: user.teacher_name || '', class_name: user.class_name || '' }
    });
  } catch (e) {
    return json({ error: '请求格式错误' }, 400);
  }
}

// ---- Classes ----
async function handleClassesGet() {
  return json({ classes: mem.classes });
}

async function handleClassCreate(request) {
  const body = await request.json();
  const newClass = { id: mem.classIdCounter++, class_name: body.class_name, homeroom_teacher: body.homeroom_teacher, student_count: body.student_count || 0 };
  mem.classes.push(newClass);
  return json({ class: newClass });
}

async function handleClassUpdate(request, id) {
  const body = await request.json();
  const cls = mem.classes.find(c => c.id === id);
  if (!cls) return json({ error: '班级不存在' }, 404);
  Object.assign(cls, body);
  return json({ class: cls });
}

async function handleClassDelete(id) {
  const idx = mem.classes.findIndex(c => c.id === id);
  if (idx === -1) return json({ error: '班级不存在' }, 404);
  mem.classes.splice(idx, 1);
  return json({ success: true });
}

// ---- Users ----
async function handleUsersGet() {
  return json({ users: mem.users.map(u => ({ id: u.id, username: u.username, role: u.role, teacher_name: u.teacher_name, class_name: u.class_name })) });
}

async function handleUserCreate(request) {
  const body = await request.json();
  if (!body.username || !body.password || !body.role) return json({ error: '缺少必填字段' }, 400);
  if (mem.users.find(u => u.username === body.username)) return json({ error: '账号已存在' }, 400);
  const newUser = {
    id: mem.userIdCounter++,
    username: body.username,
    password: body.password,
    role: body.role,
    teacher_name: body.teacher_name || '',
    class_name: body.class_name || ''
  };
  mem.users.push(newUser);
  return json({ user: { id: newUser.id, username: newUser.username, role: newUser.role, teacher_name: newUser.teacher_name, class_name: newUser.class_name } });
}

async function handleUserUpdate(request, id) {
  const body = await request.json();
  const user = mem.users.find(u => u.id === id);
  if (!user) return json({ error: '用户不存在' }, 404);
  if (body.username && body.username !== user.username && mem.users.find(u => u.username === body.username)) {
    return json({ error: '账号已存在' }, 400);
  }
  const updatable = ['username', 'password', 'role', 'teacher_name', 'class_name'];
  updatable.forEach(k => { if (body[k] !== undefined) user[k] = body[k]; });
  return json({ user: { id: user.id, username: user.username, role: user.role, teacher_name: user.teacher_name, class_name: user.class_name } });
}

async function handleUserDelete(id) {
  const idx = mem.users.findIndex(u => u.id === id);
  if (idx === -1) return json({ error: '用户不存在' }, 404);
  mem.users.splice(idx, 1);
  mem.selections = mem.selections.filter(s => s.student_id !== id);
  return json({ success: true });
}

// ---- Courses ----
async function handleCoursesGet() {
  return json({ courses: mem.courses });
}

async function handleCourseCreate(request) {
  const body = await request.json();
  const course = {
    id: mem.courseIdCounter++,
    course_name: body.course_name,
    teacher_name: body.teacher_name,
    location: body.location || '',
    capacity: body.capacity || 30,
    schedule: body.schedule || '',
    description: body.description || '',
    category: body.category || '拓展课',
    selected_count: 0,
    is_active: body.is_active !== false
  };
  mem.courses.push(course);
  return json({ course });
}

async function handleCourseUpdate(request, id) {
  const body = await request.json();
  const course = mem.courses.find(c => c.id === id);
  if (!course) return json({ error: '课程不存在' }, 404);
  const updatable = ['course_name', 'teacher_name', 'location', 'capacity', 'schedule', 'description', 'category', 'selected_count', 'is_active'];
  updatable.forEach(k => { if (body[k] !== undefined) course[k] = body[k]; });
  return json({ course });
}

async function handleCourseDelete(id) {
  const idx = mem.courses.findIndex(c => c.id === id);
  if (idx === -1) return json({ error: '课程不存在' }, 404);
  mem.courses.splice(idx, 1);
  mem.selections = mem.selections.filter(s => s.course_id !== id);
  return json({ success: true });
}

// ---- Selections ----
async function handleSelectionsGet() {
  return json({ selections: mem.selections });
}

async function handleStudentSelectionsGet(studentId) {
  return json({ selections: mem.selections.filter(s => s.student_id === studentId) });
}

async function handleSelectionCreate(request) {
  try {
    const body = await request.json();
    const { student_id, course_id } = body || {};
    if (!student_id || !course_id) return json({ error: '缺少参数' }, 400);
    const studentId = parseInt(student_id);
    const courseId = parseInt(course_id);
    if (isNaN(studentId) || isNaN(courseId)) return json({ error: '参数格式错误' }, 400);

    const course = mem.courses.find(c => c.id === courseId);
    if (!course) return json({ error: '课程不存在' }, 404);
    if (!course.is_active) return json({ error: '课程未开放' }, 400);
    const existing = mem.selections.find(s => s.student_id === studentId && s.course_id === courseId);
    if (existing) return json({ error: '已选该课程' }, 400);
    if (course.selected_count >= course.capacity) return json({ error: '课程已满' }, 400);

    const studentSelections = mem.selections.filter(s => s.student_id === studentId);
    if (studentSelections.length >= 3) return json({ error: '每人最多选3门课' }, 400);

    course.selected_count = (course.selected_count || 0) + 1;
    const selection = {
      id: mem.selectionIdCounter++,
      student_id: studentId,
      course_id: courseId,
      status: 'confirmed',
      selected_at: new Date().toISOString()
    };
    mem.selections.push(selection);
    return json({ selection });
  } catch (e) {
    return json({ error: '请求格式错误' }, 400);
  }
}

async function handleSelectionDelete(id, request) {
  const selection = mem.selections.find(s => s.id === id);
  if (!selection) return json({ error: '选课记录不存在' }, 404);
  mem.selections = mem.selections.filter(s => s.id !== id);
  const course = mem.courses.find(c => c.id === selection.course_id);
  if (course) course.selected_count = Math.max(0, (course.selected_count || 1) - 1);
  return json({ success: true });
}

// ---- Stats ----
async function handleStats() {
  const courses = mem.courses.length;
  const students = mem.users.filter(u => u.role === 'student').length;
  const teachers = mem.users.filter(u => u.role === 'teacher').length;
  const selections = mem.selections.length;
  const today = new Date().toISOString().slice(0, 10);
  const todaySelections = mem.selections.filter(s => (s.selected_at || '').slice(0, 10) === today).length;
  return json({ courses, students, teachers, selections, today_selections: todaySelections, classes: mem.classes.length });
}

// ---- Class Name by ID ----
async function handleClassName(id) {
  const cls = mem.classes.find(c => c.id === id);
  return json({ class_name: cls ? cls.class_name : '' });
}

// =======================================================
// 主路由
// =======================================================

export async function onRequest(context) {
  setEnv(context.env);

  // Ensure Neon is attempted (await to prevent race)
  if (!_neonLoadAttempted) {
    await tryLoadNeon().catch(() => {});
  }

  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }

  // /api/health
  if (path === '/api/health') {
    return handleHealth(path);
  }

  // /api/login
  if (path === '/api/login' && method === 'POST') {
    return handleLogin(request);
  }

  // ---- Classes ----
  if (path === '/api/classes') {
    if (method === 'GET') return handleClassesGet();
    if (method === 'POST') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleClassCreate(request);
    }
  }
  const classMatch = path.match(/^\/api\/classes\/(\d+)$/);
  if (classMatch) {
    const id = parseInt(classMatch[1]);
    if (method === 'PUT') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleClassUpdate(request, id);
    }
    if (method === 'DELETE') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleClassDelete(id);
    }
  }

  // ---- Users ----
  if (path === '/api/users') {
    if (method === 'GET') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleUsersGet();
    }
    if (method === 'POST') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleUserCreate(request);
    }
  }
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const id = parseInt(userMatch[1]);
    if (method === 'PUT') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleUserUpdate(request, id);
    }
    if (method === 'DELETE') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleUserDelete(id);
    }
  }

  // ---- Courses ----
  if (path === '/api/courses') {
    if (method === 'GET') return handleCoursesGet();
    if (method === 'POST') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleCourseCreate(request);
    }
  }
  const courseMatch = path.match(/^\/api\/courses\/(\d+)$/);
  if (courseMatch) {
    const id = parseInt(courseMatch[1]);
    if (method === 'PUT') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleCourseUpdate(request, id);
    }
    if (method === 'DELETE') {
      const auth = requireAuth(request, ['admin']);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return handleCourseDelete(id);
    }
  }

  // ---- Selections ----
  if (path === '/api/selections') {
    if (method === 'GET') return handleSelectionsGet();
    if (method === 'POST') return handleSelectionCreate(request);
  }
  const studentSelectionsMatch = path.match(/^\/api\/selections\/student\/(\d+)$/);
  if (studentSelectionsMatch && method === 'GET') {
    return handleStudentSelectionsGet(parseInt(studentSelectionsMatch[1]));
  }
  const selectionMatch = path.match(/^\/api\/selections\/(\d+)$/);
  if (selectionMatch && method === 'DELETE') {
    return handleSelectionDelete(parseInt(selectionMatch[1]), request);
  }

  // ---- Stats ----
  if (path === '/api/stats') {
    return handleStats();
  }

  // ---- Class Name ----
  const classNameMatch = path.match(/^\/api\/class-name\/(\d+)$/);
  if (classNameMatch && method === 'GET') {
    return handleClassName(parseInt(classNameMatch[1]));
  }

  return json({ error: 'API not found', path }, 404);
}
