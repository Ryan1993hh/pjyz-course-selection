// backend/routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/users 获取用户列表
router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
  res.json(rows);
});

// POST /api/users 添加用户
router.post('/users', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(400).json({ error: '账号已存在' });
  }
  try {
    const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run(username, password, role || 'teacher');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: '添加失败：' + err.message });
  }
});

// PUT /api/users/:id 修改用户
router.put('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, password, role } = req.body || {};
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) {
    return res.status(404).json({ error: '用户不存在' });
  }
  // 检查账号唯一
  if (username && username !== current.username) {
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
    if (dup) {
      return res.status(400).json({ error: '账号已存在' });
    }
  }
  db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?')
    .run(username || current.username, password || current.password, role || current.role, id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ success: true, user });
});

// DELETE /api/users/:id 删除用户
router.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (user.username === 'admin') {
    return res.status(400).json({ error: '默认管理员账号不可删除' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
