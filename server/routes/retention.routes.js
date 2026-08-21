const db = require('../db');
const { unifiedLanes } = require('../lib/lanes');
const { issueInvoice, renderInvoiceHtml } = require('../lib/invoice');
const { sendError, jobCode } = require('../lib/http');
const { NOTIFICATION_TYPES } = require('../lib/constants');
const { writeAudit } = require('../lib/helpers');
const { auth } = require('../middleware/auth');

const router = require('express').Router();

router.get('/api/templates', auth(['SHIPPER']), (req, res) => {
  const templates = db.prepare('SELECT * FROM templates WHERE shipper_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ templates });
});

router.post('/api/templates', auth(['SHIPPER']), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.pickupTerminal || !b.deliveryArea || !b.deliveryAddress || !b.containerSize) {
    return sendError(res, 400, 'name, pickupTerminal, deliveryArea, deliveryAddress and containerSize are required');
  }
  const result = db
    .prepare(
      `INSERT INTO templates (shipper_id, name, pickup_terminal, delivery_area, delivery_address, container_size, container_type, cadence, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(req.user.id, b.name, b.pickupTerminal, b.deliveryArea, b.deliveryAddress, b.containerSize, b.containerType || 'DRY', b.cadence || 'ONCE', b.notes || null);
  const template = db.prepare('SELECT * FROM templates WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ template });
});

router.post('/api/templates/:id/rerun', auth(['SHIPPER']), (req, res) => {
  const tpl = db.prepare('SELECT * FROM templates WHERE id=? AND shipper_id=?').get(req.params.id, req.user.id);
  if (!tpl) return sendError(res, 404, 'Template not found');
  let code = jobCode();
  while (db.prepare('SELECT 1 FROM jobs WHERE job_code=?').get(code)) code = jobCode();
  const readyAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const deadline = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString();
  const result = db
    .prepare(
      `INSERT INTO jobs (job_code, shipper_id, template_id, container_size, container_type, pickup_terminal, delivery_area, delivery_address,
         ready_at, deadline, status, escrow_status, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,'OPEN','PENDING',?)`
    )
    .run(code, req.user.id, tpl.id, tpl.container_size, tpl.container_type, tpl.pickup_terminal, tpl.delivery_area, tpl.delivery_address, readyAt, deadline, tpl.notes);
  writeAudit(req, { userId: req.actorId, action: 'JOB_CREATE', details: `${code} posted from template "${tpl.name}"`, entityType: 'job', entityId: Number(result.lastInsertRowid) });
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ job });
});

router.get('/api/contracts', auth(['SHIPPER']), (req, res) => {
  const contracts = db.prepare('SELECT * FROM contract_lanes WHERE shipper_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ contracts });
});

router.post('/api/contracts', auth(['SHIPPER']), (req, res) => {
  const b = req.body || {};
  if (!b.pickupTerminal || !b.deliveryArea || !b.deliveryAddress || !b.monthlyLoads) {
    return sendError(res, 400, 'pickupTerminal, deliveryArea, deliveryAddress and monthlyLoads are required');
  }
  const result = db
    .prepare(`INSERT INTO contract_lanes (shipper_id, pickup_terminal, delivery_area, delivery_address, monthly_loads, target_price_aed, status) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user.id, b.pickupTerminal, b.deliveryArea, b.deliveryAddress, b.monthlyLoads, b.targetPriceAed || null, 'ACTIVE');
  const contract = db.prepare('SELECT * FROM contract_lanes WHERE id=?').get(Number(result.lastInsertRowid));
  res.status(201).json({ contract });
});

