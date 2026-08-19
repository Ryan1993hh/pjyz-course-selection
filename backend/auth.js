// backend/auth.js
// JWT 鉴权中间件（无状态，适配 Vercel Serverless）
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pjyz-dev-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

/**
 * 生成 JWT token
 */
function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * 校验 token 中间件
 */
function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

/**
 * 仅管理员
 */
function adminRequired(req, res, next) {
  authRequired(req, res, function () {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '权限不足，仅管理员可操作' });
    }
    next();
  });
}

module.exports = { createToken, authRequired, adminRequired };
