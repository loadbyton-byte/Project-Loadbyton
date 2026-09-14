import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Card, EmptyState, ErrorState, Input, Pagination, RatingPill, Skeleton } from '../components/ui.jsx';
import { IconSearch, IconTruck } from '../components/icons.jsx';

const PAGE_SIZE = 20;

// A shipper (or forwarder) previously had no page to browse verified
// transporters at all — only Landing.jsx's anonymous 4-card marketing
// preview, or a broker's own private roster (BrokerCarriers.jsx). This is
// a real, searchable, paginated directory (GET /api/transporters), scoped
// server-side to the caller's demo/real partition the same way Open Loads
// already is.
export default function Transporters() {
  usePageTitle('Transporters');
  const { isRtl } = useLocale();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setOffset(0), [debouncedSearch]);

  function load() {
    setError('');
    const params = { limit: PAGE_SIZE, offset };
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.transporters(params).then((d) => { setRows(d.transporters); setTotal(d.total); }).catch((e) => { setRows([]); setError(e.message); });
  }
  useEffect(load, [debouncedSearch, offset]);

  return (
    <div className="container-page py-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <h1 className="font-display text-xl font-bold text-ink">Transporters</h1>
      <p className="mt-1 text-sm text-ink-muted">Verified transporters available across the UAE — trade licence, TRN and insurance checked before they can bid.</p>

      <div className="mt-4 max-w-sm">
        <div className="relative">
          <IconSearch size={15} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRtl ? 'right-3' : 'left-3'}`} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by company name…" className={isRtl ? 'pr-9' : 'pl-9'} />
        </div>
      </div>

      <div className="mt-5">
        {rows === null ? (
          <Skeleton variant="card" count={6} className="sm:grid-cols-2 lg:grid-cols-3" />
        ) : error ? (
          <ErrorState title="Couldn't load transporters" description={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconTruck size={28} />} title="No transporters found" description={debouncedSearch ? 'Try a different search.' : 'No verified transporters yet.'} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((t) => (
                <Card key={t.id} className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-container-high)' }}>
                      <IconTruck size={18} className="text-brand-accent" />
                    </div>
                    {t.tier && <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent-on-tint)' }}>{t.tier}</span>}
                  </div>
                  <p className="mt-3 font-display text-base font-semibold text-ink">{t.name}</p>
                  <div className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                    <RatingPill rating={t.rating} /> <span>· {t.completedJobs} completed job{t.completedJobs === 1 ? '' : 's'}</span>
                  </div>
                  {t.coverageZones && <p className="mt-2 text-xs text-ink-muted">Coverage: {t.coverageZones}</p>}
                  {t.fleetSize > 0 && <p className="mt-1 text-xs text-ink-muted">Fleet size: {t.fleetSize}</p>}
                </Card>
              ))}
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </div>
  );
}
