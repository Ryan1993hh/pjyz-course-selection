// backend/routes/users.js
const express = require('express');
const router = express.Router();
const { query, queryOne, run, ensureDB } = require('../db');

// GET /api/users 获取用户列表
router.get('/users', async (req, res) => {
  try {
    await ensureDB();
    const rows = await query('SELECT * FROM users ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users 添加用户
router.post('/users', async (req, res) => {
  const { username, password, role, teacher_name, class_name } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    await ensureDB();
    const existing = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (existing) {
      return res.status(400).json({ error: '账号已存在' });
    }
    const info = await run(
      'INSERT INTO users (username, password, role, teacher_name, class_name) VALUES ($1, $2, $3, $4, $5)',
      [username, password, role || 'teacher', teacher_name || '', class_name || '']
    );
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [info.lastInsertRowid]);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: '添加失败：' + err.message });
  }
});

// PUT /api/users/:id 修改用户
router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, password, role, teacher_name, class_name } = req.body || {};
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    await ensureDB();
    const current = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!current) {
      return res.status(404).json({ error: '用户不存在' });
    }
    // 检查账号唯一
    if (username && username !== current.username) {
      const dup = await queryOne('SELECT id FROM users WHERE username = $1 AND id != $2', [username, id]);
      if (dup) {
        return res.status(400).json({ error: '账号已存在' });
      }
    }
    await run(
      'UPDATE users SET username = $1, password = $2, role = $3, teacher_name = $4, class_name = $5 WHERE id = $6',
      [username || current.username, password || current.password, role || current.role,
       teacher_name !== undefined ? teacher_name : (current.teacher_name || ''),
       class_name !== undefined ? class_name : (current.class_name || ''),
       id]
    );
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id 删除用户
router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await ensureDB();
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (user.username === 'admin') {
      return res.status(400).json({ error: '默认管理员账号不可删除' });
    }
    await run('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/import 批量导入用户
router.post('/users/import', async (req, res) => {
  const { users } = req.body || {};
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: '请求格式错误' });
  }
  const imported = [];
  const failed = [];
  const errors = [];
  try {
    await ensureDB();
    for (const u of users) {
      try {
        const existing = await queryOne('SELECT id FROM users WHERE username = $1', [u.username]);
        if (existing) {
          // 已存在则更新
          await run(
            'UPDATE users SET password = $1, role = $2, teacher_name = $3 WHERE id = $4',
            [u.password || existing.password, u.role || existing.role, u.teacher_name || '', existing.id]
          );
        } else {
          await run(
            'INSERT INTO users (username, password, role, teacher_name) VALUES ($1, $2, $3, $4)',
            [u.username, u.password, u.role || 'teacher', u.teacher_name || '']
          );
          imported.push(u.username);
        }
      } catch (err) {
        failed.push(u.username);
        errors.push(`${u.username}: ${err.message}`);
      }
    }
    res.json({ success: true, imported: imported.length, failed: failed.length, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
