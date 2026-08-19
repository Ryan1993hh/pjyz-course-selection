// api/index.js
// Vercel Serverless 入口，将 Express app 包装为 Vercel 兼容的 handler
const app = require('../backend/server');

module.exports = app;
