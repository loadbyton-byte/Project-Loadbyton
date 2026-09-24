// Payout / settlement statement — issued to the carrier whenever a payout is
// released, showing gross freight, commission deducted, and net paid.
const { renderDocumentShell, esc } = require('./shell');
const { ANCILLARY_CHARGE_LABELS } = require('../constants');

function renderSettlementHtml({ job, payout, carrierProfile, ancillary }) {
  const statementCode = `LBT-STMT-${String(payout.id).padStart(6, '0')}`;
  const charges = (ancillary && ancillary.charges) || [];
  // gross_aed is the awarded bid amount plus every agreed charge summed
  // together (award.service.js) — break it back out here so a carrier can
  // see exactly which agreed extras (Salik, truck detention, ...) make up
  // the gross figure instead of just the lump total.
  const chargesRowsHtml = charges
    .map(
      (c) =>
        `<tr><td class="muted">&nbsp;&nbsp;+ ${esc(ANCILLARY_CHARGE_LABELS[c.charge_type] || c.charge_type)}${c.notes ? ` (${esc(c.notes)})` : ''}</td><td class="num">${Number(c.amount_aed).toFixed(2)}</td></tr>`
    )
    .join('');
  const baseRowHtml =
    charges.length && ancillary.baseAed != null
      ? `<tr><td class="muted">Base freight (bid amount)</td><td class="num">${Number(ancillary.baseAed).toFixed(2)}</td></tr>`
      : '';
  const bodyHtml = `
  <div class="cols">
    <div>
      <strong>Carrier</strong><br/>
      ${esc(carrierProfile ? carrierProfile.company_name : '—')}
    </div>
    <div>
      <strong>Job</strong><br/>
      <span class="mono">${esc(job.job_code)}</span> · ${esc(job.pickup_terminal)} → ${esc(job.delivery_area)}
    </div>
  </div>

  <table>
    <thead><tr><th>Item</th><th class="num">Amount (AED)</th></tr></thead>
    <tbody>
      ${baseRowHtml}
      ${chargesRowsHtml}
      <tr><td>Gross freight amount</td><td class="num">${Number(payout.gross_aed).toFixed(2)}</td></tr>
      <tr><td>Platform commission deducted</td><td class="num">-${Number(payout.platform_fee_aed).toFixed(2)}</td></tr>
      <tr class="totals"><td>Net paid to carrier</td><td class="num">${Number(payout.net_aed).toFixed(2)}</td></tr>
    </tbody>
  </table>

  <div class="card">
    <div class="muted">Status: <strong style="color:var(--lb-navy)">${esc(payout.status)}</strong>${payout.released_at ? ` · Released ${esc(payout.released_at)}` : ''}${payout.release_type ? ` · ${esc(payout.release_type === 'DISPUTE_RESOLUTION' ? 'via dispute resolution' : 'standard release')}` : ''}</div>
  </div>`;

  return renderDocumentShell({
    title: 'Settlement Statement',
    subtitle: `Payout for job ${job.job_code}`,
    docCode: statementCode,
    bodyHtml,
  });
}

module.exports = { renderSettlementHtml };
