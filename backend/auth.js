// backend/auth.js
// 简单 Token 鉴权中间件
const crypto = require('crypto');

// 内存中存储 token -> 用户信息（重启后失效，需重新登录）
const tokenStore = new Map();

/**
 * 生成 token
 */
function createToken(user) {
  const raw = `${user.id}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  const token = Buffer.from(raw).toString('base64').replace(/[+/=]/g, '');
  tokenStore.set(token, { id: user.id, username: user.username, role: user.role });
  return token;
}

/**
 * 校验 token 中间件
 */
function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !tokenStore.has(token)) {
    return res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
  }
  req.user = tokenStore.get(token);
  next();
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

module.exports = { createToken, authRequired, adminRequired, tokenStore };
