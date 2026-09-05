// Equipment Interchange Receipt summary — a formal one-page record of the
// 3-photo container condition check (Seal, Right Side, Left Side) the app
// already captures at container pickup/return.
const { renderDocumentShell, esc } = require('./shell');

function renderEirSummaryHtml({ job, eirDocuments, carrierProfile }) {
  const rows = (eirDocuments || [])
    .map((d) => `<tr><td>${esc(d.title)}</td><td>${esc(d.created_at)}</td></tr>`)
    .join('');
  const bodyHtml = `
  <div class="cols">
    <div>
      <strong>Carrier</strong><br/>
      ${esc(carrierProfile ? carrierProfile.company_name : '—')}
    </div>
    <div>
      <strong>Container</strong><br/>
      ${esc(job.container_number || '—')} · ${esc(job.container_size)} ${esc(job.container_type)}
    </div>
  </div>

  <table>
    <thead><tr><th>Photo record</th><th>Captured at</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="2" class="muted">No EIR photos on file for this job.</td></tr>'}</tbody>
  </table>

  <div class="card">This summarizes the 3-point container condition check (Seal, Right Side, Left Side) recorded against job ${esc(job.job_code)}${job.dp_world_e_token ? `. DP World e-Token on file: <span class="mono">${esc(job.dp_world_e_token)}</span>` : ''}.</div>`;

  return renderDocumentShell({
    title: 'Equipment Interchange Receipt',
    subtitle: `Container handover record for job ${job.job_code}`,
    docCode: job.job_code,
    bodyHtml,
  });
}

module.exports = { renderEirSummaryHtml };
