const db = require('../db');
const { sendError } = require('../lib/http');
const { auth, requireSeatRole, writeLimiter } = require('../middleware/auth');
const { validate, jobCreateSchema } = require('../middleware/validate');
const jobController = require('../controllers/job.controller');

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
router.post('/api/jobs', auth(['SHIPPER']), writeLimiter, requireSeatRole(['OPS']), validate(jobCreateSchema), jobController.createJob);

// Award — the money-moving transaction lives in services/award.service.js;
// this wrapper only does HTTP (kept for backwards compat, not moved to job.controller to preserve award.service isolation).
router.post('/api/jobs/:id/award', auth(['SHIPPER']), requireSeatRole(['OPS']), async (req, res) => {
  const { bidId } = req.body || {};
  const { awardJob } = require('../services/award.service');
  await awardJob(req, res, Number(req.params.id), bidId);
});

module.exports = router;
