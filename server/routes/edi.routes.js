const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const router = require('express').Router();

function mapEdiToConsignment(raw, source){
  // Minimal parsers for 304/310/Cargo-XML — real: use edi-reader library
  let id, origin, destination, payload;
  if(source==='EDI_304'){
    id = raw.bol || raw.shipmentId || `EDI304-${Date.now()}`;
    origin = raw.origin || raw.portOfLoading || 'JEBEL_ALI_T1';
    destination = raw.destination || raw.placeOfDelivery || 'AL_QUOZ';
    payload = raw;
  } else if(source==='EDI_310'){
    id = raw.invoiceNumber || `EDI310-${Date.now()}`;
    origin = raw.origin || 'JEBEL_ALI_T1';
    destination = raw.destination || 'AL_QUOZ';
    payload = raw;
  } else {
    id = raw.awb || raw.masterAwb || `CXML-${Date.now()}`;
    origin = raw.origin || raw.departure || 'DXB';
    destination = raw.destination || raw.arrival || 'AL_QUOZ';
    payload = raw;
  }
  const mode = raw.mode || (source==='CARGO_XML' ? 'MARITIME' : 'DRAYAGE');
  return { id: String(id), origin, destination, mode, payload: JSON.stringify(payload) };
}
// Was missing auth() entirely — anyone on the internet could POST arbitrary
// EDI/manifest data, upsert into global_consignments by a known id
// (overwriting an existing consignment's origin/destination/status), and
// set linked_job_id to any real job with no relationship check at all.
router.post('/api/edi/ingest', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const { source, data, mode, linkedJobId } = req.body||{};
  if(!source||!data) return sendError(res,400,'source and data required');
  if(!['EDI_304','EDI_310','CARGO_XML'].includes(source)) return sendError(res,400,'source must be EDI_304/EDI_310/CARGO_XML');
  if (linkedJobId && req.user.role !== 'ADMIN') {
    const job = await db.prepare('SELECT shipper_id FROM jobs WHERE id=?').get(Number(linkedJobId));
    if (!job || job.shipper_id !== req.user.id) return sendError(res, 403, 'linkedJobId must be one of your own jobs');
  }
  const m = mapEdiToConsignment(data, source);
  // ON CONFLICT ... DO UPDATE, not INSERT OR REPLACE — the latter is
  // SQLite-only syntax (a hard Postgres error); ON CONFLICT is standard
  // and portable across both (SQLite 3.24+, which node:sqlite satisfies).
  await db.prepare(
    `INSERT INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT (id) DO UPDATE SET source=excluded.source, mode=excluded.mode, status=excluded.status, origin=excluded.origin, destination=excluded.destination, payload=excluded.payload, linked_job_id=excluded.linked_job_id, updated_at=excluded.updated_at`
  ).run(m.id, source, m.mode||mode||'DRAYAGE', 'CREATED', m.origin, m.destination, m.payload, linkedJobId?Number(linkedJobId):null);
  // state machine: CREATED -> IN_TRANSIT -> DELIVERED -> COMPLETED, link to job if drayage
  const cons=await db.prepare('SELECT * FROM global_consignments WHERE id=?').get(m.id);
  res.status(201).json({ consignment: cons });
});
// These three previously used bare auth() — any authenticated user of any
// role (including a brand-new unverified account or a DRIVER seat) could
// list/read every consignment on the platform (cross-company shipment
// data) and transition any consignment's status. global_consignments has
// no owner column of its own; ownership is via the linked job, so a
// SHIPPER only sees/manages consignments linked to one of their own jobs
// (or none yet — an unlinked consignment isn't "theirs" until it's
// linked). ADMIN keeps unrestricted access.
router.get('/api/edi/consignments', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const rows = req.user.role === 'ADMIN'
    ? await db.prepare('SELECT * FROM global_consignments ORDER BY updated_at DESC LIMIT 100').all()
    : await db.prepare(`SELECT gc.* FROM global_consignments gc JOIN jobs j ON j.id = gc.linked_job_id WHERE j.shipper_id=? ORDER BY gc.updated_at DESC LIMIT 100`).all(req.user.id);
  res.json({ consignments: rows });
});
router.get('/api/edi/consignments/:id', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const row=await db.prepare('SELECT * FROM global_consignments WHERE id=?').get(req.params.id);
  if(!row) return sendError(res,404,'Consignment not found');
  const linked = row.linked_job_id ? await db.prepare('SELECT id,job_code,status,shipper_id FROM jobs WHERE id=?').get(row.linked_job_id) : null;
  if (req.user.role !== 'ADMIN' && (!linked || linked.shipper_id !== req.user.id)) return sendError(res,403,'Not permitted');
  res.json({ consignment: row, linkedJob: linked ? { job_code: linked.job_code, status: linked.status } : null });
});
router.post('/api/edi/consignments/:id/transition', auth(['SHIPPER','ADMIN']), async (req,res)=>{
  const { status } = req.body||{};
  if(!['CREATED','IN_TRANSIT','DELIVERED','COMPLETED','CANCELLED'].includes(status)) return sendError(res,400,'Invalid status');
  const row=await db.prepare('SELECT * FROM global_consignments WHERE id=?').get(req.params.id);
  if(!row) return sendError(res,404,'Consignment not found');
  if (req.user.role !== 'ADMIN') {
    const linked = row.linked_job_id ? await db.prepare('SELECT shipper_id FROM jobs WHERE id=?').get(row.linked_job_id) : null;
    if (!linked || linked.shipper_id !== req.user.id) return sendError(res,403,'Not permitted');
  }
  await db.prepare(`UPDATE global_consignments SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  const updated=await db.prepare('SELECT * FROM global_consignments WHERE id=?').get(req.params.id);
  res.json({ consignment: updated });
});
module.exports = router;
