// @ts-check
/**
 * @typedef {import('../types/domain').Money} Money
 * @typedef {import('../types/domain').Job} Job
 * @typedef {import('../types/domain').Payout} Payout
 */

/**
 * @param {Job} _job
 * @param {Payout} _payout
 * @param {Money} _money
 * @returns {void}
 */
function _strictTypeRefs(_job, _payout, _money) {}

/** @type {any} */
const zodMod = require('zod');
const z = /** @type {any} */ (zodMod).z;

/**
 * @param {any} schema
 * @param {{ plain?: boolean }} [opts] plain: the schema's messages already name the field
 *   ("Target price must be greater than 0"), so don't prefix them with the raw key.
 * @returns {any}
 */
function validate(schema, opts) {
  const plain = !!(opts && opts.plain);
  return (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    const result = /** @type {any} */ (schema.safeParse(req.body));
    if (!result.success) {
      const issues = /** @type {any} */ (result.error.issues || result.error.errors || []);
      const msg = issues
        .map((/** @type {any} */ e) => {
          const path = Array.isArray(e.path) ? e.path.join('.') : '';
          return path && !plain ? `${path}: ${e.message}` : e.message;
        })
        .join('; ');
      const message = msg || 'Validation failed';
      // Migrated to new envelope: keep _legacy for old clients checking body.error as string
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_FAILED', message },
        _legacy: { error: message },
        message,
        code: 'VALIDATION_FAILED',
        requestId: req.requestId || null,
      });
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Schemas — defence-in-depth on top of the existing inline checks. These
// reject obviously malformed payloads with precise 400s before the handler
// touches the database, without changing the happy-path behaviour.
// ---------------------------------------------------------------------------

const registerSchema = z
  .object({
    email: z.string().email('invalid email format'),
    password: z.string().min(8, 'password must be at least 8 characters'),
    role: z.enum(['SHIPPER', 'CARRIER', 'FORWARDER', 'OWNER_OPERATOR', 'BROKER']),
    companyName: z.string().min(2, 'companyName must be at least 2 characters').max(200),
    phone: z.string().min(9, 'phone is required'),
    trnNumber: z.string().regex(/^\d{15}$/, 'trnNumber must be exactly 15 digits'),
    tradeLicenseNumber: z.string().min(5).max(15),
    referralCode: z.string().optional(),
  })
  .passthrough();

// A form that leaves an optional field blank sends "" (or null) for it, and a
// number input the user cleared sends "" too. z.coerce.number() turns both
// into 0, which then failed `.positive()` / `.min(22)` with a message like
// "pickupLat: Too small: expected number to be >=22" — an error no shipper
// can act on, on a field they never touched. Blank means "not provided".
const blankToUndefined = (v) => (v === '' || v === null ? undefined : v);

/** Optional number: blank/null -> omitted; otherwise must be a finite number within [min, max]. */
function optNumber(label, { min, max, int = false, positive = false } = {}) {
  let n = z.coerce.number({ error: `${label} must be a number` }).refine((v) => Number.isFinite(v), `${label} must be a number`);
  if (int) n = n.refine((v) => Number.isInteger(v), `${label} must be a whole number`);
  if (positive) n = n.refine((v) => v > 0, `${label} must be greater than 0`);
  if (min !== undefined) n = n.refine((v) => v >= min, `${label} must be at least ${min}`);
  if (max !== undefined) n = n.refine((v) => v <= max, `${label} must be at most ${max.toLocaleString('en-US')}`);
  return z.preprocess(blankToUndefined, n.optional());
}

/** Optional string: null -> omitted; non-strings are rejected with a readable message. */
function optString(label, max) {
  let str = z.string({ error: `${label} must be text` });
  if (max) str = str.max(max, `${label} must be ${max} characters or fewer`);
  return z.preprocess(blankToUndefined, str.optional());
}

// Map-pin coordinates are optional enrichment on top of the address text (the
// address is the real data). A pin that is blank, non-numeric or outside the
// UAE is dropped instead of failing the whole post — the shipper can't see or
// fix a hidden coordinate, and createJobFromBody keeps the lat/lng pair
// together (both or neither).
const optCoord = (min, max) => z.preprocess((v) => {
  v = blankToUndefined(v);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}, z.number().optional());

const jobCreateSchema = z
  .object({
    shipmentType: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : blankToUndefined(v)),
      z.enum(['IMPORT', 'EXPORT', 'LOCAL'], { error: 'shipmentType must be IMPORT, EXPORT or LOCAL' }).optional()
    ),
    containerSize: optString('containerSize'),
    containerType: optString('containerType'),
    containerCount: optNumber('Number of containers', { int: true, positive: true, max: 100 }),
    pickupTerminal: optString('Pickup location', 200),
    deliveryArea: optString('Delivery area', 200),
    deliveryAddress: optString('Delivery address', 500),
    readyAt: optString('readyAt'),
    deadline: optString('deadline'),
    targetPriceAed: optNumber('Target price', { positive: true, max: 1_000_000 }),
    notes: optString('Notes', 5000),
    truckCount: optNumber('Number of trucks', { int: true, positive: true, max: 100 }),
    cargoWeightTons: optNumber('Cargo weight', { positive: true, max: 1000 }),
    pickupLat: optCoord(22, 27),
    pickupLng: optCoord(51, 57),
    deliveryLat: optCoord(22, 27),
    deliveryLng: optCoord(51, 57),
    equipmentType: optString('equipmentType'),
    loadingLocation: optString('Loading location', 200),
    deliveryLocation: optString('Delivery location', 200),
    scheduledPostAt: optString('scheduledPostAt'),
  })
  .passthrough();

const bidCreateSchema = z
  .object({
    amount: z.coerce.number().positive().max(1_000_000),
    currency: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .passthrough();

module.exports = { validate, registerSchema, jobCreateSchema, bidCreateSchema };
