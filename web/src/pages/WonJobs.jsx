import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { Button, EmptyState, StatusBadge, RatingPill, Select, Input, Pagination, JobCard } from '../components/ui.jsx';
import { IconPackage, IconSearch } from '../components/icons.jsx';
import { formatLabel, CONTAINER_EQUIPMENT, STATUS_FLOW, equipmentLabel } from '../lib/constants.js';

const ACTIVE_STATUSES = ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'deadline_asc', label: 'Deadline: soonest' },
];

export default function WonJobs() {
  usePageTitle('Won jobs');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState(null);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setOffset(0); }, [sort, debouncedSearch]);

  function load() {
    setError('');
    setJobs(null);
    // F19, fixed independently on both branches, now with real server-side
    // pagination (the status:"a,b,c" list support this needed) instead of
    // over-fetching 200 rows and filtering client-side.
    const params = { mine: 1, status: ACTIVE_STATUSES.join(','), sort, limit: PAGE_SIZE, offset };
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.listJobs(params).then((d) => { setJobs(d.jobs); setTotal(d.total ?? d.jobs.length); }).catch((err) => { setError(err.message); setJobs([]); setTotal(0); });
  }
  useEffect(load, [user.id, sort, debouncedSearch, offset]);

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Won jobs</h1>
      <p className="mt-1 text-sm text-ink-muted">Your active shipments — from award through delivery. Open a job to advance its status, upload POD, or chat with the shipper.</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job code, address…" className="pl-9" />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      <div className="mt-5">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center" style={{ borderColor: 'var(--border-strong)' }}>
            <p className="font-display text-base font-semibold" style={{ color: 'var(--status-danger)' }}>Couldn't load won jobs — {error}</p>
            <Button onClick={load}>Retry</Button>
          </div>
        ) : jobs === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={28} />}
            title={debouncedSearch ? 'No won jobs match this search' : 'No won jobs yet'}
            description={debouncedSearch ? 'Try a different search term.' : 'Place bids, get awarded, and start earning.'}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((j) => (
                <JobCard
                  key={j.id}
                  onClick={() => navigate(`/jobs/${j.id}`)}
                  jobCode={j.job_code}
                  topRight={<StatusBadge status={j.status} />}
                  origin={formatLabel(j.pickup_terminal)}
                  destination={formatLabel(j.delivery_area)}
                  chips={[CONTAINER_EQUIPMENT.includes(j.equipment_type) ? `${j.container_size} ${formatLabel(j.container_type)}` : equipmentLabel(j.equipment_type)]}
                  meta={
                    <div className="flex items-center justify-between gap-3">
                      <ProgressDots status={j.status} />
                      <RatingPill rating={j.shipper_rating} />
                    </div>
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

function ProgressDots({ status }) {
  const idx = STATUS_FLOW.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {STATUS_FLOW.slice(1).map((s) => {
        const stepIdx = STATUS_FLOW.indexOf(s);
        const done = stepIdx <= idx;
        return (
          <span
            key={s}
            title={formatLabel(s)}
            className="h-1.5 w-4 rounded-full"
            style={{ background: done ? 'var(--brand-accent)' : 'var(--outline-variant)' }}
          />
        );
      })}
    </div>
  );
}
