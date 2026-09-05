// Payout / settlement statement — issued to the carrier whenever a payout is
// released, showing gross freight, commission deducted, and net paid.
const { renderDocumentShell, esc } = require('./shell');

function renderSettlementHtml({ job, payout, carrierProfile }) {
  const statementCode = `LBT-STMT-${String(payout.id).padStart(6, '0')}`;
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
