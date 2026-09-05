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
const db = require('../db');
/** @type {any} */
const http = require('../lib/http');
const sendError = /** @type {any} */ (http).sendError;
/** @type {any} */
const apiResponse = require('../lib/apiResponse'); // new envelope for createJob errors (via controller)
/** @type {any} */
const authMod = require('../middleware/auth');
const auth = /** @type {any} */ (authMod).auth;
const requireSeatRole = /** @type {any} */ (authMod).requireSeatRole;
const writeLimiter = /** @type {any} */ (authMod).writeLimiter;
/** @type {any} */
const validateMod = require('../middleware/validate');
const validate = /** @type {any} */ (validateMod).validate;
const jobCreateSchema = /** @type {any} */ (validateMod).jobCreateSchema;
/** @type {any} */
const jobController = require('../controllers/job.controller');

// @ts-ignore
const router = require('express').Router();

// List jobs — delegates to controller/service which uses repositories
router.get('/api/jobs', auth(), jobController.listJobs);

// Bulk import — delegates to controller (which delegates to service + repositories)
router.post('/api/jobs/import', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), jobController.importJobs);

// Edit job details (PATCH /api/jobs/:id) — delegates to service with fixed BOOLEAN_JOB_FIELDS / isValidUaeLatLng
router.patch('/api/jobs/:id', auth(['SHIPPER']), requireSeatRole(['OPS']), jobController.editJob);

// Get single job — delegates to controller/service (uses repositories)
router.get('/api/jobs/:id', auth(), jobController.getJob);

// Create job — delegates to controller/service (uses repositories via service)
// Error handling migrated to new envelope: job.controller.createJob now uses apiResponse.error (success:false + error:{code,message} + _legacy)
router.post('/api/jobs', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), validate(jobCreateSchema), jobController.createJob);

// Award — the money-moving transaction lives in services/award.service.js;
// this wrapper only does HTTP (kept for backwards compat, not moved to job.controller to preserve award.service isolation).
router.post('/api/jobs/:id/award', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), async (/** @type {any} */ req, /** @type {any} */ res) => {
  const { bidId } = /** @type {any} */ (req.body) || {};
  const { awardJob } = /** @type {any} */ (require('../services/award.service'));
  await awardJob(req, res, Number(/** @type {any} */ (req.params).id), /** @type {any} */ (bidId));
});

module.exports = router;
