// lib/auth.js
// JWT authentication using Web Crypto API (compatible with Cloudflare Workers and Node.js)

function getEnv(name) {
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

// Base64url encode
function b64urlencode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Base64url decode
function b64urldecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Import key for HS256
async function getKey(secret) {
  const enc = new TextEncoder().encode(secret);
  return await crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createToken(user) {
  const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key-change-in-production';
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  };
  const headerB64 = b64urlencode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64urlencode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = b64urlencode(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

export async function verifyToken(token) {
  try {
    const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key-change-in-production';
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await getKey(secret);
    const sigBytes = b64urldecode(sigB64);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urldecode(payloadB64)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
