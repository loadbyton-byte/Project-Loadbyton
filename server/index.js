const app = require('./app');
const { PORT } = require('./lib/config');

// app.listen() is Express's thin wrapper around node:http's createServer +
// listen — capturing its return value (the real http.Server) is what
// Socket.IO needs to attach to; no separate server instance involved.
const httpServer = app.listen(PORT, () => {
  console.log(`Loadbyton API listening on :${PORT}`);
  if (!process.env.INTERNAL_KEY) {
    const level = process.env.NODE_ENV === 'production' ? 'WARNING' : 'note';
    console.log(`[${level}] INTERNAL_KEY not set — generated a random one for this process only. It will change on every restart/redeploy. Set INTERNAL_KEY in the environment if anything external calls POST /api/system/auto-release.`);
  } else {
    console.log('INTERNAL_KEY is set from the environment.');
  }
  // seed() is async (it awaits db calls, required on Postgres — see
  // server/db.js's top-of-file contract comment). A plain try/catch
  // around an async call only catches a synchronous throw during the call
  // itself, not the promise it returns rejecting later — that gap is
  // exactly what turned a demo-seeding failure into an unhandled-rejection
  // process crash before this fix. Explicitly .catch() so a seeding
  // failure only ever logs.
  //
  // seed() is now a single, fully idempotent top-up (server/seed.js) that
  // safely runs on every boot regardless of what's already in the
  // database — it used to be two separate mechanisms (a fresh-DB-only
  // seed() plus a narrower ensureDemoLogins() covering 5 of the accounts)
  // that diverged as the demo roster grew, which is how a production
  // database that already had one real user in it could never receive any
  // of the demo accounts added after that point, no matter how many times
  // it restarted. SEED_DEMO_ACCOUNTS=0 still opts a real customer-facing
  // deployment out of demo-account creation entirely, same as before —
  // now it gates the one unified call instead of just half of it.
  if (process.env.SEED_DEMO_ACCOUNTS !== '0') {
    (async () => {
      try {
        await require('./seed')();
      } catch (e) {
        console.log(`[warning] seed() failed: ${e.message}`);
      }
    })();
  }
  // Outbox worker — reliable delivery of post-transaction side-effects (notifications, ledger fanout)
  try { require('./workers/outbox.worker').startOutboxWorker(); } catch (e) { console.warn('[outbox] worker failed to start:', e.message); }
  try { require('./lib/socket').initSocket(httpServer); } catch (e) { console.warn('[socket] failed to start:', e.message); }
});

module.exports = app;
