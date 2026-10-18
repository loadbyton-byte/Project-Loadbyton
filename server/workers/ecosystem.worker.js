// Periodic ecosystem work: reconcile grants (this is what moves a company out
// of its payment grace period) and deliver queued events to the Store.

'use strict';

const { logger } = require('../lib/logger');
const entitlements = require('../lib/ecosystem/entitlements');
const { deliverPending } = require('../lib/ecosystem/delivery');
const { backfillOrganisations } = require('../lib/ecosystem/orgs');

let sweepTimer = null;
let deliveryTimer = null;

function startEcosystemWorker({ sweepMs = 15 * 60 * 1000, deliveryMs = 15 * 1000 } = {}) {
  if (sweepTimer || process.env.NODE_ENV === 'test') return;
  const secret = process.env.ECOSYSTEM_SHARED_SECRET;
  if (secret && secret.length < 32) logger.error('ecosystem_weak_secret', { hint: 'ECOSYSTEM_SHARED_SECRET should be at least 32 random characters' });
  // Give existing accounts an organisation and subject id; idempotent.
  backfillOrganisations()
    .then((n) => logger.info('ecosystem_backfill', { organisations: n }))
    .catch((e) => logger.error('ecosystem_backfill_failed', { error: e.message }));
  sweepTimer = setInterval(() => {
    entitlements.sweep().catch((e) => logger.error('ecosystem_sweep_failed', { error: e.message }));
  }, sweepMs).unref();
  deliveryTimer = setInterval(() => {
    deliverPending().catch((e) => logger.error('ecosystem_delivery_failed', { error: e.message }));
  }, deliveryMs).unref();
  logger.info('ecosystem_worker_started', { sweepMs, deliveryMs });
}

function stopEcosystemWorker() {
  if (sweepTimer) clearInterval(sweepTimer);
  if (deliveryTimer) clearInterval(deliveryTimer);
  sweepTimer = deliveryTimer = null;
}

module.exports = { startEcosystemWorker, stopEcosystemWorker };
