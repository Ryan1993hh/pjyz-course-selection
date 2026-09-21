const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { openLocalD1 } = require('./sqlite-d1');

function createMiddleware(sqliteFile) {
  const db = openLocalD1(sqliteFile);
  const handlerUrl = pathToFileURL(path.join(__dirname, '..', 'functions', 'api', '[[path]].js')).href;
  let handlerPromise = null;
  let queue = Promise.resolve();

  function loadHandler() {
    if (!handlerPromise) {
      handlerPromise = import(handlerUrl).then((mod) => {
        if (typeof mod.onRequest !== 'function') throw new Error('页面接口未导出 onRequest');
        return mod.onRequest;
      });
    }
    return handlerPromise;
  }

  function oneAtATime(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(() => {}, () => {});
    return run;
  }

  return async function pagesApi(req, res, next) {
    if (!req.path.startsWith('/api')) return next();
    try {
      const onRequest = await loadHandler();
      const response = await oneAtATime(async () => {
        const url = 'http://127.0.0.1' + req.originalUrl;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value == null) continue;
          if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
          else headers.set(key, value);
        }
        const method = req.method.toUpperCase();
        let body;
        if (method !== 'GET' && method !== 'HEAD') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          body = Buffer.concat(chunks);
        }
        const request = new Request(url, { method, headers, body });
        return onRequest({
          request,
          env: { DB: db },
          waitUntil(task) {
            Promise.resolve(task).catch((err) => console.error('[API] 后台任务失败:', err && err.message ? err.message : err));
          }
        });
      });
      res.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') return;
        res.setHeader(key, value);
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      res.send(bytes);
    } catch (err) {
      console.error('[API]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '服务暂时异常：' + (err && err.message ? err.message : err) });
      }
    }
  };
}

function resolveSqlitePath() {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  const file = path.join(__dirname, '..', 'data', 'pjyz-d1.sqlite');
  return fs.existsSync(file) ? file : '';
}

module.exports = { createMiddleware, resolveSqlitePath };
