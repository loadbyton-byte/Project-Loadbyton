import React from 'react';
import { STATUS_FLOW, formatLabel } from '../../lib/constants.js';
import { StatusTracker as UIStatusTracker } from '../../components/ui.jsx';

function inferTerminalIndex(job) {
  if (job.delivered_at) return STATUS_FLOW.indexOf('DELIVERED') - 1;
  if (job.carrier_id) return STATUS_FLOW.indexOf('AWARDED') - 1;
  return 0;
}

export default function JobStatusTracker({ job }) {
  const terminal = job.status === 'CANCELLED' ? 'danger' : job.status === 'DISPUTED' ? 'danger' : undefined;
  const idx = terminal ? inferTerminalIndex(job) : Math.max(0, STATUS_FLOW.indexOf(job.status) - 1);
  const TRACKER_STEPS = STATUS_FLOW.slice(1).map((s) => ({ key: s, label: formatLabel(s) }));
  return (
    <div className="overflow-x-auto scroll-fade-x pb-1">
      <UIStatusTracker steps={TRACKER_STEPS} currentIndex={idx} terminal={terminal} className="min-w-[560px]" />
      {terminal && <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}>{job.status}</span>}
    </div>
  );
}