import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatDate, formatLabel } from '../lib/constants.js';
import { Card, Input, EmptyState, ErrorState, StatusBadge } from '../components/ui.jsx';
import { IconHistory } from '../components/icons.jsx';

// Shipper-facing equivalent of the carrier's Invoices/Earnings pages — a
// per-job breakdown (price, dates, duration) plus links to whichever
// branded documents apply to that job's current state. No new backend
// endpoint: GET /api/jobs is already scoped to the shipper's own jobs; the
// document links hit server/routes/document-templates.routes.js, which
// already authorizes the requesting job's shipper (built earlier alongside
// the investor demo work).
function durationDays(job) {
  if (!job.ready_at || !job.delivered_at) return null;
  const ms = new Date(job.delivered_at.replace(' ', 'T')) - new Date(job.ready_at.replace(' ', 'T'));
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 86400000) * 10) / 10;
}

function DocLinks({ job }) {
  const links = [];
  if (job.agreed_price_aed) links.push(['Load confirmation', 'load-confirmation']);
  if (job.delivered_at) links.push(['POD certificate', 'pod-certificate']);
  if (job.status === 'COMPLETED') links.push(['Settlement', 'settlement']);
  // No "Dispute notice" link here — the job list this page uses doesn't
  // say whether a job was actually disputed (only its current status,
  // which reverts to COMPLETED once a dispute resolves), so showing this
  // unconditionally on every completed job led to a dead-end 404 for the
  // (majority) of completed jobs that were never disputed. The job's own
  // detail page correctly knows its real dispute status and links there
  // properly — this quick-links row isn't the place to guess.
  if (!links.length) return <span className="text-xs text-ink-muted">—</span>;
  return (
    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
      {links.map(([label, slug]) => (
        <a key={slug} href={`/api/jobs/${job.id}/documents/${slug}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-secondary hover:underline">
          {label}
        </a>
      ))}
    </div>
  );
}

export default function JobHistory() {
  usePageTitle('Job History');
  const [jobs, setJobs] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  function load() {
    setError('');
    api.listJobs({ limit: 200, sort: 'date_desc' }).then((d) => setJobs(d.jobs)).catch((err) => { setJobs([]); setError(err.message); });
  }
  useEffect(load, []);

  const filtered = jobs?.filter((j) => !search || j.job_code.toLowerCase().includes(search.toLowerCase()));
  const totalSpent = filtered?.filter((j) => j.status === 'COMPLETED').reduce((s, j) => s + (j.agreed_price_aed || 0), 0) || 0;

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Job History</h1>
      <p className="mt-1 text-sm text-ink-muted">Every job you've posted — price, timing, and the documents tied to each one.</p>

      <Card className="mt-5 p-5">
        <Input placeholder="Search job code" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </Card>

      {!filtered && !error ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <ErrorState className="mt-6" title="Couldn't load your job history" description={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconHistory size={26} />} title="No jobs yet" description="Posted jobs and their documents will show up here." />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Route</th>
                  <th className="px-5 py-3 font-medium">Posted</th>
                  <th className="px-5 py-3 font-medium">Delivered</th>
                  <th className="px-5 py-3 font-medium">Duration</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => {
                  const dur = durationDays(j);
                  return (
                    <tr key={j.id} className="border-b last:border-0 hover:bg-raised" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-5 py-3 font-mono text-xs">{j.job_code}</td>
                      <td className="px-5 py-3 text-ink-secondary">{formatLabel(j.pickup_terminal)} → {formatLabel(j.delivery_area)}</td>
                      <td className="px-5 py-3 text-ink-secondary">{formatDate(j.created_at)}</td>
                      <td className="px-5 py-3 text-ink-secondary">{j.delivered_at ? formatDate(j.delivered_at) : '—'}</td>
                      <td className="px-5 py-3 tabular text-ink-muted">{dur != null ? `${dur}d` : '—'}</td>
                      <td className="px-5 py-3 font-mono font-semibold">{j.agreed_price_aed ? formatAED(j.agreed_price_aed) : '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={j.status} /></td>
                      <td className="px-5 py-3 text-right"><DocLinks job={j} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm text-ink-muted">{filtered.length} job{filtered.length === 1 ? '' : 's'} · {formatAED(totalSpent)} spent on completed jobs</p>
        </>
      )}
    </div>
  );
}
