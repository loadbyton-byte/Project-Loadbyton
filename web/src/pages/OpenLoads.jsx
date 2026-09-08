import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatLabel, CONTAINER_EQUIPMENT, EQUIPMENT_TYPES, equipmentLabel, cargoTypeLabel, SHIPMENT_TYPES, depotLabel } from '../lib/constants.js';
import { EmptyState, ErrorState, Select, Input, Pagination, BentoStat, Card, Button } from '../components/ui.jsx';
import { IconAlert, IconPackage, IconSearch, IconMapPin } from '../components/icons.jsx';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'price_desc', label: 'Target price: high to low' },
  { value: 'price_asc', label: 'Target price: low to high' },
  { value: 'deadline_asc', label: 'Deadline: soonest' },
];

// "18h left" / "1d 4h left" / "Past due" — the mockup's deadline column
// reads as time-to-act, not a calendar date, which matters more when
// scanning a dense list of bid opportunities under time pressure than the
// exact date does. Scoped to this page only; formatDate (an actual
// calendar date) stays the norm everywhere else that isn't a scan-and-bid
// list.
function timeLeft(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Past due';
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.max(1, totalMinutes)}m left`;
}

// Same per-shipment-type origin/destination derivation the old JobCard grid
// used inline (twice) — extracted once so the table row below isn't a
// third copy of this exact ternary chain.
function jobOrigin(j) {
  if (j.shipment_type === 'EXPORT') return j.export_empty_pickup_location ? depotLabel(j.export_empty_pickup_location) : formatLabel(j.pickup_terminal);
  if (j.shipment_type === 'LOCAL') return formatLabel(j.loading_location || j.pickup_terminal);
  return formatLabel(j.import_pickup_terminal || j.pickup_terminal);
}
function jobDestination(j) {
  if (j.shipment_type === 'EXPORT') return formatLabel(j.export_deposit_terminal || j.pickup_terminal);
  if (j.shipment_type === 'LOCAL') return formatLabel(j.delivery_location || j.delivery_area);
  return formatLabel(j.import_unloading_location || j.delivery_area);
}
function jobEquipmentLabel(j) {
  return CONTAINER_EQUIPMENT.includes(j.equipment_type) ? `${j.container_size} · ${formatLabel(j.container_type)}` : equipmentLabel(j.equipment_type);
}

export default function OpenLoads() {
  usePageTitle('Open loads');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [jobsError, setJobsError] = useState('');
  const [total, setTotal] = useState(0);
  const [equipmentFilter, setEquipmentFilter] = useState('all');
  const [shipmentFilter, setShipmentFilter] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => { api.analytics().then((d) => setAnalytics(d.analytics)).catch(() => {}); }, []);

  // Debounce the search box so every keystroke doesn't fire a request —
  // matches the standard search-as-you-type pattern without a new dependency.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setOffset(0); }, [equipmentFilter, shipmentFilter, sort, debouncedSearch]);

  function loadOpenJobs() {
    setJobs(null);
    setJobsError('');
    const params = { status: 'OPEN', sort, limit: PAGE_SIZE, offset };
    if (equipmentFilter !== 'all') params.equipmentType = equipmentFilter;
    if (shipmentFilter !== 'all') params.shipmentType = shipmentFilter;
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.listJobs(params).then((d) => { setJobs(d.jobs); setTotal(d.total ?? d.jobs.length); }).catch((err) => { setJobs([]); setTotal(0); setJobsError(err.message); });
  }
  useEffect(loadOpenJobs, [equipmentFilter, shipmentFilter, sort, debouncedSearch, offset]);

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Open loads</h1>
      <p className="mt-1 text-sm text-ink-muted">Verified carriers can bid price + ETA. Competitor amounts stay hidden until award.</p>

      {analytics && (
        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <BentoStat label="Active bids" value={analytics.totalBids ?? 0} />
          <BentoStat label="Jobs won" value={analytics.jobsWon ?? 0} />
          <BentoStat label="Pending payout" value={formatAED(analytics.pendingAED)} tone="accent" className="col-span-2 sm:col-span-1" />
        </section>
      )}

      {!user?.is_verified && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <p>Your account isn't verified yet — you can browse open loads, but bidding is locked until an admin approves your TRN, trade licence and insurance.</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job code, address, notes…" className="pl-9" />
        </div>
        <Select value={equipmentFilter} onChange={(e) => setEquipmentFilter(e.target.value)} className="w-auto">
          <option value="all">Equipment: All</option>
          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{equipmentLabel(t)}</option>)}
        </Select>
        <Select value={shipmentFilter} onChange={(e) => setShipmentFilter(e.target.value)} className="w-auto">
          <option value="all">Shipment: All</option>
          {SHIPMENT_TYPES.map((s) => <option key={s} value={s}>{s === 'IMPORT' ? 'Import' : s === 'EXPORT' ? 'Export' : 'Local'}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      <div className="mt-6">
        {jobs === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : jobsError ? (
          <ErrorState title="Couldn't load open loads" description={jobsError} onRetry={loadOpenJobs} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={28} />}
            title={debouncedSearch || equipmentFilter !== 'all' ? 'No loads match these filters' : 'No open loads right now'}
            description={debouncedSearch || equipmentFilter !== 'all' ? 'Try a broader search or clear a filter.' : 'New jobs post here as soon as a shipper creates them. Check back shortly.'}
          />
        ) : (
          <>
            {/* Dense table (Change 1b Phase C) — Open Loads is a scan-many/
                bid-fast list, not a browse-a-few-and-read gallery, so a
                table row per job (job code, route, equipment, target price,
                deadline countdown, one action) fits the task better than
                the card grid Dashboard/Won Jobs/My Bids still use for their
                own, lower-density lists. Desktop-first: below sm, falls
                back to a stacked card layout (a 7-column table doesn't
                survive a 375px screen no matter how it's styled). */}
            <Card className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border-default)' }}>
                    {['Job', 'Route', 'Equipment', 'Target price', 'Deadline', ''].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.id}
                      onClick={() => navigate(`/jobs/${j.id}`)}
                      className="cursor-pointer border-b last:border-0 hover:bg-surface-container"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-ink-muted">{j.job_code}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          <IconMapPin size={13} className="shrink-0 text-ink-muted" />
                          <span className="truncate">{jobOrigin(j)}</span>
                          <span className="shrink-0 text-ink-muted">→</span>
                          <span className="truncate">{jobDestination(j)}</span>
                        </div>
                        {j.cargo_weight_tons != null && <p className="mt-0.5 text-xs text-ink-muted">{j.cargo_type ? `${cargoTypeLabel(j.cargo_type)} · ` : ''}{j.cargo_weight_tons} t</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{jobEquipmentLabel(j)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 font-semibold text-ink">{formatAED(j.max_budget_aed)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-ink-secondary">{timeLeft(j.deadline)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="accent"
                          disabled={!user?.is_verified}
                          onClick={(e) => { e.stopPropagation(); navigate(`/jobs/${j.id}`); }}
                        >
                          {user?.is_verified ? 'Bid' : 'Locked'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Mobile fallback — same data, stacked cards (a table can't
                usefully compress to a narrow screen; this reuses the same
                per-shipment-type helpers as the table above, not a
                duplicate data mapping). */}
            <div className="flex flex-col gap-3 sm:hidden">
              {jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  className="card flex flex-col gap-2 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-muted">{j.job_code}</span>
                    <span className="tabular shrink-0 font-display text-sm font-bold text-ink">{formatAED(j.max_budget_aed)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <IconMapPin size={13} className="shrink-0 text-ink-muted" />
                    <span className="truncate">{jobOrigin(j)}</span>
                    <span className="shrink-0 text-ink-muted">→</span>
                    <span className="truncate">{jobDestination(j)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span>{jobEquipmentLabel(j)}</span>
                    <span className="tabular">{timeLeft(j.deadline)}</span>
                  </div>
                </button>
              ))}
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </div>
  );
}
