// backend/routes/courses.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { query, run, transaction, ensureDB, pool } = require('../db');

const upload = multer({ storage: multer.memoryStorage() });

// 内存存储（无DB时使用）
let MEM_COURSES = [];
let MEM_ID = 1;

function normalizeHeader(header) {
  const h = String(header || '').trim();
  if (/^序号$/.test(h)) return null;
  if (/类别|课程类别|分类/.test(h)) return 'category';
  if (/课程名称|课程名/.test(h)) return 'name';
  if (h === '课程') return 'name';
  if (/简介|描述|课程简介/.test(h)) return 'description';
  if (/授课老师|任课老师|教师|老师/.test(h)) return 'teacher';
  if (/授课地点|教室|地点|位置/.test(h)) return 'location';
  if (/六年级人数限制|六年级.*名额|六年级.*人数/.test(h)) return 'limit_grade6';
  if (/七年级人数限制|七年级.*名额|七年级.*人数/.test(h)) return 'limit_grade7';
  if (/报名要求/.test(h) || h === '要求' || h === '备注') return 'requirement';
  if (/名称|课名/.test(h)) return 'name';
  if (h === '六年级') return 'limit_grade6';
  if (h === '七年级') return 'limit_grade7';
  return null;
}

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

function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return [];
  const sample = rows[0];
  const headerMap = {};
  Object.keys(sample).forEach(h => {
    const f = normalizeHeader(h);
    if (f) headerMap[h] = f;
  });
  return rows.map(r => rowToCourse(r, headerMap)).filter(c => c.name);
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const courses = [];
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

router.get('/courses', async (req, res) => {
  try {
    if (pool) {
      await ensureDB();
      const rows = await query('SELECT * FROM courses ORDER BY id ASC');
      return res.json(rows);
    }
    res.json(MEM_COURSES);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.put('/courses', async (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: '请求数据格式错误，应为课程数组' });
  }
  try {
    if (pool) {
      await ensureDB();
      await transaction(async (client) => {
        await client.query('DELETE FROM courses');
        for (const c of list) {
          await client.query(
            `INSERT INTO courses (category, name, description, teacher, location, requirement, limit_grade6, limit_grade7)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              c.category || '体育健康类',
              c.name || '',
              c.description || '',
              c.teacher || '',
              c.location || '',
              c.requirement || '',
              parseInt(c.limit_grade6, 10) || 0,
              parseInt(c.limit_grade7, 10) || 0
            ]
          );
        }
      });
      const rows = await query('SELECT * FROM courses ORDER BY id ASC');
      return res.json({ success: true, count: rows.length, courses: rows });
    }
    MEM_COURSES = list.map(c => ({
      id: MEM_ID++,
      category: c.category || '体育健康类',
      name: c.name || '',
      description: c.description || '',
      teacher: c.teacher || '',
      location: c.location || '',
      requirement: c.requirement || '',
      limit_grade6: parseInt(c.limit_grade6, 10) || 0,
      limit_grade7: parseInt(c.limit_grade7, 10) || 0
    }));
    res.json({ success: true, count: MEM_COURSES.length, courses: MEM_COURSES });
  } catch (err) {
    res.status(500).json({ error: '保存失败：' + err.message });
  }
});

router.delete('/courses/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    if (pool) {
      const result = await run('DELETE FROM courses WHERE id = $1', [id]);
      if (result.changes === 0) {
        return res.status(404).json({ error: '课程不存在' });
      }
      return res.json({ success: true });
    }
    const idx = MEM_COURSES.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: '课程不存在' });
    MEM_COURSES.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
