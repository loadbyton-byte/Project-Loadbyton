import React from 'react';
import { IconStar, IconMapPin } from './icons.jsx';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Button
const BUTTON_VARIANTS = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  outline: 'btn-secondary',
  success: 'btn-success',
  link: 'btn-link',
};
const BUTTON_SIZES = { sm: 'btn-sm', md: '', lg: 'btn-lg' };

export function Button({ variant = 'primary', size = 'md', className, children, loading, ...props }) {
  return (
    <button className={cx(BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary, BUTTON_SIZES[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Card
export function Card({ className, children, ...props }) {
  return (
    <div className={cx('card', className)} {...props}>
      {children}
    </div>
  );
}
Card.Header = function CardHeader({ className, children, ...props }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 border-b px-5 py-4', className)} style={{ borderColor: 'var(--border-default)' }} {...props}>
      {children}
    </div>
  );
};
Card.Title = function CardTitle({ className, children, ...props }) {
  return (
    <h3 className={cx('font-display text-base font-semibold text-ink', className)} {...props}>
      {children}
    </h3>
  );
};
Card.Content = function CardContent({ className, children, ...props }) {
  return (
    <div className={cx('p-5', className)} {...props}>
      {children}
    </div>
  );
};
Card.Footer = function CardFooter({ className, children, ...props }) {
  return (
    <div className={cx('flex items-center justify-end gap-2 border-t px-5 py-4', className)} style={{ borderColor: 'var(--border-default)' }} {...props}>
      {children}
    </div>
  );
};

// ----------------------------------------------------------------- Badge
const BADGE_COLORS = {
  neutral: { background: 'var(--bg-raised)', color: 'var(--text-secondary)' },
  success: { background: 'var(--status-success-bg)', color: 'var(--status-success)' },
  warning: { background: 'var(--status-warning-bg)', color: 'var(--status-warning)' },
  danger: { background: 'var(--status-danger-bg)', color: 'var(--status-danger)' },
  info: { background: 'var(--status-info-bg)', color: 'var(--status-info)' },
  accent: { background: 'var(--brand-accent-bg)', color: 'var(--brand-accent)' },
};

export function Badge({ color = 'neutral', dot = true, className, children }) {
  const style = BADGE_COLORS[color] || BADGE_COLORS.neutral;
  return (
    <span className={cx('badge', className)} style={style}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  );
}

// -------------------------------------------------------- status helpers
const JOB_STATUS_COLOR = {
  DRAFT: 'neutral', OPEN: 'info', AWARDED: 'accent', PICKED_UP: 'warning',
  IN_TRANSIT: 'warning', DELIVERED: 'success', COMPLETED: 'success',
  CANCELLED: 'danger', DISPUTED: 'danger',
};
export function StatusBadge({ status }) {
  return <Badge color={JOB_STATUS_COLOR[status] || 'neutral'}>{status?.replaceAll('_', ' ')}</Badge>;
}

const ESCROW_COLOR = { PENDING: 'neutral', HELD: 'warning', FUNDED: 'info', RELEASED: 'success', DISPUTED: 'danger' };
export function EscrowBadge({ status }) {
  return <Badge color={ESCROW_COLOR[status] || 'neutral'}>Escrow: {status}</Badge>;
}

// ------------------------------------------------------------ RatingPill
// Ratings previously only showed on the public carrier directory
// (Landing.jsx) — a shipper picking between bids, or a carrier scanning
// open loads, had no counterparty signal without opening the job. Renders
// nothing for null/undefined (a shipper with zero ratings yet, or a job
// with no carrier assigned) rather than a misleading "0.0".
export function RatingPill({ rating, count, className }) {
  if (rating === null || rating === undefined) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-medium text-ink-secondary', className)}>
      <IconStar size={12} style={{ color: 'var(--brand-accent)' }} />
      {Number(rating).toFixed(1)}
      {count !== undefined && count !== null && <span className="text-ink-muted">({count})</span>}
    </span>
  );
}

// ------------------------------------------------------------ Pagination
// Real "page X of Y" pagination — the API previously had a limit/offset
// ceiling with no way to see or reach a second page from the UI at all.
export function Pagination({ total, limit, offset, onChange }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <span className="tabular text-xs">Page {page} of {pageCount}</span>
        <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Input
export function Label({ className, children, ...props }) {
  return (
    <label className={cx('label', className)} {...props}>
      {children}
    </label>
  );
}
export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx('input', className)} {...props} />;
});
export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx('textarea', className)} {...props} />;
});
export const Select = React.forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx('select', className)} {...props}>
      {children}
    </select>
  );
});

