const db = require('../db');
const { logger } = require('./logger');

async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  if (!key || typeof key !== 'string' || key.length < 8 || key.length > 128) return next();
  const existing = await db.prepare('SELECT response_status, response_body FROM idempotency_keys WHERE key=? AND user_id=?').get(key, req.user ? req.user.id : 0);
  if (existing) {
    res.set('X-Idempotent-Replayed', 'true');
    return res.status(existing.response_status).set('Content-Type', 'application/json').send(existing.response_body);
  }
  const origJson = res.json.bind(res);
  const origStatus = res.status.bind(res);
  let statusCode = 200;
  res.status = (code) => { statusCode = code; return origStatus(code); };
  res.json = (body) => {
    const bodyStr = JSON.stringify(body);
    // Deliberately not awaited: res.json is called synchronously by every
    // route handler (often as `return res.json(...)`), and making this
    // async would change what that return value is everywhere it's used.
    // On Postgres this .run() returns a Promise — a bare try/catch around
    // the call (the previous version) only catches a *synchronous* throw,
    // never a rejection of that promise, so any failure here (a raw
    // network blip, or a genuine race with another request replaying the
    // same key at the same instant) became an unhandled rejection that
    // crashed the whole process. .catch() makes this what it always should
    // have been: best-effort caching of the replay response, never able to
    // take the server down.
    Promise.resolve(
      db.prepare('INSERT INTO idempotency_keys (key, user_id, response_status, response_body) VALUES (?,?,?,?)').run(key, req.user.id, statusCode, bodyStr)
    ).catch((e) => logger.error('idempotency_write_failed', { key, error: e.message }));
    res.set('X-Idempotent-Replayed', 'false');
    return origJson(body);
  };
  next();
}
module.exports = { idempotency };
