const db = require('../db');
const { logger } = require('./logger');

// Requests currently being handled, keyed by `${userId}:${key}`. The cache
// row below is only written AFTER the handler succeeds, so two requests that
// arrive together (a double-click on "Post job", a retry racing its own
// original) both used to find no row, both ran the handler, and both created
// a job. A second request with a key that is still in flight now waits for the
// first to finish and replays its result instead. In-process only: it covers
// the double-submit case on one instance; the DB row still covers sequential
// retries across instances and restarts.
const inFlight = new Map();

async function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  if (!key || typeof key !== 'string' || key.length < 8 || key.length > 128) return next();
  const userId = req.user ? req.user.id : 0;
  const flightKey = `${userId}:${key}`;

  const pending = inFlight.get(flightKey);
  if (pending) {
    await pending.done;
    if (pending.result) {
      res.set('X-Idempotent-Replayed', 'true');
      return res.status(pending.result.status).set('Content-Type', 'application/json').send(pending.result.body);
    }
    // The first attempt did not succeed (nothing was written) — fall through
    // and handle this one normally.
  }

  const existing = await db.prepare('SELECT response_status, response_body FROM idempotency_keys WHERE key=? AND user_id=?').get(key, userId);
  if (existing) {
    res.set('X-Idempotent-Replayed', 'true');
    return res.status(existing.response_status).set('Content-Type', 'application/json').send(existing.response_body);
  }

  const entry = { result: null, done: null };
  let release;
  entry.done = new Promise((resolve) => { release = resolve; });
  inFlight.set(flightKey, entry);
  const finish = () => {
    if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey);
    release();
  };
  res.once('finish', finish);
  res.once('close', finish);

  const origJson = res.json.bind(res);
  const origStatus = res.status.bind(res);
  let statusCode = 200;
  res.status = (code) => { statusCode = code; return origStatus(code); };
  res.json = (body) => {
    // Only cache a genuine success (2xx). A 4xx/5xx means nothing was
    // actually written, so there is no duplicate-side-effect risk in
    // letting a retry under the same key actually re-run the handler —
    // and caching it anyway is a real bug: a client that corrects its
    // request and resubmits under the same key (the exact pattern the
    // job-post form uses for its T&C-checkbox retry, and the bid form for
    // its own retry-after-validation-error) would otherwise have the
    // ORIGINAL validation failure replayed forever, verbatim, no matter
    // what it sends — a permanent "can't submit" stuck state that looks
    // like the feature itself is broken.
    if (statusCode >= 200 && statusCode < 300) {
      const bodyStr = JSON.stringify(body);
      entry.result = { status: statusCode, body: bodyStr };
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
    }
    res.set('X-Idempotent-Replayed', 'false');
    return origJson(body);
  };
  next();
}
module.exports = { idempotency };