// --------------------------------------------------------------- Spinner
export function Spinner({ size = 20, className }) {
  return (
    <svg className={cx('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ------------------------------------------------------------ EmptyState
export function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center', className)} style={{ borderColor: 'var(--border-strong)' }}>
      {icon && <div className="text-ink-muted">{icon}</div>}
      <div>
        <p className="font-display text-base font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ Stat
export function Stat({ label, value, sub, tone = 'default' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cx('tabular mt-1.5 font-display text-3xl font-bold tracking-tight', tone === 'accent' ? 'text-brand-accent' : 'text-ink')}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

// -------------------------------------------------------------- BentoStat
// The dashboard stat-grid cell every Stitch shipper/carrier dashboard opens
// with (label-caps + a big number). A 2-up (or wider, with span) grid cell —
// unlike Stat above (a standalone card), this is meant to sit inside a
// `grid grid-cols-2 gap-3` wrapper the page provides.
export function BentoStat({ label, value, icon, tone = 'default', span, className }) {
  return (
    <div
      className={cx('flex flex-col gap-1 rounded-lg p-4', span === 2 && 'col-span-2 flex-row items-center justify-between', className)}
      style={{ background: tone === 'accent' ? 'var(--surface-container-high)' : 'var(--surface-container-low)', border: '1px solid var(--border-subtle)' }}
    >
      <div className={cx(span === 2 && 'flex flex-col gap-1')}>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
        <p className="tabular font-display text-2xl font-extrabold text-ink">{value}</p>
      </div>
      {icon && <span className="text-brand-accent">{icon}</span>}
    </div>
  );
}

// --------------------------------------------------------------- JobCard
// The marketplace's primary element (Dashboard, OpenLoads, WonJobs, MyBids
// all rendered a near-duplicate of this by hand before the redesign) — a
// monospaced job code + AED price header, a route-path visual (origin dot
// → line → destination dot), and a chip footer. `onClick`/`href` both
// optional; renders as a plain div if neither is given.
export function JobCard({ jobCode, topRight, priceLabel, origin, destination, chips = [], meta, onClick, className }) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cx(
        'card w-full overflow-hidden text-left transition-shadow duration-200',
        onClick && 'cursor-pointer hover:shadow-elevated hover:-translate-y-0.5',
        className
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-xs font-semibold text-ink-muted">{jobCode}</span>
          <div className="flex items-center gap-2">
            {priceLabel && <span className="font-mono text-sm font-bold text-ink">{priceLabel}</span>}
            {topRight}
          </div>
        </div>

        {(origin || destination) && (
          <div className="flex items-start gap-3 py-1">
            <div className="flex flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--brand-accent)' }} />
              <span className="my-0.5 h-6 w-px" style={{ background: 'var(--border-strong)' }} />
              <IconMapPin size={12} className="text-ink-muted" />
            </div>
            <div className="flex flex-1 flex-col gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Origin</p>
                <p className="text-sm font-semibold text-ink">{origin}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Destination</p>
                <p className="text-sm font-semibold text-ink">{destination}</p>
              </div>
            </div>
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip, i) => (
              <span key={i} className="rounded-md px-2 py-1 font-mono text-[11px] font-medium text-ink-secondary" style={{ background: 'var(--surface-container)' }}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {meta && <div className="border-t pt-2.5 text-xs text-ink-muted" style={{ borderColor: 'var(--border-subtle)' }}>{meta}</div>}
      </div>
    </Wrapper>
  );
}

// ---------------------------------------------------------- StatusTracker
// The 6-stage logistics stepper (OPEN → AWARDED → PICKED_UP → IN_TRANSIT →
// DELIVERED → COMPLETED): a solid line with circular nodes — filled accent
// for completed, a pulsing ring for the active node, ghosted slate for
// upcoming. `steps` is an array of { key, label }; `currentIndex` is the
// index of the active step. Pass `terminal="danger"` when the job is
// CANCELLED/DISPUTED to recolor the whole tracker red instead of accent.
export function StatusTracker({ steps, currentIndex, terminal, className }) {
  return (
    <div className={cx('flex w-full items-center', className)}>
      {steps.map((step, i) => {
        const done = i < currentIndex || (terminal && i <= currentIndex);
        const active = i === currentIndex && !terminal;
        const color = terminal === 'danger' ? 'var(--status-danger)' : 'var(--brand-accent)';
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-1.5" style={{ width: 0, minWidth: 'fit-content' }}>
              <span
                className={cx('relative flex h-3.5 w-3.5 items-center justify-center rounded-full', active && 'animate-pulse')}
                style={{ background: done || active ? color : 'var(--surface-container-high)', border: done || active ? 'none' : '2px solid var(--outline-variant)' }}
              />
              <span className={cx('whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-wide', done || active ? 'text-ink' : 'text-ink-muted')}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className="mx-1 h-0.5 flex-1" style={{ background: i < currentIndex || terminal ? color : 'var(--outline-variant)' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- ChatThread
// Shared by every message-thread screen (job messages, disputes, support).
// `messages`: [{ id, body, senderLabel, mine, at, variant }] — variant lets
// a dispute thread color an "ADMIN" bubble distinctly from the two parties.
export function ChatBubble({ body, senderLabel, mine, at, variant }) {
  const bg = mine ? 'var(--brand-primary)' : variant === 'admin' ? 'var(--surface-container-high)' : 'var(--surface-container-low)';
  const color = mine ? 'var(--text-inverse)' : 'var(--text-primary)';
  return (
    <div className={cx('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {senderLabel && !mine && <span className="px-1 text-[11px] font-semibold text-ink-muted">{senderLabel}</span>}
      <div className="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm" style={{ background: bg, color, border: variant === 'admin' && !mine ? '1px solid var(--border-strong)' : 'none' }}>
        {body}
      </div>
      {at && <span className="px-1 font-mono text-[10px] text-ink-muted">{at}</span>}
    </div>
  );
}

export function ChatThread({ messages, emptyLabel = 'No messages yet.', className }) {
  if (!messages || messages.length === 0) {
    return <EmptyState title={emptyLabel} className={className} />;
  }
  return (
    <div className={cx('flex flex-col gap-4 p-4', className)}>
      {messages.map((m) => (
        <ChatBubble key={m.id} body={m.body} senderLabel={m.senderLabel} mine={m.mine} at={m.at} variant={m.variant} />
      ))}
    </div>
  );
}
