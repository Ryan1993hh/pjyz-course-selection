// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const { queryOne } = require('../db');
const { createToken } = require('../auth');

// POST /api/login 登录验证
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  try {
    const user = await queryOne(
      'SELECT * FROM users WHERE username = $1 AND password = $2',
      [username, password]
    );
    if (!user) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const token = createToken(user);
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: '登录失败：' + err.message });
  }
});

module.exports = router;
