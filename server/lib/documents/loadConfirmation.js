// Load / booking confirmation — issued the moment a job is awarded, a
// formal record of the terms both sides agreed to.
const { renderDocumentShell, esc } = require('./shell');
const { ANCILLARY_CHARGE_LABELS } = require('../constants');

function renderLoadConfirmationHtml({ job, shipperProfile, carrierProfile, ancillary }) {
  const charges = (ancillary && ancillary.charges) || [];
  // job.agreed_price_aed is the awarded bid amount plus every agreed charge
  // summed together (award.service.js) — show the breakdown behind that
  // figure, not just the total, so an added-and-agreed truck detention
  // charge (or Salik/e-token/demurrage) is visible on the booking record.
  const chargesRowsHtml = charges
    .map(
      (c) =>
        `<tr><td class="muted">&nbsp;&nbsp;+ ${esc(ANCILLARY_CHARGE_LABELS[c.charge_type] || c.charge_type)}${c.notes ? ` (${esc(c.notes)})` : ''}</td><td class="num">${Number(c.amount_aed).toFixed(2)}</td></tr>`
    )
    .join('');
  const baseRowHtml =
    charges.length && ancillary.baseAed != null
      ? `<tr><td class="muted">Base bid amount</td><td class="num">AED ${Number(ancillary.baseAed).toFixed(2)}</td></tr>`
      : '';
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
      <tr><td>Pickup terminal</td><td>${esc(job.pickup_terminal)}</td></tr>
      <tr><td>Delivery area</td><td>${esc(job.delivery_area)} — ${esc(job.delivery_address)}</td></tr>
      <tr><td>Container</td><td>${esc(job.container_size)} ${esc(job.container_type)}${job.container_number ? ' · ' + esc(job.container_number) : ''}</td></tr>
      <tr><td>Ready at</td><td>${esc(job.ready_at)}</td></tr>
      <tr><td>Deadline</td><td>${esc(job.deadline)}</td></tr>
      <tr><td>Assigned driver</td><td>${esc(job.assigned_driver_name || 'Not yet assigned')}${job.assigned_driver_phone ? ' · ' + esc(job.assigned_driver_phone) : ''}</td></tr>
      ${baseRowHtml}
      ${chargesRowsHtml}
      <tr class="totals"><td>Agreed price</td><td class="num">AED ${Number(job.agreed_price_aed).toFixed(2)}</td></tr>
    </tbody>
  </table>

  <p class="muted" style="margin-top:20px;">This confirms the booking terms agreed between the two parties above. Payment is held in escrow by Loadbyton until delivery is confirmed.</p>`;

  return renderDocumentShell({
    title: 'Load Confirmation',
    subtitle: `Booking confirmed for job ${job.job_code}`,
    docCode: job.job_code,
    bodyHtml,
  });
}

module.exports = { renderLoadConfirmationHtml };
