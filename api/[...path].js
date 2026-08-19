// api/[...path].js
// Vercel Serverless catch-all：处理所有 /api/* 请求
// Vercel 自动将 public/ 下的静态文件（index.html, admin.html 等）直接提供
// 此函数仅处理 /api/ 开头的请求
const express = require('express');
const cors = require('cors');

// 创建独立的 Express app（不加载静态文件，不阻塞启动）
const app = express();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 注册 API 路由（仅注册 /api 相关）
const authRoutes = require('../backend/routes/auth');
const courseRoutes = require('../backend/routes/courses');
const selectionRoutes = require('../backend/routes/selections');
const userRoutes = require('../backend/routes/users');

app.use('/api', authRoutes);
app.use('/api', courseRoutes);
app.use('/api', selectionRoutes);
app.use('/api', userRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), uptime: process.uptime() });
});

// 根路径 API 信息
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    service: '浦江一中拓展课选课系统 API',
    version: '2.0'
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

module.exports = app;
