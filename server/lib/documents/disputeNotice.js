// Dispute resolution notice — a formal record of the claim, the decision,
// and the outcome, sent to both parties when a dispute is resolved.
const { renderDocumentShell, esc } = require('./shell');

const DECISION_LABEL = {
  RELEASE_TO_CARRIER: 'Released in full to the carrier',
  REFUND_SHIPPER: 'Refunded in full to the shipper',
  SPLIT: 'Split settlement between shipper and carrier',
};

function renderDisputeNoticeHtml({ job, dispute, shipperProfile, carrierProfile }) {
  const bodyHtml = `
  <div class="cols">
    <div>
      <strong>Shipper</strong><br/>
      ${esc(shipperProfile ? shipperProfile.company_name : '—')}
    </div>
    <div>
      <strong>Carrier</strong><br/>
      ${esc(carrierProfile ? carrierProfile.company_name : '—')}
    </div>
  </div>

  <table>
    <tbody>
      <tr><td>Job</td><td class="mono">${esc(job.job_code)}</td></tr>
      <tr><td>Claim</td><td>${esc(dispute.reason)}</td></tr>
      <tr><td>Findings</td><td>${esc(dispute.determination || '—')}</td></tr>
      <tr><td>Resolved at</td><td>${esc(dispute.resolved_at || '—')}</td></tr>
      <tr class="totals"><td>Decision</td><td>${esc(DECISION_LABEL[dispute.decision] || dispute.decision)}</td></tr>
    </tbody>
  </table>

  <p class="muted" style="margin-top:20px;">This notice records the platform's resolution of the dispute raised on job ${esc(job.job_code)}. Both parties were notified at the time of resolution.</p>`;

  return renderDocumentShell({
    title: 'Dispute Resolution Notice',
    subtitle: `Outcome for job ${job.job_code}`,
    docCode: `LBT-DISP-${String(dispute.id).padStart(6, '0')}`,
    bodyHtml,
  });
}

module.exports = { renderDisputeNoticeHtml };
