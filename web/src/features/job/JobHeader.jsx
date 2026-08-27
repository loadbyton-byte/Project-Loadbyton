export default function JobHeader({ job }) {
  if (!job) return null;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">{job.job_code}</h1>
        <span className="rounded-full bg-ink px-2 py-1 text-xs text-white">{job.status}</span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{job.pickup_terminal} → {job.delivery_area}</p>
      <p className="text-xs text-ink-muted">{job.container_size} {job.container_type} • {job.shipment_type}</p>
    </div>
  );
}
