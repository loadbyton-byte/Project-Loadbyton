const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues || result.error.errors || [];
      const msg = issues
        .map((e) => {
          const path = Array.isArray(e.path) ? e.path.join('.') : '';
          return path ? `${path}: ${e.message}` : e.message;
        })
        .join('; ');
      return res.status(400).json({ error: msg || 'Validation failed' });
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
    role: z.enum(['SHIPPER', 'CARRIER']),
    companyName: z.string().min(2, 'companyName must be at least 2 characters').max(200),
    phone: z.string().min(9, 'phone is required'),
    trnNumber: z.string().regex(/^\d{15}$/, 'trnNumber must be exactly 15 digits'),
    tradeLicenseNumber: z.string().min(5).max(15),
    referralCode: z.string().optional(),
  })
  .passthrough();

const jobCreateSchema = z
  .object({
    shipmentType: z.enum(['IMPORT', 'EXPORT', 'LOCAL']).optional(),
    containerSize: z.string().optional(),
    containerType: z.string().optional(),
    containerCount: z.coerce.number().int().positive().max(100).optional(),
    pickupTerminal: z.string().max(200).optional(),
    deliveryArea: z.string().max(200).optional(),
    deliveryAddress: z.string().max(500).optional(),
    readyAt: z.string().optional(),
    deadline: z.string().optional(),
    targetPriceAed: z.coerce.number().positive().max(1_000_000).optional(),
    notes: z.string().max(5000).optional(),
    truckCount: z.coerce.number().int().positive().max(100).optional(),
    cargoWeightTons: z.coerce.number().positive().max(1000).optional(),
    pickupLat: z.coerce.number().min(22).max(27).optional(),
    pickupLng: z.coerce.number().min(51).max(57).optional(),
    deliveryLat: z.coerce.number().min(22).max(27).optional(),
    deliveryLng: z.coerce.number().min(51).max(57).optional(),
    equipmentType: z.string().optional(),
    loadingLocation: z.string().max(200).optional(),
    deliveryLocation: z.string().max(200).optional(),
    scheduledPostAt: z.string().optional(),
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
