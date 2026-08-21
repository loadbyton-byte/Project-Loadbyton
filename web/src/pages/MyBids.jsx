import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatLabel, equipmentLabel, formatDateTime } from '../lib/constants.js';
import { Button, Badge, EmptyState, RatingPill, Select, Input, Pagination, JobCard } from '../components/ui.jsx';
import { IconPackage, IconX, IconSearch } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';

const STATUS_COLOR = { PENDING: 'neutral', ACCEPTED: 'success', REJECTED: 'danger', WITHDRAWN: 'neutral' };
const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'price_asc', label: 'Price: low to high' },
];

export default function MyBids() {
  usePageTitle('My bids');
  const [bids, setBids] = useState(null);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const { addToast } = useToasts();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setOffset(0); }, [sort, debouncedSearch]);

  function load() {
    const params = { sort, limit: PAGE_SIZE, offset };
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.myBids(params).then((d) => { setBids(d.bids); setTotal(d.total ?? d.bids.length); }).catch(() => { setBids([]); setTotal(0); });
  }
  useEffect(load, [sort, debouncedSearch, offset]);

  async function withdraw(bid) {
    setBusyId(bid.id);
    try {
      await api.withdrawBid(bid.id);
      addToast({ type: 'status_change', title: 'Bid withdrawn', body: `Your bid on ${bid.job_code} was withdrawn.` });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not withdraw', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">My bids</h1>
      <p className="mt-1 text-sm text-ink-muted">Your competitive quotes on open loads.</p>

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
        {bids === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : bids.length === 0 ? (
          <EmptyState
            icon={<IconPackage size={28} />}
            title={debouncedSearch ? 'No bids match this search' : 'No bids yet'}
            description={debouncedSearch ? 'Try a different search term.' : 'Browse open loads and place your first bid.'}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bids.map((b) => (
                <JobCard
                  key={b.id}
                  jobCode={b.job_code}
                  topRight={<Badge color={STATUS_COLOR[b.status] || 'neutral'}>{b.status}</Badge>}
                  priceLabel={formatAED(b.amount_aed)}
                  origin={formatLabel(b.pickup_terminal)}
                  destination={formatLabel(b.delivery_area)}
                  chips={[b.eta_at ? `Delivery by ${formatDateTime(b.eta_at)}` : 'ETA n/a', ...(b.truck_type ? [equipmentLabel(b.truck_type)] : [])]}
                  meta={
                    <div className="flex items-center justify-between">
                      <RatingPill rating={b.shipper_rating} />
                      <div className="flex items-center gap-2">
                        {b.status === 'PENDING' && b.job_status === 'OPEN' && (
                          <Button variant="ghost" size="sm" onClick={() => withdraw(b)} loading={busyId === b.id}>
                            <IconX size={13} /> Withdraw
                          </Button>
                        )}
                        <Link to={`/jobs/${b.job_id}`} className="text-sm font-semibold text-brand-secondary hover:underline">
                          {b.status === 'ACCEPTED' ? 'Track' : 'View'}
                        </Link>
                      </div>
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
