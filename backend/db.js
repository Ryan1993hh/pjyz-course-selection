// backend/db.js
// PostgreSQL 数据库初始化与辅助函数（适配 Neon + Vercel Serverless）
const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.warn('[DB] 未设置 DATABASE_URL，本地开发将使用内存假实现');
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

/**
 * 执行 SQL 查询（返回结果行数组）
 */
async function query(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL 未配置');
  }
  const res = await pool.query(text, params);
  return res.rows;
}

/**
 * 单行查询（返回第一行或 undefined）
 */
async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0];
}

/**
 * 执行写操作（INSERT/UPDATE/DELETE），返回影响行数和 lastInsertRowid
 * 对 INSERT 语句自动追加 RETURNING id
 */
async function run(text, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL 未配置');
  }
  let sql = text;
  const upper = text.trim().toUpperCase();
  if (upper.startsWith('INSERT') && !upper.includes('RETURNING')) {
    sql = text.trim().replace(/;?\s*$/, ' RETURNING id');
  }
  const res = await pool.query(sql, params);
  return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id ?? null };
}

/**
 * 事务：传入异步回调，自动 BEGIN/COMMIT/ROLLBACK
 */
async function transaction(fn) {
  if (!pool) throw new Error('DATABASE_URL 未配置');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 初始化表结构 + 种子数据
 */
async function initDB() {
  if (!pool) {
    console.warn('[DB] 跳过数据库初始化（无连接）');
    return;
  }

  const client = await pool.connect();
  try {
    // 创建表
    await client.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id            SERIAL PRIMARY KEY,
        category      TEXT DEFAULT '',
        name          TEXT DEFAULT '',
        description   TEXT DEFAULT '',
        teacher       TEXT DEFAULT '',
        location      TEXT DEFAULT '',
        requirement   TEXT DEFAULT '',
        limit_grade6  INTEGER DEFAULT 0,
        limit_grade7  INTEGER DEFAULT 0
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS selections (
        id           SERIAL PRIMARY KEY,
        grade        TEXT DEFAULT '',
        class_name   TEXT DEFAULT '',
        student_name TEXT DEFAULT '',
        course_id    INTEGER,
        course_name  TEXT DEFAULT '',
        upload_time  TEXT DEFAULT ''
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id       SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role     TEXT DEFAULT 'teacher'
      );
    `);

    // 种子账号
    const SEED_ACCOUNTS = [
      { username: 'admin',  password: '123456', role: 'admin'  },
      { username: '123456', password: '123456', role: 'teacher' }
    ];

    for (const a of SEED_ACCOUNTS) {
      const existing = await client.query(
        'SELECT id, password, role FROM users WHERE username = $1',
        [a.username]
      );
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
          [a.username, a.password, a.role]
        );
        console.log(`[DB] 默认账号已创建: ${a.username} / ${a.password} (${a.role})`);
      } else if (
        existing.rows[0].password !== a.password ||
        existing.rows[0].role !== a.role
      ) {
        await client.query(
          'UPDATE users SET password = $1, role = $2 WHERE id = $3',
          [a.password, a.role, existing.rows[0].id]
        );
        console.log(`[DB] 默认账号已更新: ${a.username} -> ${a.role}`);
      }
    }
  } finally {
    client.release();
  }
}

// 启动时初始化
initDB().catch(err => console.error('[DB] 初始化失败:', err.message));

module.exports = { pool, query, queryOne, run, transaction };
