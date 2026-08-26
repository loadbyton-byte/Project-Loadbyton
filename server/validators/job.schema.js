const db = require('../db');
const { randomToken, jobCode } = require('../lib/http');
const { EQUIPMENT_TYPES, SHIPMENT_TYPES, DEPOTS, CONTAINER_EQUIPMENT } = require('../lib/constants');
const { isValidUaeLatLng } = require('../lib/helpers');

function createJobFromBody(body, req) {
  const {
    shipmentType, containerSize, containerType, containerCount,
    pickupTerminal, deliveryArea, deliveryAddress,
    readyAt, deadline, targetPriceAed, notes,
    truckCount, cargoWeightTons,
    pickupLat, pickupLng, pickupAddressDetail,
    deliveryLat, deliveryLng, deliveryAddressDetail,
    equipmentType, loadingLocation, deliveryLocation,
    importPickupTerminal, importUnloadingLocation, importEmptyReturnLocation,
    exportEmptyPickupLocation, exportLoadingLocation, exportDepositTerminal,
    scheduledPostAt,
  } = body;

  const shipType = (shipmentType || 'LOCAL').toUpperCase();
  // For LOCAL jobs, loadingLocation/deliveryLocation map to pickupTerminal/deliveryArea
  const effectivePickupTerminal = pickupTerminal || (shipType === 'LOCAL' ? loadingLocation : null);
  const effectiveDeliveryArea = deliveryArea || (shipType === 'LOCAL' ? deliveryLocation : null);

  if (!effectivePickupTerminal) throw { status: 400, message: 'pickupTerminal is required' };
  if (!effectiveDeliveryArea && !deliveryAddress) throw { status: 400, message: 'deliveryArea or deliveryAddress is required' };

  const eqType = EQUIPMENT_TYPES.includes(equipmentType) ? equipmentType : 'CONTAINER_CHASSIS';

  if (!SHIPMENT_TYPES.includes(shipType)) throw { status: 400, message: `shipmentType must be one of: ${SHIPMENT_TYPES.join(', ')}` };

  if (cargoWeightTons !== undefined && cargoWeightTons !== null && Number(cargoWeightTons) <= 0) throw { status: 400, message: 'cargoWeightTons must be positive' };

  if (eqType === 'CUSTOM' && !notes && !body.customRequirement) throw { status: 400, message: 'CUSTOM equipment requires a written requirement (notes or customRequirement)' };

  const effectiveNotes = body.customRequirement ? (notes ? `${notes}\n\nCustom requirement: ${body.customRequirement}` : body.customRequirement) : notes;

  const effectiveContainerSize = containerSize || (shipType === 'LOCAL' ? 'N/A' : null);
  const effectiveContainerType = containerType || (shipType === 'LOCAL' ? 'N/A' : null);
  const effectiveDeliveryAddress = deliveryAddress || (shipType === 'LOCAL' ? (deliveryLocation || effectiveDeliveryArea) : null);

  const code = jobCode();
  const initialStatus = scheduledPostAt && new Date(scheduledPostAt) > new Date() ? 'DRAFT' : 'OPEN';
  const result = db.prepare(
    `INSERT INTO jobs (job_code, shipper_id, status, shipment_type, equipment_type, container_size, container_type, container_count,
       pickup_terminal, delivery_area, delivery_address, ready_at, deadline, max_budget_aed, notes,
       truck_count, cargo_weight_tons, pickup_lat, pickup_lng, pickup_address_detail,
       delivery_lat, delivery_lng, delivery_address_detail, loading_location, delivery_location,
       import_pickup_terminal, import_unloading_location, import_empty_return_location,
       export_empty_pickup_location, export_loading_location, export_deposit_terminal,
       scheduled_post_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    code,
    req.user.id,
    initialStatus,
    shipType,
    eqType,
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
  );

  const jobId = Number(result.lastInsertRowid);
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
}

module.exports = { createJobFromBody };
