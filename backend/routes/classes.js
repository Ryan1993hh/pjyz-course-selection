// backend/routes/classes.js
const express = require('express');
const router = express.Router();
const { query, queryOne, run, ensureDB } = require('../db');

// GET /api/classes 获取所有班级列表
router.get('/classes', async (req, res) => {
  try {
    await ensureDB();
    const rows = await query('SELECT * FROM classes ORDER BY grade ASC, class_name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/classes/simple 获取简单班级列表（仅年级+班级名+老师）
router.get('/classes/simple', async (req, res) => {
  try {
    await ensureDB();
    const rows = await query('SELECT id, grade, class_name, teacher_name FROM classes ORDER BY grade ASC, class_name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/grades 获取所有年级列表
router.get('/grades', async (req, res) => {
  try {
    await ensureDB();
    const rows = await query("SELECT DISTINCT grade FROM classes WHERE grade != '' ORDER BY grade ASC");
    res.json(rows.map(r => r.grade));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers 获取所有教师列表
router.get('/teachers', async (req, res) => {
  try {
    await ensureDB();
    // 从 users 表中获取教师角色的 teacher_name
    const users = await query("SELECT DISTINCT teacher_name FROM users WHERE role = 'teacher' AND teacher_name != '' ORDER BY teacher_name ASC");
    // 同时从 classes 表中获取 teacher_name
    const classes = await query("SELECT DISTINCT teacher_name FROM classes WHERE teacher_name != '' ORDER BY teacher_name ASC");
    const set = new Set();
    users.forEach(r => set.add(r.teacher_name));
    classes.forEach(r => set.add(r.teacher_name));
    res.json(Array.from(set));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/classes 添加班级
router.post('/classes', async (req, res) => {
  const { grade, class_name, teacher_name } = req.body || {};
  if (!grade || !class_name) {
    return res.status(400).json({ error: '年级和班级名称不能为空' });
  }
  try {
    await ensureDB();
    // 检查是否已存在相同的年级+班级
    const existing = await queryOne(
      'SELECT id FROM classes WHERE grade = $1 AND class_name = $2',
      [grade, class_name]
    );
    if (existing) {
      return res.status(400).json({ error: '该年级的该班级已存在' });
    }
    const info = await run(
      'INSERT INTO classes (grade, class_name, teacher_name) VALUES ($1, $2, $3)',
      [grade, class_name, teacher_name || '']
    );
    const item = await queryOne('SELECT * FROM classes WHERE id = $1', [info.lastInsertRowid]);
    res.json({ success: true, class: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/classes/:id 修改班级
router.put('/classes/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { grade, class_name, teacher_name } = req.body || {};
  try {
    await ensureDB();
    const current = await queryOne('SELECT * FROM classes WHERE id = $1', [id]);
    if (!current) {
      return res.status(404).json({ error: '班级不存在' });
    }
    await run(
      'UPDATE classes SET grade = $1, class_name = $2, teacher_name = $3 WHERE id = $4',
      [grade || current.grade, class_name || current.class_name, teacher_name || '', id]
    );
    const item = await queryOne('SELECT * FROM classes WHERE id = $1', [id]);
    res.json({ success: true, class: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/classes/:id 删除班级
router.delete('/classes/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await ensureDB();
    const current = await queryOne('SELECT * FROM classes WHERE id = $1', [id]);
    if (!current) {
      return res.status(404).json({ error: '班级不存在' });
    }
    await run('DELETE FROM classes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/classes 批量删除班级
router.post('/classes/batch-delete', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: '请求格式错误' });
  }
  try {
    await ensureDB();
    for (const id of ids) {
      await run('DELETE FROM classes WHERE id = $1', [id]);
    }
    res.json({ success: true, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
