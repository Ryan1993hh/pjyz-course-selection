// backend/db.js
// 数据库初始化与辅助函数
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * 数据库存放目录
 * - 本地开发：项目根/database/
 * - Render 部署：优先使用持久磁盘 RENDER_DISK_PATH（如 /var/data）
 *   Render 的 Web Service 根目录是临时的，重新部署会丢失，必须挂载 Disk
 */
function resolveDbDir() {
  // 1. 显式环境变量优先
  if (process.env.RENDER_DISK_PATH) {
    return process.env.RENDER_DISK_PATH;
  }
  // 2. Render 持久磁盘默认挂载点
  if (fs.existsSync('/var/data')) {
    return '/var/data';
  }
  // 3. 本地开发：项目根/database
  return path.join(__dirname, '..', 'database');
}

const dbDir = resolveDbDir();
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'app.db');
console.log('[DB] 数据库路径:', dbPath);
const db = new Database(dbPath);

// 开启外键约束
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * 初始化数据库表结构
 */
function initDB() {
  // 课程表
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      category      TEXT,
      name          TEXT,
      description   TEXT,
      teacher       TEXT,
      location      TEXT,
      requirement   TEXT,
      limit_grade6  INTEGER DEFAULT 0,
      limit_grade7  INTEGER DEFAULT 0
    );
  `);

  // 选课结果表
  db.exec(`
    CREATE TABLE IF NOT EXISTS selections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      grade        TEXT,
      class_name   TEXT,
      student_name TEXT,
      course_id    INTEGER,
      course_name  TEXT,
      upload_time  TEXT
    );
  `);

  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role     TEXT
    );
  `);

  // === 默认账号种子（首次启动 + 兼容旧库密码迁移） ===
  // 默认账号：admin/123456（管理员）、123456/123456（用户/教师）
  const SEED_ACCOUNTS = [
    { username: 'admin',  password: '123456', role: 'admin'  },
    { username: '123456', password: '123456', role: 'teacher' }
  ];

  const findByUsername = db.prepare('SELECT id, password, role FROM users WHERE username = ?');
  const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  const updateUser = db.prepare('UPDATE users SET password = ?, role = ? WHERE id = ?');

  SEED_ACCOUNTS.forEach(a => {
    const existing = findByUsername.get(a.username);
    if (!existing) {
      insertUser.run(a.username, a.password, a.role);
      console.log(`[DB] 默认账号已创建: ${a.username} / ${a.password} (${a.role})`);
    } else if (existing.password !== a.password || existing.role !== a.role) {
      // 旧库迁移：把旧的 admin/admin123 等同步为新的默认密码与角色
      updateUser.run(a.password, a.role, existing.id);
      console.log(`[DB] 默认账号已更新: ${a.username} -> ${a.role}`);
    }
  });
}

initDB();

module.exports = db;
