const { DatabaseSync } = require('node:sqlite');

function normalize(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

function createStatement(db, sql, params) {
  return {
    bind(...args) {
      return createStatement(db, sql, args);
    },
    async all() {
      const rows = db.prepare(sql).all(...params);
      return { success: true, results: normalize(rows), meta: {} };
    },
    async first() {
      const row = db.prepare(sql).get(...params);
      return row ? normalize(row) : null;
    },
    async run() {
      const info = db.prepare(sql).run(...params);
      return {
        success: true,
        meta: {
          changes: Number(info.changes || 0),
          last_row_id: Number(info.lastInsertRowid || 0)
        }
      };
    }
  };
}

function openLocalD1(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  return {
    prepare(sql) {
      return createStatement(db, sql, []);
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) results.push(await stmt.run());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    }
  };
}

module.exports = { openLocalD1 };
