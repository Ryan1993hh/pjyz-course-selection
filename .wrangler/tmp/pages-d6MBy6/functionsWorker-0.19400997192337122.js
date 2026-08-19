var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/[[path]].js
var INIT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    teacher_name TEXT DEFAULT '',
    class_name TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT DEFAULT '\u4F53\u80B2\u5065\u5EB7\u7C7B',
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
  `CREATE INDEX IF NOT EXISTS idx_selections_course ON selections(course_name)`
];
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}
__name(json, "json");
async function createToken(userId, role) {
  const expiry = Date.now() + 8 * 60 * 60 * 1e3;
  const payload = `${userId}:${role}:${expiry}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${btoa(payload)}.${hashHex.substring(0, 16)}`;
}
__name(createToken, "createToken");
function verifyToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const decoded = atob(parts[0]);
    const [userId, role, expiry] = decoded.split(":");
    if (Date.now() > parseInt(expiry)) return null;
    return { userId: parseInt(userId), role };
  } catch (e) {
    return null;
  }
}
__name(verifyToken, "verifyToken");
function getAuthUser(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7));
}
__name(getAuthUser, "getAuthUser");
function requireAuth(request, allowedRoles) {
  const user = getAuthUser(request);
  if (!user) return { error: "\u672A\u767B\u5F55\u6216Token\u5DF2\u8FC7\u671F", status: 401 };
  if (allowedRoles.length && !allowedRoles.includes(user.role)) return { error: "\u6743\u9650\u4E0D\u8DB3", status: 403 };
  return { user };
}
__name(requireAuth, "requireAuth");
async function handleHealth(db) {
  try {
    const result = await db.prepare("SELECT COUNT(*) as count FROM users").first();
    return json({ status: "ok", database: "D1", users: result.count, time: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (e) {
    return json({ status: "error", message: e.message }, 500);
  }
}
__name(handleHealth, "handleHealth");
async function handleLogin(db, request) {
  try {
    const body = await request.json();
    const { username, password } = body || {};
    if (!username || !password) return json({ error: "\u7528\u6237\u540D\u548C\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" }, 400);
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    if (!user) return json({ error: "\u8D26\u53F7\u4E0D\u5B58\u5728" }, 401);
    if (user.password !== password) return json({ error: "\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF" }, 401);
    const token = await createToken(user.id, user.role);
    return json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role, teacher_name: user.teacher_name || "", class_name: user.class_name || "" }
    });
  } catch (e) {
    return json({ error: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF" }, 400);
  }
}
__name(handleLogin, "handleLogin");
async function handleCoursesGet(db) {
  const results = await db.prepare("SELECT * FROM courses").all();
  const courses = results.results.map((c) => ({
    id: c.id,
    category: c.category || "",
    name: c.name || "",
    description: c.description || "",
    teacher: c.teacher || "",
    location: c.location || "",
    requirement: c.requirement || "",
    limit_grade6: c.limit_grade6 || 0,
    limit_grade7: c.limit_grade7 || 0,
    selected_count: c.selected_count || 0,
    is_active: c.is_active !== 0
  }));
  return json({ courses });
}
__name(handleCoursesGet, "handleCoursesGet");
async function handleCoursesBatchSave(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json();
    const arr = Array.isArray(body) ? body : body.courses || [];
    await db.prepare("DELETE FROM courses").run();
    for (const c of arr) {
      const id = c.id !== void 0 && c.id !== null ? c.id : null;
      if (id) {
        await db.prepare(`INSERT INTO courses (id, category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          id,
          c.category || "\u4F53\u80B2\u5065\u5EB7\u7C7B",
          c.name || "",
          c.description || "",
          c.teacher || "",
          c.location || "",
          c.requirement || "",
          parseInt(c.limit_grade6, 10) || 0,
          parseInt(c.limit_grade7, 10) || 0,
          c.selected_count || 0,
          c.is_active !== false ? 1 : 0
        ).run();
      } else {
        await db.prepare(`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          c.category || "\u4F53\u80B2\u5065\u5EB7\u7C7B",
          c.name || "",
          c.description || "",
          c.teacher || "",
          c.location || "",
          c.requirement || "",
          parseInt(c.limit_grade6, 10) || 0,
          parseInt(c.limit_grade7, 10) || 0,
          c.selected_count || 0,
          c.is_active !== false ? 1 : 0
        ).run();
      }
    }
    const results = await db.prepare("SELECT * FROM courses").all();
    return json({ success: true, count: results.results.length, courses: results.results });
  } catch (e) {
    return json({ error: "\u4FDD\u5B58\u5931\u8D25\uFF1A" + e.message }, 400);
  }
}
__name(handleCoursesBatchSave, "handleCoursesBatchSave");
async function handleCourseCreate(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const result = await db.prepare(`INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7, selected_count, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    body.category || "\u4F53\u80B2\u5065\u5EB7\u7C7B",
    body.name || "",
    body.description || "",
    body.teacher || "",
    body.location || "",
    body.requirement || "",
    parseInt(body.limit_grade6, 10) || 0,
    parseInt(body.limit_grade7, 10) || 0,
    0,
    body.is_active !== false ? 1 : 0
  ).run();
  const course = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(result.lastRowId).first();
  return json({ course });
}
__name(handleCourseCreate, "handleCourseCreate");
async function handleCourseUpdate(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u8BFE\u7A0B\u4E0D\u5B58\u5728" }, 404);
  await db.prepare(`UPDATE courses SET category=?, name=?, description=?, teacher=?, location=?, requirement=?, limit_grade6=?, limit_grade7=?, selected_count=?, is_active=? WHERE id=?`).bind(
    body.category !== void 0 ? body.category : existing.category,
    body.name !== void 0 ? body.name : existing.name,
    body.description !== void 0 ? body.description : existing.description,
    body.teacher !== void 0 ? body.teacher : existing.teacher,
    body.location !== void 0 ? body.location : existing.location,
    body.requirement !== void 0 ? body.requirement : existing.requirement,
    body.limit_grade6 !== void 0 ? body.limit_grade6 : existing.limit_grade6,
    body.limit_grade7 !== void 0 ? body.limit_grade7 : existing.limit_grade7,
    body.selected_count !== void 0 ? body.selected_count : existing.selected_count,
    body.is_active !== void 0 ? body.is_active ? 1 : 0 : existing.is_active,
    id
  ).run();
  const course = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
  return json({ course });
}
__name(handleCourseUpdate, "handleCourseUpdate");
async function handleCourseDelete(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u8BFE\u7A0B\u4E0D\u5B58\u5728" }, 404);
  await db.prepare("DELETE FROM courses WHERE id = ?").bind(id).run();
  await db.prepare("DELETE FROM selections WHERE course_id = ?").bind(id).run();
  return json({ success: true });
}
__name(handleCourseDelete, "handleCourseDelete");
async function handleCourseUpload(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return json({ error: "\u7F3A\u5C11\u4E0A\u4F20\u6587\u4EF6" }, 400);
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return json({ error: "\u6587\u4EF6\u5185\u5BB9\u4E3A\u7A7A\u6216\u683C\u5F0F\u4E0D\u6B63\u786E" }, 400);
    const headers = parseCSVLine(lines[0]);
    const colMap = mapCSVHeaders(headers);
    const courses = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      courses.push({
        category: row[colMap.category] || "\u4F53\u80B2\u5065\u5EB7\u7C7B",
        name: row[colMap.name] || "",
        description: row[colMap.description] || "",
        teacher: row[colMap.teacher] || "",
        location: row[colMap.location] || "",
        requirement: row[colMap.requirement] || "",
        limit_grade6: parseInt(row[colMap.limit_grade6], 10) || 0,
        limit_grade7: parseInt(row[colMap.limit_grade7], 10) || 0,
        selected_count: 0,
        is_active: true
      });
    }
    return json({ success: true, count: courses.length, courses });
  } catch (e) {
    return json({ error: "\u89E3\u6790\u5931\u8D25\uFF1A" + e.message }, 400);
  }
}
__name(handleCourseUpload, "handleCourseUpload");
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        result.push(current);
        current = "";
      } else current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}
__name(parseCSVLine, "parseCSVLine");
function mapCSVHeaders(headers) {
  const map = { category: -1, name: -1, description: -1, teacher: -1, location: -1, requirement: -1, limit_grade6: -1, limit_grade7: -1 };
  headers.forEach((h, i) => {
    const trimmed = h.replace(/^\uFEFF/, "").trim();
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
__name(mapCSVHeaders, "mapCSVHeaders");
async function handleSelectionsGet(db, request, url) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const grade = url.searchParams.get("grade");
  const cls = url.searchParams.get("class");
  const course = url.searchParams.get("course");
  let sql = "SELECT * FROM selections WHERE 1=1";
  const params = [];
  if (grade) {
    sql += " AND grade = ?";
    params.push(grade);
  }
  if (cls) {
    sql += " AND class_name = ?";
    params.push(cls);
  }
  if (course) {
    const courseNum = parseInt(course);
    if (!isNaN(courseNum)) {
      sql += " AND course_id = ?";
      params.push(courseNum);
    } else {
      sql += " AND course_name = ?";
      params.push(course);
    }
  }
  sql += " ORDER BY id ASC";
  const results = await db.prepare(sql).bind(...params).all();
  return json({ selections: results.results });
}
__name(handleSelectionsGet, "handleSelectionsGet");
async function handleSelectionsBatchCreate(db, request) {
  try {
    const text = await request.text();
    const body = JSON.parse(text);
    const arr = Array.isArray(body) ? body : [body];
    if (arr.length === 0) return json({ error: "\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u9009\u8BFE\u6570\u636E" }, 400);
    const results = [];
    const errors = [];
    for (const item of arr) {
      if (!item || !item.student_name) {
        errors.push(`\u7F3A\u5C11\u5B66\u751F\u59D3\u540D`);
        continue;
      }
      try {
        const grade = item.grade != null && item.grade !== "" ? String(item.grade) : "";
        const className = item.class_name != null && item.class_name !== "" ? String(item.class_name) : "";
        const studentName = item.student_name != null && item.student_name !== "" ? String(item.student_name) : "";
        const courseName = item.course_name != null && item.course_name !== "" ? String(item.course_name) : "";
        const result = await db.prepare(
          "INSERT INTO selections (grade, class_name, student_name, course_name, selected_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(grade, className, studentName, courseName, (/* @__PURE__ */ new Date()).toISOString()).run();
        const courseId = item.course_id != null && item.course_id !== "" ? parseInt(item.course_id, 10) || 0 : 0;
        if (courseId > 0) {
          await db.prepare("UPDATE courses SET selected_count = selected_count + 1 WHERE id = ?").bind(courseId).run();
        }
        const selection = await db.prepare("SELECT * FROM selections WHERE id = ?").bind(result.lastRowId).first();
        results.push(selection);
      } catch (innerErr) {
        errors.push("\u63D2\u5165\u5931\u8D25: " + innerErr.message);
      }
    }
    const countResult = await db.prepare("SELECT COUNT(*) as count FROM selections").first();
    return json({
      success: true,
      count: results.length,
      total: countResult.count,
      selections: results,
      errors: errors.length > 0 ? errors : void 0
    });
  } catch (e) {
    return json({ error: "\u4FDD\u5B58\u5931\u8D25\uFF1A" + e.message }, 400);
  }
}
__name(handleSelectionsBatchCreate, "handleSelectionsBatchCreate");
async function handleSelectionUpdate(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare("SELECT * FROM selections WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u9009\u8BFE\u8BB0\u5F55\u4E0D\u5B58\u5728" }, 404);
  if (body.course_id) {
    const newCourseId = parseInt(body.course_id);
    if (existing.course_id) {
      await db.prepare("UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?").bind(existing.course_id).run();
    }
    await db.prepare("UPDATE courses SET selected_count = selected_count + 1 WHERE id = ?").bind(newCourseId).run();
    const course = await db.prepare("SELECT * FROM courses WHERE id = ?").bind(newCourseId).first();
    const newCourseName = body.course_name || (course ? course.name : existing.course_name);
    await db.prepare("UPDATE selections SET course_id = ?, course_name = ? WHERE id = ?").bind(newCourseId, newCourseName, id).run();
  }
  const selection = await db.prepare("SELECT * FROM selections WHERE id = ?").bind(id).first();
  return json({ selection });
}
__name(handleSelectionUpdate, "handleSelectionUpdate");
async function handleSelectionDelete(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare("SELECT * FROM selections WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u9009\u8BFE\u8BB0\u5F55\u4E0D\u5B58\u5728" }, 404);
  if (existing.course_id) {
    await db.prepare("UPDATE courses SET selected_count = MAX(0, selected_count - 1) WHERE id = ?").bind(existing.course_id).run();
  }
  await db.prepare("DELETE FROM selections WHERE id = ?").bind(id).run();
  return json({ success: true });
}
__name(handleSelectionDelete, "handleSelectionDelete");
async function handleSelectionsExport(db, request, url) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const grade = url.searchParams.get("grade");
  const cls = url.searchParams.get("class");
  const course = url.searchParams.get("course");
  let sql = "SELECT * FROM selections WHERE 1=1";
  const params = [];
  if (grade) {
    sql += " AND grade = ?";
    params.push(grade);
  }
  if (cls) {
    sql += " AND class_name = ?";
    params.push(cls);
  }
  if (course) {
    const courseNum = parseInt(course);
    if (!isNaN(courseNum)) {
      sql += " AND course_id = ?";
      params.push(courseNum);
    } else {
      sql += " AND course_name = ?";
      params.push(course);
    }
  }
  const results = await db.prepare(sql).bind(...params).all();
  const list = results.results;
  const headers = ["\u73ED\u7EA7", "\u59D3\u540D", "\u9009\u8BFE\u540D\u79F0"];
  const rows = list.map((s) => {
    let className = s.class_name || "";
    if (s.grade && className && className.indexOf(s.grade) === -1) {
      className = s.grade + className;
    } else if (s.grade && !className) {
      className = s.grade;
    }
    return [className, s.student_name || "", s.course_name || ""];
  });
  const csv = [headers, ...rows].map((row) => row.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  return new Response(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="selections.csv"',
      ...corsHeaders()
    }
  });
}
__name(handleSelectionsExport, "handleSelectionsExport");
async function handleClearSelections(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  await db.prepare("DELETE FROM selections").run();
  await db.prepare("UPDATE courses SET selected_count = 0").run();
  return json({ success: true });
}
__name(handleClearSelections, "handleClearSelections");
async function handleClassesGet(db) {
  const results = await db.prepare("SELECT * FROM classes ORDER BY grade, class_name").all();
  return json(results.results);
}
__name(handleClassesGet, "handleClassesGet");
async function handleClassCreate(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  if (!body.grade || !body.class_name) return json({ error: "\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5\uFF08\u5E74\u7EA7/\u73ED\u7EA7\u540D\u79F0\uFF09" }, 400);
  let sc = 0;
  if (body.student_count !== null && body.student_count !== void 0 && body.student_count !== "") {
    const n = parseInt(body.student_count, 10);
    if (!isNaN(n) && n >= 0) sc = n;
  }
  const result = await db.prepare(`INSERT INTO classes (grade, class_name, teacher_name, student_count)
    VALUES (?, ?, ?, ?)`).bind(
    body.grade,
    body.class_name,
    body.teacher_name || "",
    sc
  ).run();
  const cls = await db.prepare("SELECT * FROM classes WHERE id = ?").bind(result.lastRowId).first();
  return json({ class: cls });
}
__name(handleClassCreate, "handleClassCreate");
async function handleClassUpdate(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare("SELECT * FROM classes WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u73ED\u7EA7\u4E0D\u5B58\u5728" }, 404);
  let studentCount = existing.student_count;
  if (body.student_count !== void 0) {
    if (body.student_count === null || body.student_count === "") {
      studentCount = 0;
    } else {
      const n = parseInt(body.student_count, 10);
      studentCount = isNaN(n) ? 0 : Math.max(0, n);
    }
  }
  await db.prepare(`UPDATE classes SET grade=?, class_name=?, teacher_name=?, student_count=? WHERE id=?`).bind(
    body.grade || existing.grade,
    body.class_name || existing.class_name,
    body.teacher_name !== void 0 ? body.teacher_name : existing.teacher_name,
    studentCount,
    id
  ).run();
  const cls = await db.prepare("SELECT * FROM classes WHERE id = ?").bind(id).first();
  return json({ class: cls });
}
__name(handleClassUpdate, "handleClassUpdate");
async function handleClassDelete(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare("SELECT * FROM classes WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u73ED\u7EA7\u4E0D\u5B58\u5728" }, 404);
  await db.prepare("DELETE FROM classes WHERE id = ?").bind(id).run();
  return json({ success: true });
}
__name(handleClassDelete, "handleClassDelete");
async function handleTeachersGet(db) {
  const results = await db.prepare("SELECT id, username, teacher_name FROM users WHERE role = ?").bind("teacher").all();
  return json(results.results);
}
__name(handleTeachersGet, "handleTeachersGet");
async function handleUsersImport(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  try {
    const body = await request.json();
    const users = body.users || [];
    let imported = 0, failed = 0;
    const errors = [];
    for (const u of users) {
      if (!u.username || !u.password) {
        failed++;
        errors.push(`\u7528\u6237 ${u.username} \u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5`);
        continue;
      }
      const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(u.username).first();
      if (existing) {
        failed++;
        errors.push(`\u8D26\u53F7 ${u.username} \u5DF2\u5B58\u5728`);
        continue;
      }
      const roleRaw = (u.role || "teacher").toLowerCase();
      const role = roleRaw === "admin" || roleRaw === "teacher" ? roleRaw : "teacher";
      await db.prepare(`INSERT INTO users (username, password, role, teacher_name, class_name)
        VALUES (?, ?, ?, ?, ?)`).bind(
        u.username,
        u.password,
        role,
        u.teacher_name || "",
        u.class_name || ""
      ).run();
      imported++;
    }
    return json({ success: true, imported, failed, errors });
  } catch (e) {
    return json({ error: "\u5BFC\u5165\u5931\u8D25\uFF1A" + e.message }, 400);
  }
}
__name(handleUsersImport, "handleUsersImport");
async function handleUsersGet(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const results = await db.prepare('SELECT * FROM users ORDER BY CASE role WHEN "admin" THEN 0 WHEN "teacher" THEN 1 ELSE 2 END, username').all();
  return json({ users: results.results });
}
__name(handleUsersGet, "handleUsersGet");
async function handleUserCreate(db, request) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  if (!body.username || !body.password || !body.role) return json({ error: "\u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5" }, 400);
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(body.username).first();
  if (existing) return json({ error: "\u8D26\u53F7\u5DF2\u5B58\u5728" }, 400);
  const result = await db.prepare(`INSERT INTO users (username, password, role, teacher_name, class_name)
    VALUES (?, ?, ?, ?, ?)`).bind(
    body.username,
    body.password,
    body.role,
    body.teacher_name || "",
    body.class_name || ""
  ).run();
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(result.lastRowId).first();
  return json({ success: true, user });
}
__name(handleUserCreate, "handleUserCreate");
async function handleUserUpdate(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const body = await request.json();
  const existing = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u7528\u6237\u4E0D\u5B58\u5728" }, 404);
  if (body.username && body.username !== existing.username) {
    const duplicate = await db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").bind(body.username, id).first();
    if (duplicate) return json({ error: "\u8D26\u53F7\u5DF2\u5B58\u5728" }, 400);
  }
  let password = existing.password;
  if (body.password && String(body.password).trim() !== "") {
    password = body.password;
  }
  await db.prepare(`UPDATE users SET username=?, password=?, role=?, teacher_name=?, class_name=? WHERE id=?`).bind(
    body.username || existing.username,
    password,
    body.role || existing.role,
    body.teacher_name !== void 0 ? body.teacher_name : existing.teacher_name,
    body.class_name !== void 0 ? body.class_name : existing.class_name,
    id
  ).run();
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return json({ success: true, user });
}
__name(handleUserUpdate, "handleUserUpdate");
async function handleUserDelete(db, request, id) {
  const auth = requireAuth(request, ["admin"]);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const existing = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "\u7528\u6237\u4E0D\u5B58\u5728" }, 404);
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return json({ success: true });
}
__name(handleUserDelete, "handleUserDelete");
async function handleStats(db) {
  const userCount = await db.prepare("SELECT COUNT(*) as count FROM users").first();
  const courseCount = await db.prepare("SELECT COUNT(*) as count FROM courses").first();
  const selectionCount = await db.prepare("SELECT COUNT(*) as count FROM selections").first();
  const classCount = await db.prepare("SELECT COUNT(*) as count FROM classes").first();
  return json({
    courses: courseCount.count,
    users: userCount.count,
    selections: selectionCount.count,
    classes: classCount.count
  });
}
__name(handleStats, "handleStats");
async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = context.env.DB;
  try {
    for (const sql of INIT_STATEMENTS) {
      await db.prepare(sql).run();
    }
    const adminCheck = await db.prepare("SELECT COUNT(*) as count FROM users WHERE username = ?").bind("admin").first();
    if (adminCheck.count === 0) {
      await db.prepare(`INSERT INTO users (username, password, role, teacher_name, class_name)
        VALUES (?, ?, ?, ?, ?)`).bind("admin", "123456", "admin", "", "").run();
    }
  } catch (e) {
    console.error("DB init error:", e);
  }
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (path === "/api/health") {
    return handleHealth(db);
  }
  if (path === "/api/login" && method === "POST") {
    return handleLogin(db, request);
  }
  if (path === "/api/courses/upload" && method === "POST") {
    return handleCourseUpload(db, request);
  }
  if (path === "/api/courses") {
    if (method === "GET") return handleCoursesGet(db);
    if (method === "PUT") return handleCoursesBatchSave(db, request);
    if (method === "POST") return handleCourseCreate(db, request);
  }
  const courseMatch = path.match(/^\/api\/courses\/(\d+)$/);
  if (courseMatch) {
    const id = parseInt(courseMatch[1]);
    if (method === "PUT") return handleCourseUpdate(db, request, id);
    if (method === "DELETE") return handleCourseDelete(db, request, id);
  }
  if (path === "/api/selections") {
    if (method === "GET") return handleSelectionsGet(db, request, url);
    if (method === "POST") return handleSelectionsBatchCreate(db, request);
    if (method === "DELETE") return handleClearSelections(db, request);
  }
  if (path === "/api/selections/export" && method === "GET") {
    return handleSelectionsExport(db, request, url);
  }
  const selectionMatch = path.match(/^\/api\/selections\/(\d+)$/);
  if (selectionMatch) {
    const id = parseInt(selectionMatch[1]);
    if (method === "PUT") return handleSelectionUpdate(db, request, id);
    if (method === "DELETE") return handleSelectionDelete(db, request, id);
  }
  if (path === "/api/classes") {
    if (method === "GET") return handleClassesGet(db);
    if (method === "POST") return handleClassCreate(db, request);
  }
  const classMatch = path.match(/^\/api\/classes\/(\d+)$/);
  if (classMatch) {
    const id = parseInt(classMatch[1]);
    if (method === "PUT") return handleClassUpdate(db, request, id);
    if (method === "DELETE") return handleClassDelete(db, request, id);
  }
  if (path === "/api/teachers" && method === "GET") {
    return handleTeachersGet(db);
  }
  if (path === "/api/users/import" && method === "POST") {
    return handleUsersImport(db, request);
  }
  if (path === "/api/users") {
    if (method === "GET") return handleUsersGet(db, request);
    if (method === "POST") return handleUserCreate(db, request);
  }
  const userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    const id = parseInt(userMatch[1]);
    if (method === "PUT") return handleUserUpdate(db, request, id);
    if (method === "DELETE") return handleUserDelete(db, request, id);
  }
  if (path === "/api/stats") {
    return handleStats(db);
  }
  return json({ error: "API not found", path }, 404);
}
__name(onRequest, "onRequest");

// ../.wrangler/tmp/pages-d6MBy6/functionsRoutes-0.6455823849555573.mjs
var routes = [
  {
    routePath: "/api/:path*",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];

// C:/Users/admin/AppData/Roaming/npm/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// C:/Users/admin/AppData/Roaming/npm/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
