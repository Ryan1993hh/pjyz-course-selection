// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { createToken } = require('../auth');

// POST /api/login 登录验证
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  const token = createToken(user);
  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

module.exports = router;
