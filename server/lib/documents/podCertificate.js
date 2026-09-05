// Proof of Delivery certificate — a clean formal summary of the POD photo
// already captured on the job, rather than a raw file.
const { renderDocumentShell, esc } = require('./shell');

function renderPodCertificateHtml({ job, podDocument, shipperProfile, carrierProfile }) {
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
      <tr><td>Route</td><td>${esc(job.pickup_terminal)} → ${esc(job.delivery_area)}</td></tr>
      <tr><td>Delivered at</td><td>${esc(job.delivered_at || '—')}</td></tr>
      <tr><td>Assigned driver</td><td>${esc(job.assigned_driver_name || '—')}</td></tr>
      <tr><td>Delivery document on file</td><td>${podDocument ? esc(podDocument.title) : 'No POD document uploaded'}</td></tr>
    </tbody>
  </table>

  <div class="card">This certifies that the shipment for job ${esc(job.job_code)} was marked delivered on the platform, with a proof-of-delivery record attached to the job.</div>`;

  return renderDocumentShell({
    title: 'Proof of Delivery Certificate',
    subtitle: `Delivery confirmation for job ${job.job_code}`,
    docCode: job.job_code,
    bodyHtml,
  });
}

module.exports = { renderPodCertificateHtml };
