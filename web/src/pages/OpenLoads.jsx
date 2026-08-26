import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatDate, formatLabel, CONTAINER_EQUIPMENT, EQUIPMENT_TYPES, equipmentLabel, SHIPMENT_TYPES, depotLabel } from '../lib/constants.js';
import { EmptyState, Badge, Select, Input, RatingPill, Pagination, BentoStat, JobCard } from '../components/ui.jsx';
import { IconAlert, IconPackage, IconSearch } from '../components/icons.jsx';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'price_desc', label: 'Target price: high to low' },
  { value: 'price_asc', label: 'Target price: low to high' },
  { value: 'deadline_asc', label: 'Deadline: soonest' },
];

export default function OpenLoads() {
  usePageTitle('Open loads');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [jobs, setJobs] = useState(null);
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

  useEffect(() => {
    setJobs(null);
    const params = { status: 'OPEN', sort, limit: PAGE_SIZE, offset };
    if (equipmentFilter !== 'all') params.equipmentType = equipmentFilter;
    if (shipmentFilter !== 'all') params.shipmentType = shipmentFilter;
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.listJobs(params).then((d) => { setJobs(d.jobs); setTotal(d.total ?? d.jobs.length); }).catch(() => { setJobs([]); setTotal(0); });
  }, [equipmentFilter, shipmentFilter, sort, debouncedSearch, offset]);

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
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={28} />}
            title={debouncedSearch || equipmentFilter !== 'all' ? 'No loads match these filters' : 'No open loads right now'}
            description={debouncedSearch || equipmentFilter !== 'all' ? 'Try a broader search or clear a filter.' : 'New jobs post here as soon as a shipper creates them. Check back shortly.'}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((j) => (
                <JobCard
                  key={j.id}
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  jobCode={j.job_code}
                  topRight={
                    <div className="flex flex-col items-end gap-1">
                    </div>
                  }
                  priceLabel={`Target ${formatAED(j.max_budget_aed)}`}
                  origin={j.shipment_type === 'EXPORT' ? (j.export_empty_pickup_location ? depotLabel(j.export_empty_pickup_location) : formatLabel(j.pickup_terminal)) : j.shipment_type === 'LOCAL' ? formatLabel(j.loading_location || j.pickup_terminal) : formatLabel(j.import_pickup_terminal || j.pickup_terminal)}
                  destination={j.shipment_type === 'EXPORT' ? formatLabel(j.export_deposit_terminal || j.pickup_terminal) : j.shipment_type === 'LOCAL' ? formatLabel(j.delivery_location || j.delivery_area) : formatLabel(j.import_unloading_location || j.delivery_area)}
                  chips={[
                    j.shipment_type || 'IMPORT',
                    CONTAINER_EQUIPMENT.includes(j.equipment_type) ? `${j.container_size} ${formatLabel(j.container_type)}` : equipmentLabel(j.equipment_type),
                    ...(j.cargo_weight_tons != null ? [`${j.cargo_weight_tons} t`] : []),
                    ...(j.container_count > 1 ? [`×${j.container_count} containers`] : []),
                    ...(j.truck_count > 1 ? [`×${j.truck_count} trucks`] : []),
                    ...(j.shipment_type === 'IMPORT' && j.import_empty_return_location ? [`→ ${depotLabel(j.import_empty_return_location)}`] : []),
                    ...(j.shipment_type === 'EXPORT' && j.export_loading_location ? [`via ${formatLabel(j.export_loading_location)}`] : []),
                    ...(j.shipment_type === 'LOCAL' && j.ready_at ? [`loads ${new Date(j.ready_at).toLocaleDateString()}`] : []),
                  ]}
                  meta={
                    <span className="flex items-center justify-between">
                      <span>Deadline {formatDate(j.deadline)}</span>
                      <RatingPill rating={j.shipper_rating} />
                    </span>
                  }
                />
              ))}
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </div>
  );
}
