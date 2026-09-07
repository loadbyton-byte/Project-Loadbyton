// Daily-ish compliance sweep for the DRIVER_ASSOCIATE compliance-engine
// foundation (register Change 25) — re-checks every active driver against
// evaluateCompliance(), warns at 30/7/1 days before any tracked expiry, and
// auto-pauses (drivers.is_active=0) the instant something is actually
// expired or otherwise a RED blocker, not just warned. Wired the same way
// as every other recurring sweep in this codebase (see
// server/routes/system.routes.js's runAutoReleaseSweep/publishScheduledJobs):
// an internal-key-gated HTTP endpoint plus an in-process setInterval.
const db = require('../db');
const { evaluateCompliance } = require('../lib/compliance');
const { notify } = require('../lib/helpers');

const WARNING_DAYS = [30, 7, 1];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

async function runComplianceSweep() {
  const drivers = await db.prepare('SELECT * FROM drivers WHERE is_active=1').all();
  let paused = 0;
  let warned = 0;

  for (const driver of drivers) {
    const vehicle = driver.vehicle_id ? await db.prepare('SELECT * FROM vehicles WHERE id=?').get(driver.vehicle_id) : null;
    const carrierProfile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(driver.carrier_id);
    const result = await evaluateCompliance(driver, vehicle, null, carrierProfile);

    if (!result.pass) {
      // Atomic claim — two concurrent sweep runs must not both fire the
      // pause notification for the same driver (matches the exactly-once
      // claim pattern used by every other sweep in this codebase).
      const claimed = await db.prepare(`UPDATE drivers SET is_active=0, updated_at=datetime('now') WHERE id=? AND is_active=1`).run(driver.id);
      if (claimed.changes) {
        paused++;
        await notify(
          driver.carrier_id,
          'Driver auto-paused — compliance',
          `${driver.name} was auto-paused: ${result.blockers.map((b) => b.description).join('; ')}`,
          null,
          'system'
        );
      }
      continue;
    }

    const checks = [
      ['visa', driver.visa_expiry],
      ['license', driver.license_expiry],
      ...(vehicle ? [['vehicle registration', vehicle.registration_expiry], ['vehicle insurance', vehicle.insurance_expiry]] : []),
    ];
    for (const [label, dateStr] of checks) {
      const d = daysUntil(dateStr);
      if (d !== null && WARNING_DAYS.includes(d)) {
        await notify(driver.carrier_id, 'Document expiring soon', `${driver.name}'s ${label} expires in ${d} day${d === 1 ? '' : 's'}.`, null, 'system');
        warned++;
      }
    }
  }

  return { checked: drivers.length, paused, warned };
}

module.exports = { runComplianceSweep };
