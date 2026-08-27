import { formatAED, formatDateTime, equipmentLabel } from '../../lib/constants.js';
import { Button, Badge, RatingPill } from '../../components/ui.jsx';

export default function BidList({ bids = [], job, isShipper, onAward, busy }) {
  if (!job) return null;
  if (bids.length === 0) {
    return <p className="text-sm text-ink-muted">No bids yet.</p>;
  }
  return (
    <div className="space-y-3">
      {bids.map((b) => (
        <div
          key={b.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
          style={{ borderColor: b.status === 'ACCEPTED' ? 'var(--status-success)' : 'var(--border-default)' }}
        >
          <div className="min-w-0">
            <p className="tabular font-display text-base font-semibold text-ink">
              {b.masked ? 'Hidden until award' : formatAED(b.amount_aed)}
            </p>
            <p className="text-xs text-ink-muted">
              {b.masked
                ? 'Competing bid'
                : `Delivery by ${formatDateTime(b.eta_at)} · ${b.truck_type ? equipmentLabel(b.truck_type) : 'equipment n/a'}`}
            </p>
            {!b.masked && b.carrier_company && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
                <span className="truncate">{b.carrier_company}</span> <RatingPill rating={b.carrier_rating} />
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge color={b.status === 'ACCEPTED' ? 'success' : b.status === 'REJECTED' ? 'danger' : 'neutral'}>
              {b.status}
            </Badge>
            {isShipper && job.status === 'OPEN' && b.status === 'PENDING' && onAward && (
              <Button variant="accent" onClick={() => onAward(b.id)} loading={busy}>
                Award
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