router.get('/api/analytics/mine', auth(), (req, res) => {
  const u = req.user;
  if (u.role === 'CARRIER') {
    const totalBids = db.prepare('SELECT COUNT(*) c FROM bids WHERE carrier_id=?').get(u.id).c;
    const jobsWon = db.prepare(`SELECT COUNT(*) c FROM bids WHERE carrier_id=? AND status='ACCEPTED'`).get(u.id).c;
    const paidOutAED = db.prepare(`SELECT COALESCE(SUM(net_aed),0) s FROM payouts WHERE carrier_id=? AND status='RELEASED'`).get(u.id).s;
    const pendingAED = db.prepare(`SELECT COALESCE(SUM(net_aed),0) s FROM payouts WHERE carrier_id=? AND status NOT IN ('RELEASED','CANCELLED')`).get(u.id).s;
    const completed = db.prepare(`SELECT COUNT(*) c FROM jobs WHERE carrier_id=? AND status='COMPLETED'`).get(u.id).c;
    const onTimeCount = db
      .prepare(`SELECT COUNT(*) c FROM jobs WHERE carrier_id=? AND status='COMPLETED' AND delivered_at IS NOT NULL AND date(delivered_at) <= date(deadline)`)
      .get(u.id).c;
    const onTime = completed > 0 ? Math.round((onTimeCount / completed) * 100) : 100;
    res.json({ analytics: { totalBids, jobsWon, paidOutAED, pendingAED, rating: u.profile.rating_avg, onTime, tier: u.tier } });
  } else if (u.role === 'SHIPPER') {
    const jobsPosted = db.prepare('SELECT COUNT(*) c FROM jobs WHERE shipper_id=?').get(u.id).c;
    const jobsCompleted = db.prepare(`SELECT COUNT(*) c FROM jobs WHERE shipper_id=? AND status='COMPLETED'`).get(u.id).c;
    const totalSpentAED = db.prepare(`SELECT COALESCE(SUM(agreed_price_aed),0) s FROM jobs WHERE shipper_id=? AND status='COMPLETED'`).get(u.id).s;
    const activeJobs = db
      .prepare(`SELECT COUNT(*) c FROM jobs WHERE shipper_id=? AND status IN ('OPEN','AWARDED','PICKED_UP','IN_TRANSIT','DELIVERED')`)
      .get(u.id).c;
    const paidJobs = db.prepare(`SELECT pickup_terminal, delivery_area, agreed_price_aed FROM jobs WHERE shipper_id=? AND agreed_price_aed IS NOT NULL`).all(u.id);
    let savingsPercent = 0;
    if (paidJobs.length) {
      const laneMap = Object.fromEntries(unifiedLanes.map((l) => [`${l.terminal}:${l.area}`, l.basePriceAed]));
      let baseSum = 0;
      let paidSum = 0;
      for (const j of paidJobs) {
        const base = laneMap[`${j.pickup_terminal}:${j.delivery_area}`] || j.agreed_price_aed;
        baseSum += base;
        paidSum += j.agreed_price_aed;
      }
      savingsPercent = baseSum > 0 ? Math.max(0, Math.round(((baseSum - paidSum) / baseSum) * 1000) / 10) : 0;
    }
    res.json({ analytics: { jobsPosted, jobsCompleted, totalSpentAED, activeJobs, savingsPercent, tier: u.tier, rating: u.profile.rating_avg } });
  } else {
    res.json({ analytics: {} });
  }
});

router.get('/api/earnings', auth(['CARRIER']), (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, j.id as job_id, j.job_code, j.status, j.agreed_price_aed, j.created_at as job_created,
              p.gross_aed, p.platform_fee_aed, p.net_aed, p.status as payout_status, p.release_type, p.released_at,
              p.processor_payout_status, p.transfer_executed_at, p.transfer_reference
       FROM payouts p JOIN jobs j ON j.id = p.job_id
       WHERE p.carrier_id = ?
       ORDER BY p.created_at DESC`
    )
    .all(req.user.id);
  const paid = rows.filter((r) => r.payout_status === 'RELEASED').reduce((s, r) => s + r.net_aed, 0);
  const pending = rows.filter((r) => !['RELEASED', 'CANCELLED'].includes(r.payout_status)).reduce((s, r) => s + r.net_aed, 0);
  res.json({ payouts: rows, totals: { paid, pending } });
});

router.get('/api/invoices', auth(['CARRIER', 'ADMIN']), (req, res) => {
  const invoices =
    req.user.role === 'ADMIN'
      ? db.prepare(`SELECT i.*, j.job_code FROM invoices i JOIN jobs j ON j.id = i.job_id ORDER BY i.issued_at DESC LIMIT 200`).all()
      : db.prepare(`SELECT i.*, j.job_code FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE i.carrier_id=? ORDER BY i.issued_at DESC`).all(req.user.id);
  res.json({ invoices });
});

router.get('/api/invoices/print.js', (req, res) => {
  res.set('Content-Type', 'application/javascript').set('Cache-Control', 'public, max-age=31536000, immutable').send(
    `document.getElementById('invoice-print-btn')?.addEventListener('click', () => window.print());`
  );
});

router.get('/api/invoices/:id', auth(['CARRIER', 'ADMIN']), (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!invoice) return sendError(res, 404, 'Invoice not found');
  if (req.user.role !== 'ADMIN' && invoice.carrier_id !== req.user.id) return sendError(res, 403, 'Not your invoice');
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(invoice.job_id);
  const carrierProfile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(invoice.carrier_id);
  if (req.query.format === 'json') return res.json({ invoice, job });
  res.set('Content-Type', 'text/html').send(renderInvoiceHtml({ invoice, job, carrierProfile }));
});

router.get('/api/notifications', auth(), (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY is_read ASC, created_at DESC LIMIT 100').all(req.user.id);
  res.json({ notifications });
});

router.post('/api/notifications/read', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/api/notifications/preferences', auth(), (req, res) => {
  const row = db.prepare('SELECT notification_prefs_disabled FROM users WHERE id=?').get(req.user.id);
  const disabled = row ? row.notification_prefs_disabled.split(',').filter(Boolean) : [];
  res.json({ types: NOTIFICATION_TYPES, disabled });
});

router.patch('/api/notifications/preferences', auth(), (req, res) => {
  const { disabled } = req.body;
  if (!Array.isArray(disabled) || !disabled.every((t) => NOTIFICATION_TYPES.includes(t))) {
    return sendError(res, 400, `disabled must be an array of: ${NOTIFICATION_TYPES.join(', ')}`);
  }
  const csv = [...new Set(disabled)].join(',');
  db.prepare('UPDATE users SET notification_prefs_disabled=? WHERE id=?').run(csv, req.user.id);
  res.json({ types: NOTIFICATION_TYPES, disabled: [...new Set(disabled)] });
});

module.exports = router;
