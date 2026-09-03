// Rate limiting — fixed-window counters in memory.
// Covers all API routes.
// existing per-email login throttle in server/index.js.
//
// Before this, the ONLY rate limit anywhere in the app was that per-email
// login throttle — every other route (job posting, bidding, the public
// lane index) had no ceiling at all. This closes that gap.
//
// SCALING NOTE: in-memory state means limits reset on restart and don't
// share across multiple instances. That's an acceptable default at a
// single-process scale (matches the app's current node:sqlite
// single-writer model) but won't hold once the app runs more than one
// instance — move this to Redis at the same time as the Postgres port.

let sharedRedis = null;
function getRedis() {
  if (sharedRedis) return sharedRedis;
  if (!process.env.REDIS_URL) return null;
  try {
    const IORedis = require('ioredis');
    sharedRedis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    sharedRedis.on('error', () => {});
    if (process.env.NODE_ENV === 'production') console.log('[rateLimit] Redis enabled — distributed rate limiting active');
    return sharedRedis;
  } catch (e) {
    console.warn('[rateLimit] REDIS_URL set but ioredis failed:', e.message);
    return null;
  }
}
if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  console.warn('[rateLimit] WARNING: REDIS_URL not set in production — rate limits are in-memory only (single-instance). Set REDIS_URL for distributed limiting.');
}

function rateLimiter({ windowMs, max, keyFn, message }) {
  const hits = new Map();
  function sweep(now) {
    for (const [key, rec] of hits) {
      if (now - rec.windowStart > windowMs) hits.delete(key);
    }
  }

  return async function rateLimit(req, res, next) {
    const key = keyFn(req);
    if (!key) return next();

    const redis = getRedis();
    if (redis) {
      const redisKey = `rl:${key}`;
      try {
        const count = await redis.incr(redisKey);
        if (count === 1) await redis.pexpire(redisKey, windowMs);
        if (count > max) {
          const ttl = await redis.pttl(redisKey);
          res.setHeader('Retry-After', Math.ceil((ttl > 0 ? ttl : windowMs) / 1000));
          return res.status(429).json({ error: message || 'Too many requests. Please slow down.' });
        }
        return next();
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }

    const now = Date.now();
    if (hits.size > 5000) sweep(now);
    const rec = hits.get(key);
    if (!rec || now - rec.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((windowMs - (now - rec.windowStart)) / 1000));
      return res.status(429).json({ error: message || 'Too many requests. Please slow down.' });
    }
    next();
  };
}

// IP-based, not user-based: the global limiter below sits in the middleware
// chain before auth() runs per-route (auth() is passed to individual
// app.post/get calls, not mounted globally), so req.user isn't populated
// yet at this point — matches how the existing login throttle keys by
// email/IP rather than a not-yet-known user id.
//
// cf-connecting-ip first: the production deployment sits behind Cloudflare
// AND Render's own edge proxy — two hops before this process ever sees a
// request. Express's `trust proxy` setting counts hops off
// X-Forwarded-For, and getting that count wrong (it's not consistently
// documented how many Render adds) silently collapses every visitor onto
// one bucket instead of failing loudly. Cloudflare's cf-connecting-ip is
// set by Cloudflare itself, at the edge, and can't be spoofed by a client
// (Cloudflare overwrites any client-supplied copy of it) — trusting it
// when present sidesteps the hop-counting problem entirely. req.ip (via
// trust proxy) is the fallback for local dev and any deployment not behind
// Cloudflare.
const byIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

// The shared client is constructed with enableOfflineQueue:false so a slow/
// down Redis can never make a live request hang — correct for rate
// limiting, but it means a command fired the instant the client is created
// (before its TCP handshake + auth finish) rejects immediately even though
// Redis is perfectly healthy. A health-check ping needs an honest answer,
// not that race, so wait briefly for 'ready' before pinging rather than
// disabling the offline queue (which would reintroduce the hang risk for
// real traffic).
async function pingRedis(redis, timeoutMs = 500) {
  if (redis.status !== 'ready') {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      redis.once('ready', () => { clearTimeout(timer); resolve(undefined); });
    });
  }
  return redis.ping();
}

module.exports = { rateLimiter, byIp, getRedis, pingRedis };
