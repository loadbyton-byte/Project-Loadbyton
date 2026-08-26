import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatAED, formatDateTime, formatLabel } from '../../lib/constants.js';
import { Card, Badge, Button, EmptyState } from '../../components/ui.jsx';

function StatusBadge({ status }) {
  const colors = { OPEN: 'info', PENDING: 'info', AWARDED: 'accent', PICKED_UP: 'warning', IN_TRANSIT: 'warning', DELIVERED: 'success', COMPLETED: 'success', WITHDRAWN: 'muted', REJECTED: 'danger', CANCELLED: 'danger', DISPUTED: 'danger' };
  return <Badge color={colors[status] || 'muted'}>{formatLabel(status)}</Badge>;
}

function ActionBadge({ action }) {
  const colors = { JOB_POST: 'info', BID_PLACED: 'info', JOB_AWARD: 'accent', ESCROW_HELD: 'warning', ESCROW_FUND: 'warning', POD_SUBMIT: 'success', PAYOUT_RELEASED: 'success', PAYOUT_TRANSFER_CONFIRMED: 'success', DISPUTE_OPEN: 'danger', DISPUTE_RESOLVE: 'accent', JOB_COMPLETE: 'success', ACCOUNT_APPROVE: 'accent', CARRIER_VERIFY: 'accent', SETTINGS_UPDATE: 'muted' };
  return <Badge color={colors[action] || 'muted'}>{formatLabel(action)}</Badge>;
}

function AutoRefresh({ onRefresh, interval = 30000 }) {
  const [countdown, setCountdown] = useState(interval / 1000);
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { onRefresh(); return interval / 1000; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onRefresh, interval]);
  return <span className="text-xs text-ink-muted">Auto-refresh in {countdown}s</span>;
}

function LiveActivityTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState(null);

  const load = useCallback(() => {
    api.adminLive().then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <p className="text-sm text-ink-muted">Loading live activity…</p>;
  if (!data) return <EmptyState title="Failed to load" />;

  const { openJobs, activeJobs, recentActivity } = data;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">Live Platform Activity</h2>
        <div className="flex items-center gap-4">
          <Button size="sm" variant="ghost" onClick={() => { setLoading(true); load(); }}>Refresh now</Button>
          <AutoRefresh onRefresh={load} interval={30000} />
        </div>
      </div>

      {/* Summary stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-ink">{openJobs.length}</p>
          <p className="text-xs text-ink-muted">Open jobs</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-ink">{openJobs.reduce((sum, j) => sum + j.bid_count, 0)}</p>
          <p className="text-xs text-ink-muted">Live bids</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-ink">{activeJobs.length}</p>
          <p className="text-xs text-ink-muted">In progress</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-ink tabular">{formatAED(openJobs.reduce((sum, j) => sum + (j.max_budget_aed || 0), 0))}</p>
          <p className="text-xs text-ink-muted">Total open budget</p>
        </Card>
      </div>

      {/* Open Jobs with Live Bids */}
      <p className="mb-3 text-sm font-medium text-ink-secondary">Open jobs & live bids</p>
      {openJobs.length === 0 ? (
        <p className="mb-6 text-sm text-ink-muted">No open jobs right now.</p>
      ) : (
        <div className="mb-6 space-y-3">
          {openJobs.map((job) => (
            <Card key={job.id} className="overflow-hidden">
              <div
                className="flex cursor-pointer items-center justify-between p-4 hover:opacity-90"
                onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-mono text-xs text-ink-muted">{job.job_code}</p>
                    <p className="text-sm font-medium text-ink">{formatLabel(job.pickup_terminal)} → {formatLabel(job.delivery_area)}</p>
                    <p className="text-xs text-ink-muted">{job.shipment_type} · {job.container_size !== 'N/A' ? `${job.container_size} ${job.container_type}` : job.equipment_type} · {job.shipper_company || job.shipper_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {job.max_budget_aed && <span className="tabular text-sm font-semibold text-ink">{formatAED(job.max_budget_aed)}</span>}
                  <Badge color="info">{job.bid_count} bid{job.bid_count !== 1 ? 's' : ''}</Badge>
                  <span className="text-xs text-ink-muted">{expandedJob === job.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expandedJob === job.id && (
                <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-ink-muted">Live bids on this job</p>
                    <Link to={`/jobs/${job.id}`} className="text-xs font-medium text-brand-secondary hover:underline">View job →</Link>
                  </div>
                  {job.bids.length === 0 ? (
                    <p className="text-xs text-ink-muted">No bids yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {job.bids.map((bid) => (
                        <div key={bid.id} className="flex items-center justify-between rounded-md px-3 py-2" style={{ background: 'var(--surface-secondary)' }}>
                          <div>
                            <p className="text-sm font-medium text-ink">{bid.carrier_company || bid.carrier_email}</p>
                            <p className="text-xs text-ink-muted">
                              {bid.truck_type && `${formatLabel(bid.truck_type)} · `}
                              ETA: {bid.eta_at ? formatDateTime(bid.eta_at) : `${bid.eta_minutes}min`}
                              {bid.rating_avg && ` · ★ ${bid.rating_avg}`}
                              {bid.completed_jobs && ` · ${bid.completed_jobs} jobs`}
                            </p>
                            {bid.notes && <p className="mt-0.5 text-xs text-ink-muted italic">"{bid.notes}"</p>}
                          </div>
                          <div className="text-right">
                            <p className="tabular text-sm font-bold text-ink">{formatAED(bid.amount_aed)}</p>
                            <StatusBadge status={bid.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Active Jobs (in progress) */}
      <p className="mb-3 text-sm font-medium text-ink-secondary">In-progress jobs</p>
      {activeJobs.length === 0 ? (
        <p className="mb-6 text-sm text-ink-muted">No jobs in progress.</p>
      ) : (
        <Card className="mb-6 overflow-hidden">
          <div className="overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-4 py-2.5 font-medium">Job</th>
                  <th className="px-4 py-2.5 font-medium">Route</th>
                  <th className="px-4 py-2.5 font-medium">Shipper</th>
                  <th className="px-4 py-2.5 font-medium">Carrier</th>
                  <th className="px-4 py-2.5 font-medium">Price</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Escrow</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.map((j) => (
                  <tr key={j.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-4 py-2.5">
                      <Link to={`/jobs/${j.id}`} className="font-mono text-xs text-brand-secondary hover:underline">{j.job_code}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{formatLabel(j.pickup_terminal)} → {formatLabel(j.delivery_area)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{j.shipper_company || j.shipper_email}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">{j.carrier_company || j.carrier_email || '—'}</td>
                    <td className="tabular px-4 py-2.5 font-medium text-ink">{formatAED(j.agreed_price_aed)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={j.status} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={j.escrow_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent Activity Feed */}
      <p className="mb-3 text-sm font-medium text-ink-secondary">Recent activity</p>
      <Card className="overflow-hidden">
        {recentActivity.length === 0 ? (
          <p className="p-4 text-sm text-ink-muted">No recent activity.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {recentActivity.map((a) => (
              <div key={a.id} className="flex items-start justify-between px-4 py-3">
                <div className="flex items-start gap-3">
                  <ActionBadge action={a.action} />
                  <div>
                    <p className="text-sm text-ink">{a.details || a.action}</p>
                    <p className="text-xs text-ink-muted">
                      {a.actor_email && `by ${a.actor_email}`}
                      {a.entity_type && ` · ${a.entity_type} #${a.entity_id}`}
                      {a.before_state && a.after_state && ` · ${a.before_state} → ${a.after_state}`}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink-muted">{formatDateTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default LiveActivityTab;
