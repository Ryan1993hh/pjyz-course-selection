// backend/server.js
// Express 入口，启动服务
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());

const { createMiddleware, resolveSqlitePath } = require('./pages-api');
const sqliteFile = resolveSqlitePath();
if (sqliteFile && fs.existsSync(sqliteFile)) {
  console.log('[DB] 使用本地数据库:', sqliteFile);
  app.use(createMiddleware(sqliteFile));
} else {
  console.warn('[DB] 未找到 data/pjyz-d1.sqlite，继续使用 PostgreSQL');
  const authRoutes = require('./routes/auth');
  const courseRoutes = require('./routes/courses');
  const selectionRoutes = require('./routes/selections');
  const userRoutes = require('./routes/users');
  const classRoutes = require('./routes/classes');
  app.use('/api', authRoutes);
  app.use('/api', courseRoutes);
  app.use('/api', selectionRoutes);
  app.use('/api', userRoutes);
  app.use('/api', classRoutes);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件（前端）- public/ 为 Cloudflare Pages 部署目录
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
console.log('[Static] 静态文件目录:', publicDir);

// 根路径返回登录页
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'denglu.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  浦江一中拓展课选课管理系统已启动');
  console.log('========================================');
  console.log('  前端选课入口: http://localhost:' + PORT + '/');
  console.log('  后台管理入口: http://localhost:' + PORT + '/admin.html');
  if (sqliteFile) console.log('  数据来源:       本地完整数据库');
  else console.log('  默认管理员:   admin / admin123');
  console.log('========================================');
});
