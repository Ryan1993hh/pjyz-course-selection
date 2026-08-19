// lib/auth.js
// JWT authentication - compatible with Cloudflare Workers
import { jwt } from 'hono/jwt';

function getEnv(name) {
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

export async function createToken(user) {
  const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key-change-in-production';
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  };
  return await jwt.sign(payload, secret, 'HS256');
}

export async function verifyToken(token) {
  try {
    const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key-change-in-production';
    const payload = await jwt.verify(token, secret);
    return payload;
  } catch {
    return null;
  }
}
