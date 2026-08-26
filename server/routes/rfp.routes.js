const db = require('../db');
const { sendError } = require('../lib/http');
const { writeAudit, notify } = require('../lib/helpers');
const { auth, requireSeatRole } = require('../middleware/auth');
const router = require('express').Router();

// Create RFP — enterprise contract lane
router.post('/api/rfps', auth(['SHIPPER']), requireSeatRole(['OPS']), (req,res)=>{
  const { title, description, origin, destination, totalContainers, durationMonths, budgetAed } = req.body||{};
  if(!title||!origin||!destination||!totalContainers||!durationMonths||!budgetAed) return sendError(res,400,'Missing RFP fields');
  const r = db.prepare(`INSERT INTO contract_rfps (shipper_id,title,description,origin,destination,total_containers,duration_months,budget_aed) VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id,title,description||null,origin,destination,Number(totalContainers),Number(durationMonths),Number(budgetAed));
  const id = Number(r.lastInsertRowid);
  // auto-create monthly milestones
  const months = Number(durationMonths);
  const per = Math.round(Number(budgetAed)/months);
  for(let i=1;i<=months;i++){
    const due = new Date(); due.setMonth(due.getMonth()+i);
    db.prepare(`INSERT INTO rfp_milestones (rfp_id,title,due_at,amount_aed) VALUES (?,?,?,?)`).run(id, `Milestone ${i}/${months}`, due.toISOString(), i===months? Number(budgetAed)-(per*(months-1)):per);
  }
  const rfp = db.prepare('SELECT * FROM contract_rfps WHERE id=?').get(id);
  writeAudit(req,{userId:req.actorId, action:'RFP_CREATE', entityType:'rfp', entityId:id, afterState: JSON.stringify(rfp)});
  res.status(201).json({ rfp });
});
router.get('/api/rfps', auth(), (req,res)=>{
  const where = req.user.role==='SHIPPER' ? 'shipper_id=?' : '1=1';
  const params = req.user.role==='SHIPPER' ? [req.user.id] : [];
  const rfps = db.prepare(`SELECT * FROM contract_rfps WHERE ${where} ORDER BY created_at DESC`).all(...params);
  res.json({ rfps });
});
router.get('/api/rfps/:id', auth(), (req,res)=>{
  const rfp = db.prepare('SELECT * FROM contract_rfps WHERE id=?').get(req.params.id);
  if(!rfp) return sendError(res,404,'RFP not found');
  const bids = db.prepare('SELECT * FROM rfp_bids WHERE rfp_id=? ORDER BY amount_aed').all(rfp.id);
  const milestones = db.prepare('SELECT * FROM rfp_milestones WHERE rfp_id=? ORDER BY due_at').all(rfp.id);
  res.json({ rfp, bids, milestones });
});
router.post('/api/rfps/:id/bids', auth(['CARRIER']), (req,res)=>{
  const rfp = db.prepare('SELECT * FROM contract_rfps WHERE id=?').get(req.params.id);
  if(!rfp||rfp.status!=='OPEN') return sendError(res,400,'RFP not open');
  const { amountAed, etaDays, proposal } = req.body||{};
  if(!amountAed) return sendError(res,400,'amountAed required');
  db.prepare(`INSERT INTO rfp_bids (rfp_id,carrier_id,amount_aed,eta_days,proposal) VALUES (?,?,?,?,?)`).run(rfp.id, req.user.id, Number(amountAed), Number(etaDays)||30, proposal||null);
  notify(rfp.shipper_id, 'RFP bid received', `New bid on ${rfp.title}`, null, 'bid');
  res.status(201).json({ ok:true });
});
router.post('/api/rfps/:id/award', auth(['SHIPPER']), (req,res)=>{
  const rfp = db.prepare('SELECT * FROM contract_rfps WHERE id=?').get(req.params.id);
  if(!rfp||rfp.shipper_id!==req.user.id) return sendError(res,403,'Not your RFP');
  const { bidId } = req.body||{};
  const bid = db.prepare('SELECT * FROM rfp_bids WHERE id=? AND rfp_id=?').get(bidId, rfp.id);
  if(!bid) return sendError(res,404,'Bid not found');
  db.prepare(`UPDATE contract_rfps SET status='AWARDED', awarded_carrier_id=? WHERE id=?`).run(bid.carrier_id, rfp.id);
  db.prepare(`UPDATE rfp_bids SET status='REJECTED' WHERE rfp_id=? AND id!=?`).run(rfp.id, bidId);
  db.prepare(`UPDATE rfp_bids SET status='ACCEPTED' WHERE id=?`).run(bidId);
  writeAudit(req,{userId:req.actorId, action:'RFP_AWARD', entityType:'rfp', entityId:rfp.id});
  res.json({ ok:true });
});
module.exports = router;
