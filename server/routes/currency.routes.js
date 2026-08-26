const db = require('../db');
const { sendError } = require('../lib/http');
const { auth } = require('../middleware/auth');
const { taxForJob } = require('../lib/tax');
const router = require('express').Router();

// Global currency patch — shipper can set currency/country, server derives tax
router.get('/api/currency/rates', (req,res)=>{
  const { TAX_TABLE } = require('../lib/tax');
  res.json({ table: TAX_TABLE });
});
router.post('/api/jobs/:id/currency', auth(['SHIPPER']), async (req,res)=>{
  const job=await db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if(!job) return sendError(res,404,'Job not found');
  if(job.shipper_id!==req.user.id) return sendError(res,403,'Not your job');
  if(!['OPEN','DRAFT'].includes(job.status)) return sendError(res,400,'Only OPEN/DRAFT jobs can change currency');
  const { countryCode, currency } = req.body||{};
  const cc = String(countryCode||'AE').toUpperCase().slice(0,2);
  const cur = currency ? String(currency).toUpperCase().slice(0,3) : require('../lib/tax').currencyForCountry(cc);
  const tax = taxForJob({ countryCode: cc, amount: job.max_budget_aed||job.agreed_price_aed||0 });
  await db.prepare(`UPDATE jobs SET country_code=?, currency=?, tax_rate_bps=?, tax_amount=?, updated_at=datetime('now') WHERE id=?`).run(cc, cur, tax.vatBps, tax.vat, job.id);
  res.json({ ok:true, currency: cur, countryCode: cc, tax });
});
module.exports = router;
