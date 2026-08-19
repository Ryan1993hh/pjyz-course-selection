// backend/routes/users.js
const express = require('express');
const router = express.Router();
const { query, queryOne, run, ensureDB, pool } = require('../db');

let MEM_USERS = [
  { id: 1, username: 'admin', password: '123456', role: 'admin', teacher_name: '', class_name: '' },
  { id: 2, username: '123456', password: '123456', role: 'teacher', teacher_name: '', class_name: '' }
];
let MEM_USER_ID = 3;

router.get('/users', async (req, res) => {
  try {
    if (pool) {
      await ensureDB();
      const rows = await query('SELECT * FROM users ORDER BY id ASC');
      return res.json(rows);
    }
    res.json(MEM_USERS.map(u => ({ ...u, password: undefined })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  const { username, password, role, teacher_name, class_name } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    if (pool) {
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
      return res.json({ success: true, user });
    }
    if (MEM_USERS.some(u => u.username === username)) {
      return res.status(400).json({ error: '账号已存在' });
    }
    const newUser = { id: MEM_USER_ID++, username, password, role: role || 'teacher', teacher_name: teacher_name || '', class_name: class_name || '' };
    MEM_USERS.push(newUser);
    res.json({ success: true, user: { ...newUser, password: undefined } });
  } catch (err) {
    res.status(500).json({ error: '添加失败：' + err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { username, password, role, teacher_name, class_name } = req.body || {};
  if (role && !['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: '角色只能为 admin 或 teacher' });
  }
  try {
    if (pool) {
      await ensureDB();
      const current = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
      if (!current) {
        return res.status(404).json({ error: '用户不存在' });
      }
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
      return res.json({ success: true, user });
    }
    const u = MEM_USERS.find(u => u.id === id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    if (username && username !== u.username && MEM_USERS.some(x => x.username === username)) {
      return res.status(400).json({ error: '账号已存在' });
    }
    if (username) u.username = username;
    if (password) u.password = password;
    if (role) u.role = role;
    if (teacher_name !== undefined) u.teacher_name = teacher_name;
    if (class_name !== undefined) u.class_name = class_name;
    res.json({ success: true, user: { ...u, password: undefined } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    if (pool) {
      await ensureDB();
      const user = await queryOne('SELECT * FROM users WHERE id = $1', [id]);
      if (!user) {
        return res.status(404).json({ error: '用户不存在' });
      }
      if (user.username === 'admin') {
        return res.status(400).json({ error: '默认管理员账号不可删除' });
      }
      await run('DELETE FROM users WHERE id = $1', [id]);
      return res.json({ success: true });
    }
    const idx = MEM_USERS.findIndex(u => u.id === id);
    if (idx === -1) return res.status(404).json({ error: '用户不存在' });
    if (MEM_USERS[idx].username === 'admin') {
      return res.status(400).json({ error: '默认管理员账号不可删除' });
    }
    MEM_USERS.splice(idx, 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/import', async (req, res) => {
  const { users } = req.body || {};
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: '请求格式错误' });
  }
  const imported = [];
  const failed = [];
  const errors = [];
  const totalCount = users.length;
  try {
    if (pool) {
      await ensureDB();
      for (const u of users) {
        try {
          const existing = await queryOne('SELECT id FROM users WHERE username = $1', [u.username]);
          if (existing) {
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
      // Record import history
      try {
        await run(
          'INSERT INTO import_history (type, operator, imported_count, failed_count, total_count, details) VALUES ($1, $2, $3, $4, $5, $6)',
          ['user_import', req.user ? String(req.user.id) : 'admin', imported.length, failed.length, totalCount, errors.slice(0, 20).join('; ')]
        );
      } catch(histErr) {
        console.error('Failed to record import history:', histErr.message);
      }
      return res.json({ success: true, imported: imported.length, failed: failed.length, errors });
    }
    for (const u of users) {
      try {
        const existing = MEM_USERS.find(x => x.username === u.username);
        if (existing) {
          existing.password = u.password || existing.password;
          existing.role = u.role || existing.role;
          existing.teacher_name = u.teacher_name || '';
        } else {
          MEM_USERS.push({
            id: MEM_USER_ID++,
            username: u.username,
            password: u.password,
            role: u.role || 'teacher',
            teacher_name: u.teacher_name || '',
            class_name: ''
          });
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

router.get('/import-history', async (req, res) => {
  try {
    if (pool) {
      await ensureDB();
      const rows = await query('SELECT * FROM import_history ORDER BY created_at DESC LIMIT 100');
      return res.json({ history: rows });
    }
    res.json({ history: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
