// api/[...path].js
// Vercel Serverless catch-all：处理所有 /api/* 请求
// Express 内部自行路由分发
const app = require('../backend/server');

module.exports = app;
