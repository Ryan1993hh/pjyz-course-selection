// backend/routes/courses.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const db = require('../db');

// 内存存储上传文件
const upload = multer({ storage: multer.memoryStorage() });

// 字段别名映射（兼容多种表头写法）
const FIELD_ALIASES = {
  category:    ['课程类别', '类别', 'category', '课程分类'],
  name:         ['课程名称', '名称', '课程名', 'name'],
  description:  ['课程简介', '简介', '课程描述', 'description', '介绍'],
  teacher:      ['授课老师', '教师', '老师', 'teacher', '授课教师'],
  location:     ['授课地点', '地点', '教室', 'location'],
  requirement:  ['报名要求', '要求', '限制', 'requirement'],
  limit_grade6: ['六年级人数限制', '六年级名额', '六年级', 'limit_grade6'],
  limit_grade7: ['七年级人数限制', '七年级名额', '七年级', 'limit_grade7']
};

/**
 * 把表头映射成字段名
 */
function normalizeHeader(header) {
  const h = String(header || '').trim();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some(a => h === a || h.includes(a))) return field;
  }
  return null;
}

/**
 * 解析行数据为课程对象
 */
function rowToCourse(row, headerMap) {
  const course = {
    category: '体育健康类',
    name: '',
    description: '',
    teacher: '',
    location: '',
    requirement: '',
    limit_grade6: 0,
    limit_grade7: 0
  };
  Object.keys(row).forEach(key => {
    const field = headerMap[key];
    if (!field) return;
    const val = String(row[key] ?? '').toString().trim();
    if (field === 'limit_grade6' || field === 'limit_grade7') {
      const n = parseInt(val, 10);
      course[field] = isNaN(n) ? 0 : n;
    } else {
      course[field] = val;
    }
  });
  return course;
}

/**
 * 从工作表解析课程列表
 */
function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return [];
  // 建立表头映射
  const sample = rows[0];
  const headerMap = {};
  Object.keys(sample).forEach(h => {
    const f = normalizeHeader(h);
    if (f) headerMap[h] = f;
  });
  return rows.map(r => rowToCourse(r, headerMap)).filter(c => c.name);
}

/**
 * 从 docx 表格/段落解析课程
 * 支持表格形式：每行一门课程，列对应字段顺序
 */
async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value || '';
  // 按行分割
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const courses = [];
  // 尝试按制表符或多个空格分割成字段
  // 表头识别
  let headerFields = null;
  for (const line of lines) {
    const cells = line.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (!headerFields) {
      const mapped = cells.map(normalizeHeader);
      if (mapped.some(m => m)) {
        headerFields = mapped;
        continue;
      }
    } else {
      // 数据行
      const course = {
        category: '体育健康类',
        name: '',
        description: '',
        teacher: '',
        location: '',
        requirement: '',
        limit_grade6: 0,
        limit_grade7: 0
      };
      cells.forEach((val, i) => {
        const field = headerFields[i];
        if (!field) return;
        if (field === 'limit_grade6' || field === 'limit_grade7') {
          const n = parseInt(val, 10);
          course[field] = isNaN(n) ? 0 : n;
        } else {
          course[field] = val;
        }
      });
      if (course.name) courses.push(course);
    }
  }
  // 如果没识别到表头，尝试每行作为课程名
  if (courses.length === 0) {
    lines.forEach(line => {
      if (line.length > 0 && line.length < 50) {
        courses.push({
          category: '体育健康类',
          name: line,
          description: '',
          teacher: '',
          location: '',
          requirement: '',
          limit_grade6: 0,
          limit_grade7: 0
        });
      }
    });
  }
  return courses;
}

// GET /api/courses 获取所有课程
router.get('/courses', (req, res) => {
  const rows = db.prepare('SELECT * FROM courses ORDER BY id ASC').all();
  res.json(rows);
});

// POST /api/courses/upload 上传并解析文件
router.post('/courses/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未接收到文件' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const buffer = req.file.buffer;
  try {
    let courses = [];
    if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      courses = parseSheet(sheet);
    } else if (ext === '.docx') {
      courses = await parseDocx(buffer);
    } else {
      return res.status(400).json({ error: '不支持的文件格式，仅支持 xlsx、xls、docx' });
    }
    if (courses.length === 0) {
      return res.status(400).json({ error: '未能从文件中解析出课程数据，请检查文件内容与表头格式' });
    }
    res.json({ success: true, count: courses.length, courses });
  } catch (err) {
    console.error('[courses/upload] 解析失败:', err);
    res.status(500).json({ error: '文件解析失败：' + err.message });
  }
});

// PUT /api/courses 批量保存（覆盖）
router.put('/courses', (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: '请求数据格式错误，应为课程数组' });
  }
  const insert = db.prepare(`
    INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7)
    VALUES (@category, @name, @description, @teacher, @location, @requirement, @limit_grade6, @limit_grade7)
  `);
  const delAll = db.prepare('DELETE FROM courses');
  const tx = db.transaction((items) => {
    delAll.run();
    items.forEach(c => {
      insert.run({
        category: c.category || '体育健康类',
        name: c.name || '',
        description: c.description || '',
        teacher: c.teacher || '',
        location: c.location || '',
        requirement: c.requirement || '',
        limit_grade6: parseInt(c.limit_grade6, 10) || 0,
        limit_grade7: parseInt(c.limit_grade7, 10) || 0
      });
    });
  });
  try {
    tx(list);
    const rows = db.prepare('SELECT * FROM courses ORDER BY id ASC').all();
    res.json({ success: true, count: rows.length, courses: rows });
  } catch (err) {
    res.status(500).json({ error: '保存失败：' + err.message });
  }
});

// DELETE /api/courses/:id 删除单门课程
router.delete('/courses/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: '课程不存在' });
  }
  res.json({ success: true });
});

module.exports = router;
