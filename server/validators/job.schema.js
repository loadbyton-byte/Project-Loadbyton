const db = require('../db');
const { randomToken, jobCode } = require('../lib/http');
const { EQUIPMENT_TYPES, CARGO_TYPES, SHIPMENT_TYPES, DEPOTS, CONTAINER_EQUIPMENT, TERMS_VERSION, PAYMENT_TERMS } = require('../lib/constants');
const { isValidUaeLatLng } = require('../lib/helpers');

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

  const eqType = EQUIPMENT_TYPES.includes(equipmentType) ? equipmentType : 'CONTAINER_CHASSIS';
  const cgType = CARGO_TYPES.includes(cargoType) ? cargoType : 'GENERAL_GOODS';

  if (!SHIPMENT_TYPES.includes(shipType)) throw { status: 400, message: `shipmentType must be one of: ${SHIPMENT_TYPES.join(', ')}` };

  if (cargoWeightTons !== undefined && cargoWeightTons !== null && Number(cargoWeightTons) <= 0) throw { status: 400, message: 'cargoWeightTons must be positive' };

  // LOCAL-shipment truck specs — validated here (before the INSERT below,
  // which isn't wrapped in a transaction) so a bad value never leaves an
  // orphaned job row behind; both optional and meaningless outside LOCAL
  // jobs, so no requirement beyond "if present, must be valid".
  const { truckLengthM, equipmentBodyType } = body;
  if (truckLengthM !== undefined && truckLengthM !== null && truckLengthM !== '' && !(Number.isFinite(Number(truckLengthM)) && Number(truckLengthM) > 0)) {
    throw { status: 400, message: 'truckLengthM must be a positive number' };
  }
  if (equipmentBodyType && !['OPEN', 'COVERED'].includes(equipmentBodyType)) {
    throw { status: 400, message: 'equipmentBodyType must be OPEN or COVERED' };
  }

  if (eqType === 'CUSTOM' && !notes && !body.customRequirement) throw { status: 400, message: 'CUSTOM equipment requires a written requirement (notes or customRequirement)' };

  const effectiveNotes = body.customRequirement ? (notes ? `${notes}\n\nCustom requirement: ${body.customRequirement}` : body.customRequirement) : notes;

  const effectiveContainerSize = containerSize || (shipType === 'LOCAL' ? 'N/A' : null);
  const effectiveContainerType = containerType || (shipType === 'LOCAL' ? 'N/A' : null);
  const effectiveDeliveryAddress = deliveryAddress || (shipType === 'LOCAL' ? (deliveryLocation || effectiveDeliveryArea) : null);

  const code = jobCode();
  const initialStatus = scheduledPostAt && new Date(scheduledPostAt) > new Date() ? 'DRAFT' : 'OPEN';
  // A job created by a demo (investor-showcase) shipper account must itself
  // be flagged is_demo so it stays inside the demo/real partition enforced
  // by job.service.js's listJobs and the other filters in
  // server/migrations/003_demo_data_flag.sql — otherwise it defaults to 0
  // and leaks into real carriers' Open Loads while being invisible to the
  // demo carrier it was meant for.
  const result = await db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, status, shipment_type, equipment_type, cargo_type, container_size, container_type, container_count,
       pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, notes,
       truck_count, cargo_weight_tons, pickup_lat, pickup_lng, pickup_address_detail,
       delivery_lat, delivery_lng, delivery_address_detail, loading_location, delivery_location,
       import_pickup_terminal, import_unloading_location, import_empty_return_location,
       export_empty_pickup_location, export_loading_location, export_deposit_terminal,
       scheduled_post_at, is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    readyAt || null,
    deadline || null,
    targetPriceAed ? Number(targetPriceAed) : null,
    effectiveNotes || null,
    Math.max(1, Number(truckCount) || 1),
    cargoWeightTons ? Number(cargoWeightTons) : null,
    pickupLat ? Number(pickupLat) : null,
    pickupLng ? Number(pickupLng) : null,
    pickupAddressDetail || null,
    deliveryLat ? Number(deliveryLat) : null,
    deliveryLng ? Number(deliveryLng) : null,
    deliveryAddressDetail || null,
    loadingLocation || null,
    deliveryLocation || null,
    importPickupTerminal || null,
    importUnloadingLocation || null,
    importEmptyReturnLocation || null,
    exportEmptyPickupLocation || null,
    exportLoadingLocation || null,
    exportDepositTerminal || null,
    scheduledPostAt || null,
    req.user.is_demo ? 1 : 0,
  );

  const jobId = Number(result.lastInsertRowid);

  // payment_tier: when a shipper is due to pay (see server/lib/constants.js's
  // PAYMENT_TERMS — escrow is an implementation detail, not a tier the
  // shipper picks by that name anymore). Not gated by credit eligibility
  // here — that check happens at award time (award.service.js), since
  // eligibility can change between posting and award. jobs.payment_tier's
  // column-level default is still the legacy 'SPOT_ESCROW' string (kept
  // to avoid an unnecessary migration; every service treats it as an
  // alias for INSTANT) — explicitly writing 'INSTANT' here instead keeps
  // every newly-created job's stored value and displayed label
  // consistent, rather than silently falling back to the old name.
  const { paymentTier } = body;
  const resolvedPaymentTier = PAYMENT_TERMS.includes(paymentTier) ? paymentTier : 'INSTANT';
  await db.prepare('UPDATE jobs SET payment_tier=? WHERE id=?').run(resolvedPaymentTier, jobId);
  if (!alreadyAgreedToCurrentVersion) {
    const { byIp } = require('../lib/rateLimit');
    await db.prepare(
      `INSERT INTO terms_acceptances (user_id, terms_version, context, job_id, ip_address) VALUES (?,?,'JOB',?,?)`
    ).run(req.user.id, TERMS_VERSION, jobId, byIp(req) || null);
  }

  // Already validated above (before the INSERT) — this is now just the
  // write, matching payment_tier's post-insert-UPDATE pattern below.
  if (truckLengthM !== undefined && truckLengthM !== null && truckLengthM !== '') {
    await db.prepare('UPDATE jobs SET truck_length_m=? WHERE id=?').run(Number(truckLengthM), jobId);
  }
  if (equipmentBodyType) {
    await db.prepare('UPDATE jobs SET equipment_body_type=? WHERE id=?').run(equipmentBodyType, jobId);
  }

  // requires_seal: no existing field reliably implies sealed-vs-empty (see
  // server/schema.js's comment) — defaults by shipment type (IMPORT/EXPORT
  // typically sealed customs containers, LOCAL typically not), overridable
  // by the shipper. The DB-level column default is 1, so only a LOCAL job
  // (or an explicit override) needs this follow-up UPDATE.
  const effectiveRequiresSeal = requiresSeal !== undefined ? (requiresSeal ? 1 : 0) : (shipType === 'LOCAL' ? 0 : 1);
  if (effectiveRequiresSeal !== 1) {
    await db.prepare('UPDATE jobs SET requires_seal=? WHERE id=?').run(effectiveRequiresSeal, jobId);
  }
  // Extra line items beyond the first (which became the job's own
  // container_size/type/count above).
  if (normalizedLineItems.length > 1) {
    const insertLineItem = db.prepare('INSERT INTO job_line_items (job_id, container_size, container_type, count) VALUES (?,?,?,?)');
    for (const li of normalizedLineItems.slice(1)) {
      await insertLineItem.run(jobId, li.containerSize, li.containerType, li.count);
    }
  }
  // GIT insurance opt-in (Change 20) — declared cargo value + flag at posting.
  // Binding itself is a separate step (POST /api/jobs/:id/insurance/bind);
  // this just records the shipper's declared value so quote/bind has it.
  if (cargoValueAed !== undefined && cargoValueAed !== null && cargoValueAed !== '') {
    const cv = Number(cargoValueAed);
    if (!Number.isFinite(cv) || cv <= 0) throw { status: 400, message: 'cargoValueAed must be a positive number' };
    await db.prepare('UPDATE jobs SET cargo_value_aed=?, insurance_opt_in=? WHERE id=?').run(cv, insuranceOptIn ? 1 : 0, jobId);
  } else if (insuranceOptIn) {
    throw { status: 400, message: 'cargoValueAed is required when opting into insurance' };
  }
  // Change 30 — priority placement: optional paid boost at posting. Recorded
  // as a platform_fees + ledger row via chargeFee() (idempotent per job);
  // collection rides existing rails (internal bookkeeping until billing).
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
