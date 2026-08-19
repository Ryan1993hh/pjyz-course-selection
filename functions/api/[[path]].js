// functions/api/[[path]].js
// Cloudflare Pages Functions - 最小化测试版本
export function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  if (path === '/api/health' || path === '/api/') {
    return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString(), path }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/login') {
    return handleLogin(context);
  }

  return new Response(JSON.stringify({ error: 'API 端点不存在', path }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleLogin(context) {
  try {
    const body = await context.request.json();
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '请输入账号和密码' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = getEnv('DATABASE_URL') || '';
    if (!url) {
      return new Response(JSON.stringify({ error: 'DATABASE_URL 未配置' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await fetchNeon(url, `SELECT * FROM users WHERE username = $1 AND password = $2`, [username, password]);
    const rows = result.rows || [];

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: '账号或密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = rows[0];
    const token = await createSimpleToken(user);

    return new Response(JSON.stringify({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '登录失败：' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function getEnv(name) {
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

// Simple JWT using Web Crypto
async function createSimpleToken(user) {
  const secret = getEnv('JWT_SECRET') || 'pjyz-dev-secret-key';
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { id: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now()/1000) + 7*86400 };
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const signing = `${enc(header)}.${enc(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signing));
  const sigEnc = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `${signing}.${sigEnc}`;
}

// Neon HTTP driver - simple fetch-based query
async function fetchNeon(connUrl, sql, params = []) {
  // Parse connection URL
  const url = new URL(connUrl);
  const host = url.hostname;
  const dbName = url.pathname.slice(1);
  const auth = decodeURIComponent(url.username + ':' + url.password);

  const neonUrl = `https://${host}/sql`;
  const response = await fetch(neonUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth}`
    },
    body: JSON.stringify({
      query: sql,
      params: params,
      database: dbName
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Neon 查询失败: ' + errText);
  }

  return await response.json();
}
