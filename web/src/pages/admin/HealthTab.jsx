import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth, roleHome } from '../../lib/auth.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { usePageTitle } from '../../lib/seo.jsx';
import { formatAED, formatDate, formatDateTime, formatLabel } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Label, Badge, Select, EmptyState, Pagination } from '../../components/ui.jsx';
import { IconShield, IconAlert, IconCheck, IconInfo, IconUser, IconFile, IconWallet } from '../../components/icons.jsx';

const TABS = ['Health', 'Live activity', 'Verification', 'Account approvals', 'Members', 'Disputes', 'Registrations', 'Payout SLA', 'Audit log', 'Revenue', 'Settings'];


function HealthTab() {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.adminHealth().then((d) => setHealth(d.health)).catch(() => {}); }, []);
  if (!health) return <p className="text-sm text-ink-muted">Loading…</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Open jobs" value={health.openJobs} />
        <Stat label="Total bids" value={health.totalBids} />
        <Stat label="Avg bids / job" value={health.avgBidsPerJob} />
        <Stat label="Completion rate" value={`${health.completionRate}%`} tone="accent" />
        <Stat label="Escrow held" value={formatAED(health.escrowHeld)} />
      </div>

      <EscrowConfirmationPanel />

      <p className="mt-6 mb-3 text-sm font-medium text-ink-secondary">Lane health</p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-fade-x">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                <th className="px-5 py-3 font-medium">Lane</th>
                <th className="px-5 py-3 font-medium">Base price</th>
                <th className="px-5 py-3 font-medium">On-time %</th>
                <th className="px-5 py-3 font-medium">Monthly loads</th>
              </tr>
            </thead>
            <tbody>
              {health.lanes.map((l) => (
                <tr key={l.laneId} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-5 py-3 font-medium text-ink">{formatLabel(l.terminal)} → {formatLabel(l.area)}</td>
                  <td className="tabular px-5 py-3 text-ink-secondary">{formatAED(l.basePriceAed)}</td>
                  <td className="px-5 py-3">
                    <Badge color={l.onTimePct >= 90 ? 'success' : 'warning'}>{l.onTimePct}%</Badge>
                  </td>
                  <td className="tabular px-5 py-3 text-ink-secondary">{l.monthlyLoads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const ESCROW_PAGE_SIZE = 20;

// POST /api/admin/confirm-receipt moves escrow HELD -> FUNDED. Built and
// tested server-side but had no caller anywhere in the app before this
// redesign pass — there was literally no way, through the UI, to advance
// escrow past HELD. Filters server-side via escrowStatus=HELD (rather than
// over-fetching a fixed-size page of AWARDED+ jobs and filtering
// client-side, which silently hid any HELD job past the first page) so
// `total` and the Pagination control below are accurate at any scale.
function EscrowConfirmationPanel() {
  const { addToast } = useToasts();
  const [jobs, setJobs] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState(null);

  function load() {
    api.listJobs({ status: 'AWARDED,PICKED_UP,IN_TRANSIT,DELIVERED', escrowStatus: 'HELD', limit: ESCROW_PAGE_SIZE, offset })
      .then((d) => { setJobs(d.jobs); setTotal(d.total ?? d.jobs.length); })
      .catch(() => { setJobs([]); setTotal(0); });
  }
  useEffect(load, [offset]);

  async function confirm(job) {
    setBusyId(job.id);
    try {
      await api.adminConfirmReceipt(job.id);
      addToast({ type: 'payout_released', title: 'Receipt confirmed', body: `${job.job_code} escrow is now FUNDED.` });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not confirm receipt', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (jobs === null) return null;

  return (
    <div className="mt-6">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-secondary">
        <IconWallet size={16} /> Escrow awaiting fund confirmation ({total})
      </p>
      {jobs.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing HELD right now — every awarded job's funds have been confirmed as received.</p>
      ) : (
        <>
          <div className="space-y-2">
            {jobs.map((j) => (
              <Card key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-mono text-xs text-ink-muted">{j.job_code}</p>
                  <p className="tabular font-semibold text-ink">{formatAED(j.agreed_price_aed)}</p>
                </div>
                <Button size="sm" variant="accent" loading={busyId === j.id} onClick={() => confirm(j)}>Confirm receipt</Button>
              </Card>
            ))}
          </div>
          <Pagination total={total} limit={ESCROW_PAGE_SIZE} offset={offset} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

export default HealthTab;
