// backend/server.js
// Express 入口：本地开发时直接 listen，Vercel 部署时导出 app
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

// 仅在本地开发时提供静态文件（Vercel 由平台直接托管 public/ 静态文件）
if (process.env.VERCEL !== '1') {
  const publicDir = path.join(__dirname, '..', 'public');
  const frontendDir = path.join(__dirname, '..', 'frontend');
  const staticDir = fs.existsSync(publicDir) ? publicDir : frontendDir;

  app.use(express.static(staticDir, {
    index: false,
    maxAge: '1h'
  }));

  app.get('/', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path.endsWith('.html')) {
      const f = path.join(staticDir, path.basename(req.path));
      if (fs.existsSync(f)) return res.sendFile(f);
      return res.sendFile(path.join(staticDir, 'index.html'));
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// 注册 API 路由
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const selectionRoutes = require('./routes/selections');
const userRoutes = require('./routes/users');

app.use('/api', authRoutes);
app.use('/api', courseRoutes);
app.use('/api', selectionRoutes);
app.use('/api', userRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

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
