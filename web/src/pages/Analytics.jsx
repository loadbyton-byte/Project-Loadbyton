import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED } from '../lib/constants.js';
import { BentoStat, Spinner } from '../components/ui.jsx';
import { IconTrendUp, IconStar } from '../components/icons.jsx';

// Promoted from the stats strip every dashboard already showed inline
// (Dashboard.jsx / OpenLoads.jsx) into its own route — matches the Stitch
// analytics_performance_dashboard screen. Same GET /api/analytics/mine
// payload, no new backend needed; this page just gives it more room and a
// permanent link (Shell.jsx drawer nav) instead of only ever appearing as
// a small strip above the job list.
export default function Analytics() {
  usePageTitle('Analytics');
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => { api.analytics().then((d) => setAnalytics(d.analytics)).catch(() => {}); }, []);

  if (!analytics) {
    return <div className="container-page flex justify-center py-24"><Spinner size={28} /></div>;
  }

  const isCarrier = user.role === 'CARRIER';

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

      <p className="mt-6 text-xs text-ink-muted">
        Tier <span className="font-semibold text-ink">{analytics.tier}</span> — loyalty tiers rise with completed volume and on-time delivery.
      </p>
    </div>
  );
}
