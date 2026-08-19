// backend/server.js
// Express 入口，同时支持本地开发和 Vercel Serverless 部署
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件（前端）
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir, {
  index: false,
  maxAge: '1h'
}));

// 注册路由
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const selectionRoutes = require('./routes/selections');
const userRoutes = require('./routes/users');

app.use('/api', authRoutes);
app.use('/api', courseRoutes);
app.use('/api', selectionRoutes);
app.use('/api', userRoutes);

// 根路径返回登录页
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'denglu.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// SPA 兜底
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.endsWith('.html')) {
    const f = path.join(frontendDir, path.basename(req.path));
    if (fs.existsSync(f)) return res.sendFile(f);
    return res.sendFile(path.join(frontendDir, 'denglu.html'));
  }
  res.sendFile(path.join(frontendDir, 'denglu.html'));
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

// Vercel Serverless：导出 app
// 本地开发：直接 listen
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log('========================================');
    console.log('  浦江一中拓展课选课管理系统已启动');
    console.log('========================================');
    console.log('  前端选课入口: http://localhost:' + PORT + '/');
    console.log('  后台管理入口: http://localhost:' + PORT + '/admin.html');
    console.log('  默认管理员:   admin / 123456');
    console.log('  默认用户:     123456 / 123456');
    console.log('  健康检查:     http://localhost:' + PORT + '/api/health');
    console.log('========================================');
  });
}

module.exports = app;
