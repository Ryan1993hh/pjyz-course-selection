// backend/routes/selections.js
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { query, queryOne, run, ensureDB } = require('../db');

// POST /api/selections 上传选课结果并返回 Excel
router.post('/selections', async (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: '请求数据格式错误，应为选课数组' });
  }
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  try {
    await ensureDB();
    for (const s of list) {
      await run(
        'INSERT INTO selections (grade, class_name, student_name, course_id, course_name, upload_time) VALUES ($1, $2, $3, $4, $5, $6)',
        [
          s.grade || '',
          s.class_name || '',
          s.student_name || '',
          parseInt(s.course_id, 10) || null,
          s.course_name || '',
          now
        ]
      );
    }

    // 生成 Excel 文件返回
    const data = list.map((s, i) => ({
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

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = encodeURIComponent('选课结果_' + Date.now() + '.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: '保存失败：' + err.message });
  }
});

// GET /api/selections 按条件查询
router.get('/selections', async (req, res) => {
  const { grade, class: className, course } = req.query;
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  if (grade && grade !== '全部') {
    sql += ' AND grade = $' + (params.length + 1);
    params.push(grade);
  }
  if (className && className !== '全部') {
    sql += ' AND class_name = $' + (params.length + 1);
    params.push(className);
  }
  if (course && course !== '全部') {
    sql += ' AND course_name = $' + (params.length + 1);
    params.push(course);
  }
  sql += ' ORDER BY id DESC';
  try {
    await ensureDB();
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/selections/:id 修改选课记录（换课）
router.put('/selections/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { course_id, course_name } = req.body || {};
  if (!course_id || !course_name) {
    return res.status(400).json({ error: '缺少课程信息' });
  }
  try {
    await ensureDB();
    const info = await run(
      'UPDATE selections SET course_id = $1, course_name = $2 WHERE id = $3',
      [parseInt(course_id, 10), course_name, id]
    );
    if (info.changes === 0) {
      return res.status(404).json({ error: '选课记录不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/selections/export 导出 Excel
router.get('/selections/export', async (req, res) => {
  const { grade, class: className, course } = req.query;
  let sql = 'SELECT * FROM selections WHERE 1=1';
  const params = [];
  if (grade && grade !== '全部') {
    sql += ' AND grade = $' + (params.length + 1);
    params.push(grade);
  }
  if (className && className !== '全部') {
    sql += ' AND class_name = $' + (params.length + 1);
    params.push(className);
  }
  if (course && course !== '全部') {
    sql += ' AND course_name = $' + (params.length + 1);
    params.push(course);
  }
  sql += ' ORDER BY id DESC';
  try {
    await ensureDB();
    const rows = await query(sql, params);

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
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = encodeURIComponent('选课结果导出_' + Date.now() + '.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
