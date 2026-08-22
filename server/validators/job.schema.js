const crypto = require('node:crypto');
const db = require('../db');
const { jobCode } = require('../lib/http');
const {
  CONTAINER_SIZES, CONTAINER_TYPES, EQUIPMENT_TYPES, CONTAINER_EQUIPMENT, SHIPMENT_TYPES,
} = require('../lib/constants');
const { isValidUaeLatLng, writeAudit } = require('../lib/helpers');

// Shared by POST /api/jobs and the CSV-import loop in POST /api/jobs/import
// below, so both paths validate and insert identically — throws
// { status, message } (matching sendError's shape) on any validation
// failure instead of writing to res directly, so the caller decides whether
// that's a single 400 or one row in a bulk-import report.
function createJobFromBody(b, req) {
  // Shipment direction — IMPORT (terminal -> customer -> depot) vs EXPORT (depot -> shipper -> terminal)
  // Backward compat: old clients send no shipmentType, treat as IMPORT with legacy fields.
  const rawShipmentType = b.shipmentType || b.shipment_type || null;
  const shipmentType = rawShipmentType ? String(rawShipmentType).toUpperCase() : null;
  if (shipmentType && !SHIPMENT_TYPES.includes(shipmentType)) throw { status: 400, message: 'shipmentType must be IMPORT, EXPORT or LOCAL' };
  const effectiveShipmentType = shipmentType || 'IMPORT';

  // Leg fields — support both camelCase (web) and snake_case (CSV/db)
  const importPickupTerminal = b.importPickupTerminal || b.import_pickup_terminal || null;
  const importUnloadingLocation = b.importUnloadingLocation || b.import_unloading_location || null;
  const importEmptyReturnLocation = b.importEmptyReturnLocation || b.import_empty_return_location || null;
  const exportEmptyPickupLocation = b.exportEmptyPickupLocation || b.export_empty_pickup_location || null;
  const exportLoadingLocation = b.exportLoadingLocation || b.export_loading_location || null;
  const exportDepositTerminal = b.exportDepositTerminal || b.export_deposit_terminal || null;

  // Validate legs when shipmentType is explicitly provided (new UI); legacy payloads without
  // shipmentType bypass leg validation to keep existing tests and CSV imports working.
  const loadingLocation = b.loadingLocation || null;
  const deliveryLocation = b.deliveryLocation || null;

  // Scheduled ("post later") — future timestamp keeps the job in DRAFT; the
  // sweep flips it to OPEN at the chosen time. Past/absent posts immediately.
  let scheduledPostAt = b.scheduledPostAt ? new Date(b.scheduledPostAt) : null;
  if (scheduledPostAt && isNaN(scheduledPostAt.getTime())) throw { status: 400, message: 'scheduledPostAt must be a valid date/time' };
  const isScheduled = Boolean(scheduledPostAt && scheduledPostAt.getTime() > Date.now() + 60000);

  if (shipmentType) {
    if (effectiveShipmentType === 'LOCAL') {
      if (!loadingLocation) throw { status: 400, message: 'loadingLocation is required for LOCAL' };
      if (!deliveryLocation) throw { status: 400, message: 'deliveryLocation is required for LOCAL' };
    } else if (effectiveShipmentType === 'IMPORT') {
      if (!importPickupTerminal) throw { status: 400, message: 'importPickupTerminal is required for IMPORT' };
      if (!importUnloadingLocation) throw { status: 400, message: 'importUnloadingLocation is required for IMPORT' };
      if (!importEmptyReturnLocation) throw { status: 400, message: 'importEmptyReturnLocation is required for IMPORT (empty container return depot)' };
    } else {
      if (!exportEmptyPickupLocation) throw { status: 400, message: 'exportEmptyPickupLocation is required for EXPORT (where empty is picked up)' };
      if (!exportLoadingLocation) throw { status: 400, message: 'exportLoadingLocation is required for EXPORT (where cargo is loaded)' };
      if (!exportDepositTerminal) throw { status: 400, message: 'exportDepositTerminal is required for EXPORT (port/terminal for deposit)' };
    }
  }

  // Legacy required fields — auto-backfill from legs for new jobs so old readers (OpenLoads, JobDetail)
  // still see pickup_terminal/delivery_area. New jobs should send both, but we don't break if they don't.
  let pickupTerminal = b.pickupTerminal;
  let deliveryArea = b.deliveryArea;
  let deliveryAddress = b.deliveryAddress;
  if (shipmentType) {
    if (effectiveShipmentType === 'IMPORT') {
      pickupTerminal = pickupTerminal || importPickupTerminal;
      deliveryArea = deliveryArea || importUnloadingLocation;
      deliveryAddress = deliveryAddress || importUnloadingLocation;
    } else {
      pickupTerminal = pickupTerminal || exportDepositTerminal;
      deliveryArea = deliveryArea || exportLoadingLocation;
      deliveryAddress = deliveryAddress || exportLoadingLocation;
    }
    if (effectiveShipmentType === 'LOCAL') {
      pickupTerminal = pickupTerminal || loadingLocation;
      deliveryArea = deliveryArea || deliveryLocation;
      deliveryAddress = deliveryAddress || deliveryLocation;
    }
  }
  const required = ['pickupTerminal', 'deliveryArea', 'deliveryAddress', 'readyAt', 'deadline'];
  // Use the backfilled values for validation
  const legacyCheck = { pickupTerminal, deliveryArea, deliveryAddress, readyAt: b.readyAt, deadline: b.deadline };
  for (const f of required) if (!legacyCheck[f]) throw { status: 400, message: `${f} is required` };

  const equipmentType = EQUIPMENT_TYPES.includes(b.equipmentType) ? b.equipmentType : 'CONTAINER_CHASSIS';
  const needsContainer = CONTAINER_EQUIPMENT.includes(equipmentType);

  let containerSize = 'N/A';
  let containerType = 'GENERAL';
  if (needsContainer) {
    if (!b.containerSize || !CONTAINER_SIZES.includes(b.containerSize)) throw { status: 400, message: 'Invalid containerSize' };
    if (!b.containerType || !CONTAINER_TYPES.includes(b.containerType)) throw { status: 400, message: 'Invalid containerType' };
    containerSize = b.containerSize;
    containerType = b.containerType;
  } else if (!b.notes && !b.customRequirement) {
    throw { status: 400, message: 'cargoDescription (notes) is required for non-container equipment' };
  }
  // CUSTOM equipment carries a written requirement — merged into notes so
  // downstream consumers (backload matching, messages, notifications) all
  // keep working without knowing about the field.
  const notes = b.customRequirement && !b.notes ? b.customRequirement : b.notes;

  const containerCount = Math.max(1, Number(b.containerCount) || 1);
  const truckCount = Math.max(1, Number(b.truckCount) || 1);

  // Optional cargo weight (metric tons) — drives carrier equipment choice.
  const cargoWeightTons = b.cargoWeightTons === undefined || b.cargoWeightTons === null || b.cargoWeightTons === '' ? null : Number(b.cargoWeightTons);
  if (cargoWeightTons !== null && (!Number.isFinite(cargoWeightTons) || cargoWeightTons <= 0 || cargoWeightTons > 500)) {
    throw { status: 400, message: 'cargoWeightTons must be a positive number up to 500' };
  }

  // Optional map pin (see LocationPicker.jsx) — reject silently-wrong values
  // rather than trusting whatever the client sends, same as any other field.
  const pickupLat = b.pickupLat !== undefined ? Number(b.pickupLat) : null;
  const pickupLng = b.pickupLng !== undefined ? Number(b.pickupLng) : null;
  if ((pickupLat !== null || pickupLng !== null) && !isValidUaeLatLng(pickupLat, pickupLng)) {
    throw { status: 400, message: 'pickupLat/pickupLng must be valid UAE coordinates' };
  }
  const deliveryLat = b.deliveryLat !== undefined ? Number(b.deliveryLat) : null;
  const deliveryLng = b.deliveryLng !== undefined ? Number(b.deliveryLng) : null;
  if ((deliveryLat !== null || deliveryLng !== null) && !isValidUaeLatLng(deliveryLat, deliveryLng)) {
    throw { status: 400, message: 'deliveryLat/deliveryLng must be valid UAE coordinates' };
  }

  let code = jobCode();
  while (db.prepare('SELECT 1 FROM jobs WHERE job_code=?').get(code)) code = jobCode();

  const result = db
    .prepare(
      `INSERT INTO jobs (job_code, shipper_id, contract_lane_id, template_id, container_size, container_type, container_number,
         pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, status, escrow_status,
         notes, equipment_type, container_count, truck_count,
         cargo_weight_tons,
         pickup_lat, pickup_lng, pickup_address_detail, delivery_lat, delivery_lng, delivery_address_detail,
         shipment_type, import_pickup_terminal, import_unloading_location, import_empty_return_location,
         export_empty_pickup_location, export_loading_location, export_deposit_terminal,
         loading_location, delivery_location, scheduled_post_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      code,
      req.user.id,
      b.contractLaneId || null,
      b.templateId || null,
      containerSize,
      containerType,
      b.containerNumber || null,
      pickupTerminal,
      deliveryArea,
      deliveryAddress,
      b.readyAt,
      b.deadline,
      b.maxBudgetAed ?? b.targetPriceAed ?? null,
      isScheduled ? 'DRAFT' : 'OPEN',
      notes || null,
      equipmentType,
      containerCount,
      truckCount,
      cargoWeightTons,
      pickupLat,
      pickupLng,
      b.pickupAddressDetail || null,
      deliveryLat,
      deliveryLng,
      b.deliveryAddressDetail || null,
      effectiveShipmentType,
      importPickupTerminal || null,
      importUnloadingLocation || null,
      importEmptyReturnLocation || null,
      exportEmptyPickupLocation || null,
      exportLoadingLocation || null,
      exportDepositTerminal || null,
      effectiveShipmentType === 'LOCAL' ? loadingLocation : null,
      effectiveShipmentType === 'LOCAL' ? deliveryLocation : null,
      isScheduled ? scheduledPostAt.toISOString() : null
    );
  const jobId = Number(result.lastInsertRowid);
  writeAudit(req, { userId: req.actorId, action: 'JOB_CREATE', details: `${code} posted`, entityType: 'job', entityId: jobId, afterState: 'OPEN' });
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

module.exports = { createJobFromBody };