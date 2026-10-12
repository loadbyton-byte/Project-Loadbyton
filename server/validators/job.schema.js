const db = require('../db');
const { jobCode, isUniqueViolation } = require('../lib/http');
const { EQUIPMENT_TYPES, CARGO_TYPES, SHIPMENT_TYPES, TERMS_VERSION, PAYMENT_TERMS } = require('../lib/constants');
const { isValidUaeLatLng } = require('../lib/helpers');

// jobs.ready_at / jobs.deadline are TEXT columns, so the database itself
// accepts any string ("tomorrow"). Everything downstream — sort order,
// detention/demurrage clocks, auto-release, the scheduled-post sweep — parses
// them as dates, so a bad value used to be stored happily and then broke
// those later, far from the post that caused it. Parse and normalise to ISO
// 8601 here, at the one place that can reject it with a useful message.
function parseDateField(raw, name) {
  const d = new Date(raw);
  if (typeof raw !== 'string' || !raw.trim() || Number.isNaN(d.getTime())) {
    throw { status: 400, message: `${name} must be a valid date and time` };
  }
  return d;
}

async function createJobFromBody(body, req) {
  // T&C acceptance, per job — but only re-prompt if the shipper hasn't
  // already agreed to the CURRENT terms version at all (signup or a
  // previous job), to avoid checkbox fatigue on every single post/import
  // row. A returning shipper on the current version needs no explicit
  // flag; a brand-new shipper, or one whose last acceptance predates a
  // terms bump, must send agreedToTerms: true or the job is rejected.
  const alreadyAgreedToCurrentVersion = await db.prepare(
    `SELECT 1 FROM terms_acceptances WHERE user_id=? AND terms_version=? LIMIT 1`
  ).get(req.user.id, TERMS_VERSION);
  if (!alreadyAgreedToCurrentVersion && !body.agreedToTerms) {
    throw { status: 400, message: 'You must agree to the current Terms & Conditions before posting a job' };
  }

  let {
    shipmentType, containerSize, containerType, containerCount,
    pickupTerminal, deliveryArea, deliveryAddress,
    readyAt, deadline, targetPriceAed, notes,
    truckCount, cargoWeightTons,
    pickupLat, pickupLng, pickupAddressDetail,
    deliveryLat, deliveryLng, deliveryAddressDetail,
    equipmentType, cargoType, loadingLocation, deliveryLocation,
    importPickupTerminal, importUnloadingLocation, importEmptyReturnLocation,
    exportEmptyPickupLocation, exportLoadingLocation, exportDepositTerminal,
    scheduledPostAt, requiresSeal, lineItems, cargoValueAed, insuranceOptIn,
  } = body;

  // Multi-container-type support: lineItems[0] (when present) becomes the
  // job's own container_size/type/count columns — the "line item 1" record
  // every existing consumer already reads directly — anything beyond that
  // goes into job_line_items. Omitting lineItems entirely keeps the exact
  // pre-existing single-container behavior.
  const normalizedLineItems = Array.isArray(lineItems)
    ? lineItems
        .map((li) => ({
          containerSize: li && li.containerSize,
          containerType: li && li.containerType,
          count: Math.max(1, Number(li && li.count) || 1),
        }))
        .filter((li) => li.containerSize && li.containerType)
    : [];
  if (normalizedLineItems.length > 0) {
    containerSize = normalizedLineItems[0].containerSize;
    containerType = normalizedLineItems[0].containerType;
    containerCount = normalizedLineItems[0].count;
  }

  const shipType = (shipmentType || 'LOCAL').toUpperCase();
  // For LOCAL jobs, loadingLocation/deliveryLocation map to pickupTerminal/deliveryArea
  const effectivePickupTerminal = pickupTerminal || (shipType === 'LOCAL' ? loadingLocation : null);
  const effectiveDeliveryArea = deliveryArea || (shipType === 'LOCAL' ? deliveryLocation : null);

  if (!effectivePickupTerminal) throw { status: 400, message: 'pickupTerminal is required' };
  if (!effectiveDeliveryArea && !deliveryAddress) throw { status: 400, message: 'deliveryArea or deliveryAddress is required' };
  // jobs.ready_at / jobs.deadline are both NOT NULL, and the CSV bulk-import
  // path (POST /api/jobs/import loops this same function per row) and direct
  // API callers have no client-side guard — this is the one place that can
  // enforce it before the INSERT.
  if (!readyAt) throw { status: 400, message: 'readyAt is required' };
  if (!deadline) throw { status: 400, message: 'deadline is required' };
  const readyDate = parseDateField(readyAt, 'readyAt');
  const deadlineDate = parseDateField(deadline, 'deadline');
  if (deadlineDate.getTime() <= readyDate.getTime()) throw { status: 400, message: 'deadline must be after readyAt' };
  if (deadlineDate.getTime() <= Date.now()) throw { status: 400, message: 'deadline is already in the past — pick a later ready time' };

  // Unknown/legacy equipment or cargo values (older API clients and saved CSVs
  // still send e.g. "FLATBED") fall back to the defaults rather than blocking
  // the post.
  const eqType = EQUIPMENT_TYPES.includes(equipmentType) ? equipmentType : 'CONTAINER_CHASSIS';
  const cgType = CARGO_TYPES.includes(cargoType) ? cargoType : 'GENERAL_GOODS';

  if (!SHIPMENT_TYPES.includes(shipType)) throw { status: 400, message: `shipmentType must be one of: ${SHIPMENT_TYPES.join(', ')}` };

  if (cargoWeightTons !== undefined && cargoWeightTons !== null && Number(cargoWeightTons) <= 0) throw { status: 400, message: 'cargoWeightTons must be positive' };

  // LOCAL-shipment truck specs — both optional and meaningless outside LOCAL
  // jobs, so no requirement beyond "if present, must be valid".
  const { truckLengthM, equipmentBodyType } = body;
  const hasTruckLength = truckLengthM !== undefined && truckLengthM !== null && truckLengthM !== '';
  if (hasTruckLength && !(Number.isFinite(Number(truckLengthM)) && Number(truckLengthM) > 0)) {
    throw { status: 400, message: 'truckLengthM must be a positive number' };
  }
  if (equipmentBodyType && !['OPEN', 'COVERED'].includes(equipmentBodyType)) {
    throw { status: 400, message: 'equipmentBodyType must be OPEN or COVERED' };
  }

  if (eqType === 'CUSTOM' && !notes && !body.customRequirement) throw { status: 400, message: 'CUSTOM equipment requires a written requirement (notes or customRequirement)' };

  const effectiveNotes = body.customRequirement ? (notes ? `${notes}\n\nCustom requirement: ${body.customRequirement}` : body.customRequirement) : notes;

  // jobs.container_size / jobs.container_type are both NOT NULL. LOCAL
  // shipments never carry a container, hence the 'N/A' fallback below — but
  // IMPORT/EXPORT genuinely need one.
  if (shipType !== 'LOCAL' && (!containerSize || !containerType)) {
    throw { status: 400, message: 'containerSize and containerType are required for IMPORT/EXPORT shipments' };
  }
  const effectiveContainerSize = containerSize || (shipType === 'LOCAL' ? 'N/A' : null);
  const effectiveContainerType = containerType || (shipType === 'LOCAL' ? 'N/A' : null);
  // jobs.delivery_address is NOT NULL — the web form's "Delivery address
  // detail" field is optional for IMPORT/EXPORT, so fall back to the
  // delivery area (the check above guarantees at least one is set).
  const effectiveDeliveryAddress = deliveryAddress || effectiveDeliveryArea;

  // Declared cargo value / insurance opt-in. These used to be validated
  // AFTER the job row was inserted, so a bad value returned a 400 while the
  // job was already live in Open Loads — the shipper saw an error, fixed the
  // field, re-posted, and ended up with a ghost duplicate. Everything that
  // can reject the request now runs before the first write.
  let declaredCargoValue = null;
  if (cargoValueAed !== undefined && cargoValueAed !== null && cargoValueAed !== '') {
    declaredCargoValue = Number(cargoValueAed);
    if (!Number.isFinite(declaredCargoValue) || declaredCargoValue <= 0) throw { status: 400, message: 'cargoValueAed must be a positive number' };
  } else if (insuranceOptIn) {
    throw { status: 400, message: 'cargoValueAed is required when opting into insurance' };
  }

  let scheduledAt = null;
  if (scheduledPostAt) {
    scheduledAt = parseDateField(scheduledPostAt, 'scheduledPostAt');
  }
  const initialStatus = scheduledAt && scheduledAt.getTime() > Date.now() ? 'DRAFT' : 'OPEN';

  // Map pins are optional: keep a lat/lng pair only when both halves are
  // valid UAE coordinates, otherwise store neither (never a lone half).
  const pickupPin = isValidUaeLatLng(Number(pickupLat), Number(pickupLng)) && pickupLat !== null && pickupLng !== null;
  const deliveryPin = isValidUaeLatLng(Number(deliveryLat), Number(deliveryLng)) && deliveryLat !== null && deliveryLng !== null;

  const resolvedPaymentTier = PAYMENT_TERMS.includes(body.paymentTier) ? body.paymentTier : 'INSTANT';
  // requires_seal: no existing field reliably implies sealed-vs-empty — defaults
  // by shipment type (IMPORT/EXPORT typically sealed customs containers, LOCAL
  // typically not), overridable by the shipper.
  const effectiveRequiresSeal = requiresSeal !== undefined ? (requiresSeal ? 1 : 0) : (shipType === 'LOCAL' ? 0 : 1);

  // A job created by a demo (investor-showcase) shipper account must itself
  // be flagged is_demo so it stays inside the demo/real partition enforced
  // by job.service.js's listJobs and the other filters in
  // server/migrations/003_demo_data_flag.sql.
  //
  // Every write below happens in ONE transaction: the job row (including its
  // payment tier, truck specs, seal flag and declared cargo value, which used
  // to be follow-up UPDATEs), the extra line items and the terms-acceptance
  // record either all land or none do — no half-configured job is ever left
  // live in Open Loads if a later step fails.
  //
  // job_code is UNIQUE and only 9,000 four-digit codes exist per month, so a
  // collision is a normal event, not an error: retry with a fresh code (the
  // later attempts use a wider suffix) instead of surfacing a 500 to the
  // shipper. Each attempt is its own transaction because a failed INSERT
  // aborts a Postgres transaction.
  const MAX_CODE_ATTEMPTS = 8;
  let jobId;
  for (let attempt = 0; ; attempt++) {
    const code = jobCode(attempt);
    try {
      jobId = await db.transaction(async (trx) => {
        const result = await trx.prepare(
          `INSERT INTO jobs (job_code, shipper_id, status, shipment_type, equipment_type, cargo_type, container_size, container_type, container_count,
             pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, notes,
             truck_count, cargo_weight_tons, pickup_lat, pickup_lng, pickup_address_detail,
             delivery_lat, delivery_lng, delivery_address_detail, loading_location, delivery_location,
             import_pickup_terminal, import_unloading_location, import_empty_return_location,
             export_empty_pickup_location, export_loading_location, export_deposit_terminal,
             scheduled_post_at, is_demo, payment_tier, truck_length_m, equipment_body_type, requires_seal,
             cargo_value_aed, insurance_opt_in)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           RETURNING id`
        ).run(
          code,
          req.user.id,
          initialStatus,
          shipType,
          eqType,
          cgType,
          effectiveContainerSize,
          effectiveContainerType,
          Math.max(1, Number(containerCount) || 1),
          effectivePickupTerminal,
          effectiveDeliveryArea || null,
          effectiveDeliveryAddress || null,
          readyDate.toISOString(),
          deadlineDate.toISOString(),
          targetPriceAed ? Number(targetPriceAed) : null,
          effectiveNotes || null,
          Math.max(1, Number(truckCount) || 1),
          cargoWeightTons ? Number(cargoWeightTons) : null,
          pickupPin ? Number(pickupLat) : null,
          pickupPin ? Number(pickupLng) : null,
          pickupAddressDetail || null,
          deliveryPin ? Number(deliveryLat) : null,
          deliveryPin ? Number(deliveryLng) : null,
          deliveryAddressDetail || null,
          loadingLocation || null,
          deliveryLocation || null,
          importPickupTerminal || null,
          importUnloadingLocation || null,
          importEmptyReturnLocation || null,
          exportEmptyPickupLocation || null,
          exportLoadingLocation || null,
          exportDepositTerminal || null,
          scheduledAt ? scheduledAt.toISOString() : null,
          req.user.is_demo ? 1 : 0,
          resolvedPaymentTier,
          hasTruckLength ? Number(truckLengthM) : null,
          equipmentBodyType || null,
          effectiveRequiresSeal,
          declaredCargoValue,
          declaredCargoValue !== null && insuranceOptIn ? 1 : 0,
        );
        const newId = Number(result.lastInsertRowid);

        // Extra line items beyond the first (which became the job's own
        // container_size/type/count above).
        for (const li of normalizedLineItems.slice(1)) {
          await trx.prepare('INSERT INTO job_line_items (job_id, container_size, container_type, count) VALUES (?,?,?,?)')
            .run(newId, li.containerSize, li.containerType, li.count);
        }
        if (!alreadyAgreedToCurrentVersion) {
          const { byIp } = require('../lib/rateLimit');
          await trx.prepare(
            `INSERT INTO terms_acceptances (user_id, terms_version, context, job_id, ip_address) VALUES (?,?,'JOB',?,?)`
          ).run(req.user.id, TERMS_VERSION, newId, byIp(req) || null);
        }
        return newId;
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e, 'job_code') && attempt + 1 < MAX_CODE_ATTEMPTS) continue;
      throw e;
    }
  }

  // Change 30 — priority placement: optional paid boost at posting. Recorded
  // as a platform_fees + ledger row via chargeFee() (idempotent per job);
  // collection rides existing rails (internal bookkeeping until billing).
  // Deliberately outside the transaction above: a failed charge must never
  // undo (or hold back) the job itself.
  if (body.priorityPlacement) {
    try {
      const { chargeFee } = require('../lib/ledger');
      const { getSettings } = require('../lib/helpers');
      const { priority_placement_fee_aed } = await getSettings();
      const feeAed = Number(priority_placement_fee_aed) || 50;
      await chargeFee(db, {
        idempotencyKey: `priority-${jobId}`, feeCode: 'PRIORITY_PLACEMENT',
        jobId, userId: req.user.id, amountAed: feeAed,
        description: `Priority placement fee (job #${jobId}) AED ${feeAed}`,
      });
      // The actual boost the fee pays for — 6h ahead of other jobs in every
      // Open Loads sort (lib/constants.js's JOB_SORT_COLUMNS). Only set
      // after the charge succeeds, so a failed charge never boosts for free.
      await db.prepare(`UPDATE jobs SET priority_boost_until=datetime('now', '+6 hours') WHERE id=?`).run(jobId);
    } catch (e) { console.error(`[fees] priority charge failed for job ${jobId}:`, e.message); }
  }

  return await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

module.exports = { createJobFromBody };
