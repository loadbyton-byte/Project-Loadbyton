// Compliance-engine foundation for the future DRIVER_ASSOCIATE role
// (register Change 25) — built first, since that role's own guardrails
// ("no private plates," "auto-pause on expired documents") depend on this
// existing. Rules are stored as data in compliance_rules (server/schema.js)
// so admins can tune severity/enable-disable without a deploy; six of the
// eight seeded rules are purely declarative (field + condition), the two
// YELLOW ones need two facts together and are evaluated as special cases
// (still toggled via is_active on their compliance_rules row, so an admin
// can still turn either off).
const db = require('../db');
const { TERMINAL_EMIRATE, AREA_EMIRATE } = require('./constants');

function isExpired(dateStr) {
  // No data on file yet is a "missing/incomplete onboarding" concern, not
  // an "expired" one — don't let an unset date read as a RED expiry.
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function getFieldValue(field, driver, vehicle) {
  const [scope, key] = field.split('.');
  if (scope === 'driver') return driver ? driver[key] : undefined;
  if (scope === 'vehicle') return vehicle ? vehicle[key] : undefined;
  return undefined;
}

function evalCondition(condition, value) {
  switch (condition.op) {
    case 'eq': return value === condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
    case 'expired': return isExpired(value);
    default: return false;
  }
}

function jobEmirate(job) {
  if (!job) return null;
  return TERMINAL_EMIRATE[job.pickup_terminal] || AREA_EMIRATE[job.delivery_area] || null;
}

/**
 * @param {any} driver - a drivers row, or null (pattern C: driver with no fixed carrier record yet)
 * @param {any} vehicle - a vehicles row, or null (pattern C: driver with no truck of their own)
 * @param {any} job - a jobs row, or null (a signup-time check has no job yet)
 * @param {any} carrierProfile - the carrier's profiles row, for the compound checks
 * @returns {Promise<{ pass: boolean, blockers: Array<{rule_code:string, description:string}>, warnings: Array<{rule_code:string, description:string}> }>}
 */
async function evaluateCompliance(driver, vehicle, job, carrierProfile) {
  const rules = await db.prepare('SELECT * FROM compliance_rules WHERE is_active=1').all();
  const blockers = [];
  const warnings = [];

  for (const rule of rules) {
    let condition;
    try { condition = JSON.parse(rule.condition); } catch { continue; }

    let fires = false;
    if (rule.field === 'special:mainland_permit') {
      fires = !!(carrierProfile && carrierProfile.is_free_zone_registered && !carrierProfile.mainland_work_permitted);
    } else if (rule.field === 'special:permitted_emirates') {
      const emirate = jobEmirate(job);
      const allowed = vehicle && vehicle.permitted_emirates ? JSON.parse(vehicle.permitted_emirates) : null;
      fires = !!(emirate && Array.isArray(allowed) && allowed.length && !allowed.includes(emirate));
    } else {
      const value = getFieldValue(rule.field, driver, vehicle);
      fires = evalCondition(condition, value);
    }

    if (!fires) continue;
    const entry = { rule_code: rule.rule_code, description: rule.description };
    if (rule.severity === 'RED') blockers.push(entry);
    else warnings.push(entry);
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

module.exports = { evaluateCompliance };
