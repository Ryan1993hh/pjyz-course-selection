// api/index.js
// Vercel Serverless: 处理 /api 根路径
const express = require('express');
const app = express();

app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    service: '浦江一中拓展课选课系统 API',
    version: '2.0',
    endpoints: [
      'POST /api/login',
      'GET  /api/courses',
      'POST /api/courses/upload',
      'PUT  /api/courses',
      'DELETE /api/courses/:id',
      'GET  /api/selections',
      'POST /api/selections',
      'PUT  /api/selections/:id',
      'GET  /api/selections/export',
      'GET  /api/classes',
      'GET  /api/health'
    ]
  });
});

module.exports = app;
