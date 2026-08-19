// lib/auth.js
// JWT 鉴权（使用 Hono 内置 JWT，兼容 Cloudflare Workers）
import { jwt } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || 'pjyz-dev-secret-key-change-in-production';
const JWT_ALG = 'HS256';
const JWT_EXPIRES = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days in seconds

export async function createToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: JWT_EXPIRES
  };
  return await jwt.sign(payload, JWT_SECRET, JWT_ALG);
}

export async function verifyToken(token) {
  try {
    const payload = await jwt.verify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}
