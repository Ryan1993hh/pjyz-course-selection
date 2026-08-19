// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const { queryOne, ensureDB, pool } = require('../db');
const { createToken } = require('../auth');

const LOCAL_USERS = [
  { id: 1, username: 'admin',  password: '123456', role: 'admin',  teacher_name: '', class_name: '' },
  { id: 2, username: '123456', password: '123456', role: 'teacher', teacher_name: '', class_name: '' }
];

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  try {
    if (pool) {
      await ensureDB();
      const user = await queryOne('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
      if (user) {
        const token = createToken(user);
        return res.json({
          success: true,
          token,
          user: { id: user.id, username: user.username, role: user.role, teacher_name: user.teacher_name || '', class_name: user.class_name || '' }
        });
      }
    }
    const localUser = LOCAL_USERS.find(u => u.username === username && u.password === password);
    if (localUser) {
      const token = createToken(localUser);
      return res.json({
        success: true,
        token,
        user: { id: localUser.id, username: localUser.username, role: localUser.role, teacher_name: localUser.teacher_name || '', class_name: localUser.class_name || '' }
      });
    }
    res.status(401).json({ error: '账号或密码错误' });
  } catch (err) {
    const localUser = LOCAL_USERS.find(u => u.username === username && u.password === password);
    if (localUser) {
      const token = createToken(localUser);
      return res.json({
        success: true,
        token,
        user: { id: localUser.id, username: localUser.username, role: localUser.role, teacher_name: localUser.teacher_name || '', class_name: localUser.class_name || '' }
      });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
