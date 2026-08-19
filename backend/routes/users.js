// backend/routes/users.js
const express = require('express');
const router = express.Router();
const { query, queryOne, run } = require('../db');

// GET /api/users 获取用户列表
router.get('/users', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM users ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users 添加用户
router.post('/users', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    const exists = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (exists) {
      return res.status(400).json({ error: '账号已存在' });
    }
    const result = await run(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [username, password, role || 'teacher']
    );
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [result.lastInsertRowid]);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: '添加失败：' + err.message });
  }
});

// PUT /api/users/:id 修改用户
router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, password, role } = req.body || {};
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    const current = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
    if (!current) {
      return res.status(404).json({ error: '用户不存在' });
    }
    if (username && username !== current.username) {
      const dup = await queryOne(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, id]
      );
      if (dup) {
        return res.status(400).json({ error: '账号已存在' });
      }
    }
    await run(
      'UPDATE users SET username = $1, password = $2, role = $3 WHERE id = $4',
      [username || current.username, password || current.password, role || current.role, id]
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

module.exports = router;
