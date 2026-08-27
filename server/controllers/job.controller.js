/**
 * Job Controller — HTTP layer for job domain.
 * Extracts req/res handling and delegates to job.service.
 * Uses existing repositories for direct reads where appropriate.
 */

const jobService = require('../services/job.service');
const jobRepository = require('../repositories/job.repository');
const payoutRepository = require('../repositories/payout.repository');
const { sendError } = require('../lib/http');
const apiResponse = require('../lib/apiResponse');

// Map HTTP status + message to canonical error codes for new envelope
function mapErrorCode(status, message) {
  const msg = (message || '').toLowerCase();
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 401) return 'NOT_AUTHENTICATED';
  if (status === 403) {
    if (msg.includes('not authenticated') || msg.includes('session')) return 'NOT_AUTHENTICATED';
    return 'FORBIDDEN';
  }
  if (status === 404) {
    if (msg.includes('job')) return 'JOB_NOT_FOUND';
    if (msg.includes('bid')) return 'BID_NOT_FOUND';
    return 'NOT_FOUND';
  }
  if (status === 409) {
    if (msg.includes('already awarded')) return 'JOB_ALREADY_AWARDED';
    if (msg.includes('not open')) return 'JOB_NOT_OPEN';
    if (msg.includes('bid')) return 'BID_NOT_PENDING';
    return 'CONFLICT';
  }
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL';
}

/**
 * POST /api/jobs — create a new job
 */
async function createJob(req, res) {
  try {
    const job = await jobService.createJob(req.body || {}, req);
    return res.status(201).json({ job });
  } catch (e) {
    if (e.status) {
      // Migrated to new envelope: apiResponse.error adds success:false + structured error + _legacy
      const code = mapErrorCode(e.status, e.message);
      return apiResponse.error(req, res, code, e.message, { status: e.status });
    }
    throw e;
  }
}

/**
 * PATCH /api/jobs/:id/status — transition job status
 */
async function updateJobStatus(req, res) {
  try {
    const { status: next } = req.body || {};
    if (!next) return sendError(res, 400, 'status is required');
    const job = await jobService.updateJobStatus(req.params.id, next, req);
    return res.json({ job });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
}

/**
 * GET /api/jobs — list jobs with filters/pagination
 */
async function listJobs(req, res) {
  try {
    const result = await jobService.listJobs(req.query || {}, req.user);
    res.set('X-Total-Count', String(result.total));
    return res.json({ jobs: result.jobs, total: result.total, limit: result.limit, offset: result.offset });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
}

/**
 * GET /api/jobs/:id — get single job with bids/documents/payout
 */
async function getJob(req, res) {
  try {
    const result = await jobService.getJob(req.params.id, req.user);
    return res.json(result);
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
}

/**
 * PATCH /api/jobs/:id — edit job details while OPEN
 */
async function editJob(req, res) {
  try {
    const job = await jobService.editJob(req.params.id, req.body || {}, req);
    return res.json({ job });
  } catch (e) {
    if (e.status) return sendError(res, e.status, e.message);
    throw e;
  }
}

/**
 * POST /api/jobs/import — bulk import jobs
 * Demonstrates repository usage via service createJob loop; preserves original bulk semantics.
 */
async function importJobs(req, res) {
  const JOB_IMPORT_MAX_ROWS = 100;
  const rows = (req.body || {}).jobs;
  if (!Array.isArray(rows) || rows.length === 0) return sendError(res, 400, 'jobs must be a non-empty array');
  if (rows.length > JOB_IMPORT_MAX_ROWS) return sendError(res, 400, `Cannot import more than ${JOB_IMPORT_MAX_ROWS} jobs at once`);

  const results = await Promise.all(rows.map(async (row, i) => {
    try {
      const job = await jobService.createJob(row || {}, req);
      // Ensure repository can fetch the newly created job (validates repository wiring)
      const fetched = await jobRepository.findById(job.id);
      return { row: i + 1, ok: true, jobCode: fetched ? fetched.job_code : job.job_code, jobId: job.id };
    } catch (e) {
      return { row: i + 1, ok: false, error: e.message || 'Unknown error' };
    }
  }));
  const created = results.filter((r) => r.ok).length;
  return res.status(201).json({ results, created, failed: results.length - created });
}

module.exports = {
  createJob,
  updateJobStatus,
  listJobs,
  getJob,
  editJob,
  importJobs,
};
