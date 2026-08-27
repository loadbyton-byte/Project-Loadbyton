const app = require('./app');
const { PORT } = require('./lib/config');

app.listen(PORT, () => {
  console.log(`Loadbyton API listening on :${PORT}`);
  if (!process.env.INTERNAL_KEY) {
    const level = process.env.NODE_ENV === 'production' ? 'WARNING' : 'note';
    console.log(`[${level}] INTERNAL_KEY not set — generated a random one for this process only. It will change on every restart/redeploy. Set INTERNAL_KEY in the environment if anything external calls POST /api/system/auto-release.`);
  } else {
    console.log('INTERNAL_KEY is set from the environment.');
  }
  require('./seed')();
  if (process.env.SEED_DEMO_ACCOUNTS !== '0') {
    try { require('./seed').ensureDemoLogins(); } catch (e) {
      console.log(`[warning] ensureDemoLogins failed: ${e.message}`);
    }
  }
  // Outbox worker — reliable delivery of post-transaction side-effects (notifications, ledger fanout)
  try { require('./workers/outbox.worker').startOutboxWorker(); } catch (e) { console.warn('[outbox] worker failed to start:', e.message); }
});

module.exports = app;
