// lib/db.js
// Neon Serverless PostgreSQL driver - compatible with Cloudflare Workers and Node.js
import { neon } from '@neondatabase/serverless';

let _sql = null;
let initialized = false;

function getEnv(name) {
  // Cloudflare Workers: env vars are globals; Node.js: use process.env
  if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return globalThis[name];
  if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  return '';
}

export function getSQL() {
  if (!_sql) {
    const url = getEnv('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL 未配置');
    _sql = neon(url);
  }
  return _sql;
}

export async function ensureDB() {
  if (initialized) return;
  const sql = getSQL();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        category TEXT DEFAULT '',
        name TEXT DEFAULT '',
        description TEXT DEFAULT '',
        teacher TEXT DEFAULT '',
        location TEXT DEFAULT '',
        requirement TEXT DEFAULT '',
        limit_grade6 INTEGER DEFAULT 0,
        limit_grade7 INTEGER DEFAULT 0
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS selections (
        id SERIAL PRIMARY KEY,
        grade TEXT DEFAULT '',
        class_name TEXT DEFAULT '',
        student_name TEXT DEFAULT '',
        course_id INTEGER,
        course_name TEXT DEFAULT '',
        upload_time TEXT DEFAULT ''
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'teacher'
      )
    `;
    const accounts = [
      { username: 'admin', password: '123456', role: 'admin' },
      { username: '123456', password: '123456', role: 'teacher' }
    ];
    for (const a of accounts) {
      const existing = await sql`SELECT id, password, role FROM users WHERE username = ${a.username}`;
      if (existing.length === 0) {
        await sql`INSERT INTO users (username, password, role) VALUES (${a.username}, ${a.password}, ${a.role})`;
      } else if (existing[0].password !== a.password || existing[0].role !== a.role) {
        await sql`UPDATE users SET password = ${a.password}, role = ${a.role} WHERE id = ${existing[0].id}`;
      }
    }
    initialized = true;
  } catch (err) {
    console.error('[DB] 初始化失败:', err.message);
    throw err;
  }
}
