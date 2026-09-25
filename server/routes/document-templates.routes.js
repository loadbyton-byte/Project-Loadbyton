// Branded document endpoints — settlement statement, load confirmation, POD
// certificate, EIR summary, dispute notice. The tax invoice already has its
// own route in retention.routes.js (GET /api/invoices/:id); these five are
// the new ones described in the investor-demo/branded-documents plan.
const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { renderSettlementHtml } = require('../lib/documents/settlement');
const { renderLoadConfirmationHtml } = require('../lib/documents/loadConfirmation');
const { renderPodCertificateHtml } = require('../lib/documents/podCertificate');
const { renderEirSummaryHtml } = require('../lib/documents/eirSummary');
const { renderDisputeNoticeHtml } = require('../lib/documents/disputeNotice');

const router = require('express').Router();

async function loadAuthorizedJob(req, res) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) { sendError(res, 404, 'Job not found'); return null; }
  const permitted = req.user.role === 'ADMIN' || job.shipper_id === req.user.id || job.carrier_id === req.user.id;
  if (!permitted) { sendError(res, 403, 'Not permitted'); return null; }
  return job;
}

async function profiles(job) {
  const shipperProfile = await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(job.shipper_id);
  const carrierProfile = job.carrier_id ? await db.prepare('SELECT * FROM profiles WHERE user_id=?').get(job.carrier_id) : null;
  return { shipperProfile, carrierProfile };
}

// The awarded bid's base amount plus whichever ancillary charges (Salik,
// e-token, demurrage, truck detention, ...) both shipper and carrier agreed
// to — the same two figures award.service.js summed into job.agreed_price_aed
// at award time. Surfaced here so the settlement statement and load
// confirmation can show the breakdown behind that lump sum instead of just
// the total, which was previously invisible on every customer-facing
// document even though the money was already correct.
//
// Matched by job_id + carrier_id rather than bid.status='AWARDED': a real
// award (award.service.js) does set that status, but seed.js's directly
// SQL-inserted demo jobs (every AWARDED-or-beyond scenario job — see this
// file's top comment / document-templates.test.js) leave the bid at
// whatever status it was originally inserted with (e.g. 'ACCEPTED'), never
// 'AWARDED'. job.carrier_id is the one field both paths always set.
async function agreedAncillaryCharges(job) {
  const bid = await db
    .prepare(`SELECT id, amount_aed FROM bids WHERE job_id=? AND carrier_id=? ORDER BY id DESC LIMIT 1`)
    .get(job.id, job.carrier_id);
  if (!bid) return { baseAed: null, charges: [] };
  const charges = await db
    .prepare(
      `SELECT charge_type, amount_aed, notes FROM bid_ancillary_charges
       WHERE bid_id=? AND agreed_by_shipper=1 AND agreed_by_carrier=1 ORDER BY created_at ASC`
    )
    .all(bid.id);
  return { baseAed: bid.amount_aed, charges };
}

router.get('/api/jobs/:id/documents/settlement', auth(), async (req, res) => {
  const job = await loadAuthorizedJob(req, res);
  if (!job) return;
  const payout = await db.prepare('SELECT * FROM payouts WHERE job_id=?').get(job.id);
  if (!payout) return sendError(res, 404, 'No payout on file for this job yet');
  const { carrierProfile } = await profiles(job);
  const ancillary = await agreedAncillaryCharges(job);
  res.set('Content-Type', 'text/html').send(renderSettlementHtml({ job, payout, carrierProfile, ancillary }));
});

router.get('/api/jobs/:id/documents/load-confirmation', auth(), async (req, res) => {
  const job = await loadAuthorizedJob(req, res);
  if (!job) return;
  if (!job.agreed_price_aed || !job.carrier_id) return sendError(res, 404, 'This job has not been awarded yet');
  const { shipperProfile, carrierProfile } = await profiles(job);
  const ancillary = await agreedAncillaryCharges(job);
  res.set('Content-Type', 'text/html').send(renderLoadConfirmationHtml({ job, shipperProfile, carrierProfile, ancillary }));
});

router.get('/api/jobs/:id/documents/pod-certificate', auth(), async (req, res) => {
  const job = await loadAuthorizedJob(req, res);
  if (!job) return;
  const podDocument = await db.prepare(`SELECT * FROM job_documents WHERE job_id=? AND doc_type='POD' ORDER BY created_at DESC LIMIT 1`).get(job.id);
  const { shipperProfile, carrierProfile } = await profiles(job);
  res.set('Content-Type', 'text/html').send(renderPodCertificateHtml({ job, podDocument, shipperProfile, carrierProfile }));
});

router.get('/api/jobs/:id/documents/eir-summary', auth(), async (req, res) => {
  const job = await loadAuthorizedJob(req, res);
  if (!job) return;
  const eirDocuments = await db.prepare(`SELECT * FROM job_documents WHERE job_id=? AND doc_type='EIR' ORDER BY created_at ASC`).all(job.id);
  const { carrierProfile } = await profiles(job);
  res.set('Content-Type', 'text/html').send(renderEirSummaryHtml({ job, eirDocuments, carrierProfile }));
});

router.get('/api/jobs/:id/documents/dispute-notice', auth(), async (req, res) => {
  const job = await loadAuthorizedJob(req, res);
  if (!job) return;
  const dispute = await db.prepare(`SELECT * FROM disputes WHERE job_id=? AND status='RESOLVED' ORDER BY resolved_at DESC LIMIT 1`).get(job.id);
  if (!dispute) return sendError(res, 404, 'No resolved dispute on file for this job');
  const { shipperProfile, carrierProfile } = await profiles(job);
  res.set('Content-Type', 'text/html').send(renderDisputeNoticeHtml({ job, dispute, shipperProfile, carrierProfile }));
});

module.exports = router;
