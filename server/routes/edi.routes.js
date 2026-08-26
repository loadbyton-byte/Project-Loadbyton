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
router.post('/api/edi/ingest', (req,res)=>{
  const { source, data, mode, linkedJobId } = req.body||{};
  if(!source||!data) return sendError(res,400,'source and data required');
  if(!['EDI_304','EDI_310','CARGO_XML'].includes(source)) return sendError(res,400,'source must be EDI_304/EDI_310/CARGO_XML');
  const m = mapEdiToConsignment(data, source);
  db.prepare(`INSERT OR REPLACE INTO global_consignments (id, source, mode, status, origin, destination, payload, linked_job_id, updated_at) VALUES (?,?,?,?,?,?,?, ?, datetime('now'))`).run(m.id, source, m.mode||mode||'DRAYAGE', 'CREATED', m.origin, m.destination, m.payload, linkedJobId?Number(linkedJobId):null);
  // state machine: CREATED -> IN_TRANSIT -> DELIVERED -> COMPLETED, link to job if drayage
  const cons=db.prepare('SELECT * FROM global_consignments WHERE id=?').get(m.id);
  res.status(201).json({ consignment: cons });
});
router.get('/api/edi/consignments', auth(), (req,res)=>{
  const rows=db.prepare('SELECT * FROM global_consignments ORDER BY updated_at DESC LIMIT 100').all();
  res.json({ consignments: rows });
});
router.get('/api/edi/consignments/:id', auth(), (req,res)=>{
  const row=db.prepare('SELECT * FROM global_consignments WHERE id=?').get(req.params.id);
  if(!row) return sendError(res,404,'Consignment not found');
  const linked = row.linked_job_id ? db.prepare('SELECT job_code,status FROM jobs WHERE id=?').get(row.linked_job_id) : null;
  res.json({ consignment: row, linkedJob: linked });
});
router.post('/api/edi/consignments/:id/transition', auth(), (req,res)=>{
  const { status } = req.body||{};
  if(!['CREATED','IN_TRANSIT','DELIVERED','COMPLETED','CANCELLED'].includes(status)) return sendError(res,400,'Invalid status');
  db.prepare(`UPDATE global_consignments SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  const row=db.prepare('SELECT * FROM global_consignments WHERE id=?').get(req.params.id);
  res.json({ consignment: row });
});
module.exports = router;
