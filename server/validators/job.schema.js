const db = require('../db');
const { randomToken, jobCode } = require('../lib/http');
const { EQUIPMENT_TYPES, CARGO_TYPES, SHIPMENT_TYPES, DEPOTS, CONTAINER_EQUIPMENT, TERMS_VERSION } = require('../lib/constants');
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

  const {
    shipmentType, containerSize, containerType, containerCount,
    pickupTerminal, deliveryArea, deliveryAddress,
    readyAt, deadline, targetPriceAed, notes,
    truckCount, cargoWeightTons,
    pickupLat, pickupLng, pickupAddressDetail,
    deliveryLat, deliveryLng, deliveryAddressDetail,
    equipmentType, cargoType, loadingLocation, deliveryLocation,
    importPickupTerminal, importUnloadingLocation, importEmptyReturnLocation,
    exportEmptyPickupLocation, exportLoadingLocation, exportDepositTerminal,
    scheduledPostAt, requiresSeal,
  } = body;

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

  // payment_tier: not yet exposed in the job-posting UI or gated by any
  // eligibility check (that's separate, not-yet-built work) — accepted
  // here mainly so the tier logic in award.service.js/job.service.js is
  // exercisable and testable. jobs.payment_tier already defaults to
  // SPOT_ESCROW at the schema level, so an omitted/invalid value here is
  // simply left at that default rather than validated as an error.
  const { paymentTier } = body;
  const VALID_PAYMENT_TIERS = ['SPOT_ESCROW', 'PAY_ON_DELIVERY', 'CONTRACT_CREDIT', 'OFF_PLATFORM'];
  if (paymentTier && VALID_PAYMENT_TIERS.includes(paymentTier) && paymentTier !== 'SPOT_ESCROW') {
    await db.prepare('UPDATE jobs SET payment_tier=? WHERE id=?').run(paymentTier, jobId);
  }
  if (!alreadyAgreedToCurrentVersion) {
    const { byIp } = require('../lib/rateLimit');
    await db.prepare(
      `INSERT INTO terms_acceptances (user_id, terms_version, context, job_id, ip_address) VALUES (?,?,'JOB',?,?)`
    ).run(req.user.id, TERMS_VERSION, jobId, byIp(req) || null);
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

  return await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

module.exports = { createJobFromBody };
