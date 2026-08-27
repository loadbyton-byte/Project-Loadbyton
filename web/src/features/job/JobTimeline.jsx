import { STATUS_FLOW, formatLabel } from '../../lib/constants.js';
import { Badge, StatusTracker } from '../../components/ui.jsx';

const TRACKER_STEPS = STATUS_FLOW.slice(1).map((s) => ({ key: s, label: formatLabel(s) }));

function inferTerminalIndex(job) {
  if (job.delivered_at) return STATUS_FLOW.indexOf('DELIVERED') - 1;
  if (job.carrier_id) return STATUS_FLOW.indexOf('AWARDED') - 1;
  return 0;
}

export default function JobTimeline({ job }) {
  if (!job) return null;
  const terminal = job.status === 'CANCELLED' || job.status === 'DISPUTED' ? 'danger' : undefined;
  const idx = terminal ? inferTerminalIndex(job) : Math.max(0, STATUS_FLOW.indexOf(job.status) - 1);
  return (
    <div className="overflow-x-auto scroll-fade-x pb-1">
      <StatusTracker steps={TRACKER_STEPS} currentIndex={idx} terminal={terminal} className="min-w-[560px]" />
      {terminal && <Badge color="danger" className="mt-3">{job.status}</Badge>}
    </div>
  );
}
