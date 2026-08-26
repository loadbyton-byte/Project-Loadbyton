const db = require('../db');

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
    try {
      db.prepare('INSERT INTO idempotency_keys (key, user_id, response_status, response_body) VALUES (?,?,?,?)').run(key, req.user.id, statusCode, bodyStr);
    } catch {}
    res.set('X-Idempotent-Replayed', 'false');
    return origJson(body);
  };
  next();
}
module.exports = { idempotency };
