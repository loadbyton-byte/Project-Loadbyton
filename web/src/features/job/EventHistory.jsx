import React from 'react';
import { formatDateTime } from '../../lib/constants.js';
import { IconAlert, IconCheck, IconClock, IconFile, IconGavel, IconTruck, IconUser, IconWallet } from '../../components/icons.jsx';

// Renders shipment_events (server/schema.js) — an append-only, hash-chained
// record of every meaningful thing that happened on this job, wired since
// Phase 1 of the architecture review with nothing anywhere ever reading it
// back until job.service.js's getJob started returning it as `events`.
// This is the chronological "what actually happened, in order" record a
// transaction case file needs, distinct from JobTimeline.jsx's 6-stage
// progress bar (where the job IS right now) and from documents/messages
// (what was exchanged, not what happened).
const EVENT_ICON = {
  BID_AWARDED: IconGavel,
  DRIVER_ASSIGNED: IconUser,
  STATUS_CHANGE: IconTruck,
  POD_SUBMITTED: IconFile,
  PAYOUT_RELEASED: IconWallet,
  DISPUTE_OPENED: IconAlert,
  DISPUTE_RESOLVED: IconCheck,
};

export default function EventHistory({ events }) {
  if (!events || events.length === 0) {
    return <p className="text-sm text-ink-muted">No recorded events yet.</p>;
  }
  return (
    <ol className="space-y-4">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.event_type] || IconClock;
        const isLast = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 ps-1">
            {!isLast && (
              <span className="absolute start-[15px] top-7 h-[calc(100%+0.5rem)] w-px" style={{ background: 'var(--border-subtle)' }} />
            )}
            <span className="z-raised flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-container-high)', color: 'var(--brand-accent)' }}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 pb-1">
              <p className="text-sm text-ink">{e.summary}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{formatDateTime(e.created_at)}{e.actor_role ? ` · ${e.actor_role.toLowerCase()}` : ''}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
