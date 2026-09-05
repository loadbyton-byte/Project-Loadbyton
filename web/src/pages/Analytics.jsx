import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatLabel } from '../lib/constants.js';
import { BentoStat, Spinner, Card, ErrorState } from '../components/ui.jsx';
import { IconTrendUp, IconStar } from '../components/icons.jsx';

// Promoted from the stats strip every dashboard already showed inline
// (Dashboard.jsx / OpenLoads.jsx) into its own route — matches the Stitch
// analytics_performance_dashboard screen. Same GET /api/analytics/mine
// payload, no new backend needed; this page just gives it more room and a
// permanent link (Shell.jsx drawer nav) instead of only ever appearing as
// a small strip above the job list.
//
// monthlyTrend/statusBreakdown/topLanes are derived server-side in JS (see
// server/routes/retention.routes.js) from the same job/payout rows the
// scalar totals above already come from — rendered here with plain SVG/CSS,
// no charting library (the app has none today and doesn't need one at this
// data volume).
const STATUS_COLOR = {
  DRAFT: 'var(--ink-muted)', OPEN: 'var(--status-info)', AWARDED: 'var(--brand-accent)',
  PICKED_UP: 'var(--status-warning)', IN_TRANSIT: 'var(--status-warning)',
  DELIVERED: 'var(--status-success)', COMPLETED: 'var(--status-success)',
  CANCELLED: 'var(--status-danger)', DISPUTED: 'var(--status-danger)',
};

function MonthlyTrendChart({ months, isCarrier }) {
  const max = Math.max(1, ...months.map((m) => m.amountAED));
  const barW = 34;
  const gap = 14;
  const chartH = 120;
  const width = months.length * (barW + gap);
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={chartH + 36} role="img" aria-label="Monthly trend">
        {months.map((m, i) => {
          const h = m.amountAED > 0 ? Math.max(4, (m.amountAED / max) * chartH) : 0;
          const x = i * (barW + gap);
          return (
            <g key={m.key}>
              <rect x={x} y={chartH - h} width={barW} height={h} rx={4} fill="var(--brand-accent)" opacity={m.amountAED > 0 ? 1 : 0.15} />
              {m.amountAED > 0 && (
                <text x={x + barW / 2} y={chartH - h - 6} textAnchor="middle" fontSize="10" fill="var(--ink-secondary)" fontFamily="var(--font-mono, monospace)">
                  {Math.round(m.amountAED / 1000)}k
                </text>
              )}
              <text x={x + barW / 2} y={chartH + 16} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">{m.label}</text>
              <text x={x + barW / 2} y={chartH + 30} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{m.count} job{m.count === 1 ? '' : 's'}</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-ink-muted">{isCarrier ? 'Net earnings released, by month' : 'Spend on completed jobs, by month'} (last 6 months)</p>
    </div>
  );
}

function StatusBreakdownBar({ breakdown }) {
  const total = breakdown.reduce((s, b) => s + b.count, 0);
  if (!total) return <p className="text-sm text-ink-muted">No jobs yet.</p>;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-container)' }}>
        {breakdown.map((b) => (
          <div
            key={b.status}
            style={{ width: `${(b.count / total) * 100}%`, background: STATUS_COLOR[b.status] || 'var(--ink-muted)' }}
            title={`${b.status}: ${b.count}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {breakdown.map((b) => (
          <span key={b.status} className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[b.status] || 'var(--ink-muted)' }} />
            {b.status.replaceAll('_', ' ')} <span className="tabular font-semibold text-ink">{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TopLanes({ lanes }) {
  if (!lanes.length) return <p className="text-sm text-ink-muted">Not enough job history yet.</p>;
  return (
    <ul className="space-y-2">
      {lanes.map((l, i) => (
        <li key={`${l.pickupTerminal}-${l.deliveryArea}`} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-ink">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: 'var(--brand-primary)' }}>{i + 1}</span>
            {formatLabel(l.pickupTerminal)} → {formatLabel(l.deliveryArea)}
          </span>
          <span className="tabular text-xs font-semibold text-ink-muted">{l.count} job{l.count === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Analytics() {
  usePageTitle('Analytics');
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setError('');
    api.analytics().then((d) => setAnalytics(d.analytics)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  if (error) {
    return <div className="container-page py-10"><ErrorState title="Couldn't load your analytics" description={error} onRetry={load} /></div>;
  }
  if (!analytics) {
    return <div className="container-page flex justify-center py-24"><Spinner size={28} /></div>;
  }

  const isCarrier = user.role === 'CARRIER';
  const months = analytics.monthlyTrend || [];
  const breakdown = analytics.statusBreakdown || [];
  const lanes = analytics.topLanes || [];

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Performance</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {isCarrier ? 'Your bidding and delivery performance.' : 'Your spend and negotiation performance vs. the lane index.'}
      </p>

      <section className="mt-5 grid grid-cols-2 gap-3">
        {isCarrier ? (
          <>
            <BentoStat label="Total bids" value={analytics.totalBids} />
            <BentoStat label="Jobs won" value={analytics.jobsWon} />
            <BentoStat label="Paid out" value={formatAED(analytics.paidOutAED)} tone="accent" />
            <BentoStat label="Pending payout" value={formatAED(analytics.pendingAED)} />
            <BentoStat
              label="On-time delivery"
              value={`${analytics.onTime}%`}
              icon={<IconTrendUp size={20} />}
              span={2}
            />
            <BentoStat
              label="Rating"
              value={analytics.rating ? Number(analytics.rating).toFixed(1) : '—'}
              icon={<IconStar size={18} />}
              span={2}
            />
          </>
        ) : (
          <>
            <BentoStat label="Jobs posted" value={analytics.jobsPosted} />
            <BentoStat label="Jobs completed" value={analytics.jobsCompleted} />
            <BentoStat label="Active jobs" value={analytics.activeJobs} />
            <BentoStat label="Total spent" value={formatAED(analytics.totalSpentAED)} />
            <BentoStat
              label="Savings vs. lane index"
              value={`${analytics.savingsPercent}%`}
              tone="accent"
              icon={<IconTrendUp size={20} />}
              span={2}
            />
            <BentoStat
              label="Rating"
              value={analytics.rating ? Number(analytics.rating).toFixed(1) : '—'}
              icon={<IconStar size={18} />}
              span={2}
            />
          </>
        )}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header><Card.Title>{isCarrier ? 'Earnings trend' : 'Spend trend'}</Card.Title></Card.Header>
          <Card.Content><MonthlyTrendChart months={months} isCarrier={isCarrier} /></Card.Content>
        </Card>
        <Card>
          <Card.Header><Card.Title>Job status breakdown</Card.Title></Card.Header>
          <Card.Content><StatusBreakdownBar breakdown={breakdown} /></Card.Content>
        </Card>
        <Card className="lg:col-span-2">
          <Card.Header><Card.Title>Top lanes</Card.Title></Card.Header>
          <Card.Content><TopLanes lanes={lanes} /></Card.Content>
        </Card>
      </div>

      <p className="mt-6 text-xs text-ink-muted">
        Tier <span className="font-semibold text-ink">{analytics.tier}</span> — loyalty tiers rise with completed volume and on-time delivery.
      </p>
    </div>
  );
}
