import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { STATUS_FLOW, formatAED, formatDateTime, formatLabel, EQUIPMENT_TYPES, CONTAINER_EQUIPMENT, equipmentLabel, cargoTypeLabel, TERMINALS, AREAS, DEPOTS, depotLabel } from '../lib/constants.js';
import { Button, Card, Input, Label, Select, Textarea, Badge, StatusBadge, EscrowBadge, Spinner, RatingPill } from '../components/ui.jsx';
import { IconClock, IconMapPin, IconFile, IconAlert, IconArrowLeft, IconGavel } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { fileToBase64, UPLOAD_ACCEPT, documentFileUrl } from '../lib/upload.js';
import { LiveMap, useLiveTracking } from '../components/LiveMap.jsx';
import { EirChecklist } from '../components/EirChecklist.jsx';
import { DetentionAlarm } from '../components/DetentionAlarm.jsx';
import JobHeader from '../features/job/JobHeader.jsx';
import JobTimeline from '../features/job/JobTimeline.jsx';
import MessagesPanel from '../features/job/MessagesPanel.jsx';
import DriverPanel from '../features/job/DriverPanel.jsx';
import RatingPanel from '../features/job/RatingPanel.jsx';
import BidForm from '../features/job/BidForm.jsx';
import PaymentPanel from '../features/job/PaymentPanel.jsx';
import JobEditForm from '../features/job/JobEditForm.jsx';
import DocumentList from '../features/job/DocumentList.jsx';
import BackloadMatches from '../features/job/BackloadMatches.jsx';
import PodForm from '../features/job/PodForm.jsx';
import JobStatusTracker from '../features/job/JobStatusTracker.jsx';
import DisputePanel from '../features/job/DisputePanel.jsx';

const DOC_TYPES = ['CUSTOMS', 'RECEIPT', 'POD', 'LICENCE', 'INSURANCE', 'OTHER'];

// Must match server/index.js's DISPUTABLE_STATUSES exactly — the server is
// the authority (this is only so the button doesn't appear when the server
// would reject it anyway).
const DISPUTABLE_STATUSES = ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
// Must match server/index.js's BACKLOAD_ELIGIBLE_STATUSES exactly.
const BACKLOAD_ELIGIBLE_STATUSES = ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

function Section({ title, children, action }) {
  return (
    <Card className="mb-6">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        {action}
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

// Steps shown to the user skip DRAFT (jobs are never displayed in that
// state) — STATUS_FLOW.slice(1) is OPEN..COMPLETED, the same 6 stages
// Industrial Trust's spec names explicitly.
const TRACKER_STEPS = STATUS_FLOW.slice(1).map((s) => ({ key: s, label: formatLabel(s) }));

// DISPUTED/CANCELLED aren't in STATUS_FLOW, so STATUS_FLOW.indexOf(job.status)
// returns -1 for either — clamped to 0, that rendered every terminal job as
// if it had never left OPEN, even one disputed at IN_TRANSIT. There are no
// per-stage timestamps in the schema to reconstruct the exact prior step
// (only delivered_at exists), so this approximates from what's actually on
// the job payload: delivered before going terminal, awarded-or-later, or
// still open — better than always showing zero progress.
function inferTerminalIndex(job) {
  if (job.delivered_at) return STATUS_FLOW.indexOf('DELIVERED') - 1;
  if (job.carrier_id) return STATUS_FLOW.indexOf('AWARDED') - 1;
  return 0;
}


export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [track, setTrack] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingJob, setEditingJob] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jobData, trackData, msgs] = await Promise.all([
        api.getJob(id),
        api.track(id).catch(() => null),
        api.getMessages(id).catch(() => ({ messages: [] })),
      ]);
      setData(jobData);
      setTrack(trackData);
      setMessages(msgs.messages);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  usePageTitle(data?.job ? data.job.job_code : 'Job');
  useLiveTracking(data?.job?.id, user.id===data?.job?.carrier_id, data?.job?.status);

  // Shippers return from the hosted checkout with ?pay=ok|cancel|declined —
  // surface that once, then clean the URL so a refresh doesn't re-show it.
  const [payNotice, setPayNotice] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('pay');
    if (v === 'ok') return 'Payment received — escrow is now funded.';
    if (v === 'cancel' || v === 'declined') return 'Payment was cancelled or declined. You can retry from the payment panel below.';
    return null;
  });
  useEffect(() => {
    if (payNotice) window.history.replaceState({}, '', window.location.pathname);
  }, [payNotice]);

  if (error) return <div className="container-page py-10"><p className="text-status-danger">{error}</p></div>;
  if (!data) return <div className="container-page flex justify-center py-24"><Spinner size={28} /></div>;

  const { job, bids, documents, payout } = data;
  const isShipper = user.id === job.shipper_id;
  const isCarrier = user.role === 'CARRIER';
  const isAwardedCarrier = user.id === job.carrier_id;
  const myBid = bids.find((b) => b.carrier_id === user.id);
  // Job editing: only while OPEN and before any carrier has a live bid
  // against this exact spec — matches the server's own guard in
  // PATCH /api/jobs/:id, which is the actual enforcement.
  const canEditJob = isShipper && job.status === 'OPEN' && !bids.some((b) => b.status === 'PENDING');

  // Prefer real browser history (works correctly whether this job was
  // reached from Dashboard, Open Loads, Won Jobs, My Bids, or Admin) — the
  // idx check is how react-router's history state tells a fresh page load
  // (arrived via a direct URL/refresh, no in-app history to go back to)
  // apart from actual in-app navigation, so a direct link never "back"s
  // the user out of the app entirely.
  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(user.role === 'CARRIER' ? '/open-loads' : '/dashboard');
  }

  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page py-10" dir="ltr">
      <button
        type="button"
        onClick={goBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink"
      >
        <IconArrowLeft size={16} /> Back
      </button>
      <div className="mb-6">
        <JobHeader job={job} />
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-ink-muted">{job.job_code}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
            <span className="mr-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: job.shipment_type === 'EXPORT' ? 'var(--lb-blue-100)' : job.shipment_type === 'LOCAL' ? 'var(--status-success-bg)' : 'var(--lb-orange-100)', color: job.shipment_type === 'EXPORT' ? 'var(--lb-blue-700)' : job.shipment_type === 'LOCAL' ? 'var(--status-success)' : 'var(--lb-orange-700)' }}>{job.shipment_type || 'IMPORT'}{job.status === 'DRAFT' && job.scheduled_post_at ? ` · publishes ${formatDateTime(job.scheduled_post_at)}` : ''}</span>
            {CONTAINER_EQUIPMENT.includes(job.equipment_type) ? `${job.container_size} ${formatLabel(job.container_type)}` : equipmentLabel(job.equipment_type)} · {formatLabel(job.pickup_terminal)} → {formatLabel(job.delivery_area)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <EscrowBadge status={job.escrow_status} />
            <Badge color="neutral">{equipmentLabel(job.equipment_type)}</Badge>
            {job.container_count > 1 && <Badge color="accent">×{job.container_count} containers</Badge>}
            {job.truck_count > 1 && <Badge color="accent">×{job.truck_count} trucks</Badge>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-muted">{job.status === 'OPEN' ? 'Target price (per trip)' : 'Agreed price'}</p>
          <p className="tabular font-display text-2xl font-semibold text-ink">{formatAED(job.agreed_price_aed || job.max_budget_aed)}</p>
        </div>
      </div>

      {payNotice && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-brand-border bg-brand-bg px-4 py-3">
          <p className="text-sm text-ink">{payNotice}</p>
          <button type="button" onClick={() => setPayNotice(null)} className="text-xs text-ink-muted hover:text-ink">Dismiss</button>
        </div>
      )}

      {job.processor_payment_status && job.processor_payment_status !== 'PENDING' && (
        <PaymentPanel job={job} load={load} />
      )}

      {error && <p className="mb-6 rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>{error}</p>}

      <Card className="mb-6">
        <Card.Content>
          <JobTimeline job={job} />
        </Card.Content>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
        <div>
          <Section
            title="Shipment details"
            action={canEditJob && !editingJob && <Button variant="ghost" size="sm" onClick={() => setEditingJob(true)}>Edit</Button>}
          >
            {editingJob ? (
              <JobEditForm job={job} onDone={() => { setEditingJob(false); load(); }} onCancel={() => setEditingJob(false)} />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-ink-muted">Equipment</dt><dd className="mt-0.5 font-medium text-ink">{equipmentLabel(job.equipment_type)}</dd></div>
                <div><dt className="text-ink-muted">Cargo type</dt><dd className="mt-0.5 font-medium text-ink">{cargoTypeLabel(job.cargo_type)}</dd></div>
                {job.cargo_weight_tons != null && (
                  <div><dt className="text-ink-muted">Cargo weight</dt><dd className="mt-0.5 font-medium text-ink">{job.cargo_weight_tons} t</dd></div>
                )}
                {CONTAINER_EQUIPMENT.includes(job.equipment_type) && (
                  <div><dt className="text-ink-muted">Container #</dt><dd className="mt-0.5 font-medium text-ink">{job.container_number || '—'}</dd></div>
                )}
                {(job.container_count > 1 || job.truck_count > 1) && (
                  <div><dt className="text-ink-muted">Volume</dt><dd className="mt-0.5 font-medium text-ink">{job.container_count > 1 ? `${job.container_count} containers` : `${job.truck_count} trucks`}</dd></div>
                )}
                <div><dt className="text-ink-muted">Ready at</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(job.ready_at)}</dd></div>
                <div><dt className="text-ink-muted">Deadline</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(job.deadline)}</dd></div>
                <div className="col-span-2 sm:col-span-3"><dt className="text-ink-muted">Delivery address</dt><dd className="mt-0.5 font-medium text-ink">{job.delivery_address}</dd></div>
                {job.notes && <div className="col-span-2 sm:col-span-3"><dt className="text-ink-muted">Notes</dt><dd className="mt-0.5 text-ink-secondary">{job.notes}</dd></div>}
              </dl>
            )}
          </Section>

          <Section title="Shipment legs">
            {job.shipment_type === 'LOCAL' ? (
              <div className="grid gap-3">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-primary)' }}>1</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Loading location</p>
                    <p className="font-medium text-ink">{formatLabel(job.loading_location || job.pickup_terminal)}</p>
                    {job.ready_at && <p className="text-sm text-ink-secondary">Loading {formatDateTime(job.ready_at)}</p>}
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--lb-orange-600)' }}>2</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Delivery location</p>
                    <p className="font-medium text-ink">{formatLabel(job.delivery_location || job.delivery_area)}</p>
                    {job.delivery_address && <p className="text-sm text-ink-secondary">{job.delivery_address}</p>}
                  </div>
                </div>
              </div>
            ) : job.shipment_type === 'EXPORT' ? (
              <div className="grid gap-3">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--lb-ink-900)' }}>1</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Empty pickup</p>
                    <p className="font-medium text-ink">{job.export_empty_pickup_location ? depotLabel(job.export_empty_pickup_location) : formatLabel(job.export_empty_pickup_location || '—')} <span className="text-ink-muted">· depot</span></p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-primary)' }}>2</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Loading location</p>
                    <p className="font-medium text-ink">{formatLabel(job.export_loading_location || job.delivery_area)} </p>
                    {job.delivery_address && <p className="text-sm text-ink-secondary">{job.delivery_address}</p>}
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--lb-orange-600)' }}>3</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Deposit at terminal</p>
                    <p className="font-medium text-ink">{formatLabel(job.export_deposit_terminal || job.pickup_terminal)} <span className="text-ink-muted">· port</span></p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--lb-ink-900)' }}>1</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Container pickup at terminal</p>
                    <p className="font-medium text-ink">{formatLabel(job.import_pickup_terminal || job.pickup_terminal)} <span className="text-ink-muted">· terminal</span></p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-primary)' }}>2</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Unloading location</p>
                    <p className="font-medium text-ink">{formatLabel(job.import_unloading_location || job.delivery_area)}</p>
                    {job.delivery_address && <p className="text-sm text-ink-secondary">{job.delivery_address}</p>}
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--lb-orange-600)' }}>3</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Empty return</p>
                    <p className="font-medium text-ink">{job.import_empty_return_location ? depotLabel(job.import_empty_return_location) : formatLabel(job.import_empty_return_location || '—')} <span className="text-ink-muted">· depot (detention stops here)</span></p>
                  </div>
                </div>
              </div>
            )}
            <p className="mt-4 text-xs text-ink-muted">Turn-key price covers all 3 legs.</p>
          </Section>

          <Section title={`Bids (${bids.length})`}>
            {bids.length === 0 ? (
              <p className="text-sm text-ink-muted">No bids yet.</p>
            ) : (
              <div className="space-y-3">
                {bids.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3" style={{ borderColor: b.status === 'ACCEPTED' ? 'var(--status-success)' : 'var(--border-default)' }}>
                    <div className="min-w-0">
                      <p className="tabular font-display text-base font-semibold text-ink">{b.masked ? 'Hidden until award' : formatAED(b.amount_aed)}</p>
                      <p className="text-xs text-ink-muted">{b.masked ? 'Competing bid' : `Delivery by ${formatDateTime(b.eta_at)} · ${b.truck_type ? equipmentLabel(b.truck_type) : 'equipment n/a'}`}</p>
                      {!b.masked && b.carrier_company && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
                          <span className="truncate">{b.carrier_company}</span> <RatingPill rating={b.carrier_rating} />
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge color={b.status === 'ACCEPTED' ? 'success' : b.status === 'REJECTED' ? 'danger' : 'neutral'}>{b.status}</Badge>
                      {isShipper && job.status === 'OPEN' && b.status === 'PENDING' && (
                        <Button variant="accent" onClick={() => act(() => api.awardJob(job.id, b.id))} loading={busy}>Award</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isCarrier && job.status === 'OPEN' && !myBid && (
              <BidForm jobId={job.id} verified={user.is_verified} defaultEquipment={job.equipment_type} onDone={load} />
            )}
          </Section>

          <Section title="Documents">
            <DocumentList documents={documents} jobId={job.id} onAdd={load} />
          </Section>

          <Section title="Messages">
            <MessagesPanel messages={messages} jobId={job.id} onSent={load} />
          </Section>

          {job.status === 'COMPLETED' && (isShipper || isAwardedCarrier) && (
            <Section title="Rate your counterparty"><RatingPanel job={job} onSubmit={load} /></Section>
          )}
        </div>

        <div>
          {track && (
            <Card className="mb-6">
              <Card.Header><Card.Title>Track & escrow</Card.Title></Card.Header>
              <Card.Content className="space-y-4 text-sm">
                <div className="flex items-center gap-2 text-ink-secondary">
                  <IconMapPin size={15} className="text-ink-muted" />
                  <span>{track.geofence.atPickup ? 'At/past pickup' : 'Awaiting pickup'} · {track.geofence.atDelivery ? 'At delivery' : 'En route'}</span>
                </div>
                {track.autoReleaseAt && (
                  <div className="flex items-center gap-2 text-ink-secondary">
                    <IconClock size={15} className="text-ink-muted" />
                    <span>Auto-releases {formatDateTime(track.autoReleaseAt)}</span>
                  </div>
                )}
                {payout && (
                  <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <p className="text-ink-muted">Payout</p>
                    <p className="tabular font-display text-lg font-semibold text-ink">{formatAED(payout.net_aed)} net</p>
                    <p className="text-xs text-ink-muted">Gross {formatAED(payout.gross_aed)} − fee {formatAED(payout.platform_fee_aed)} · {payout.status}</p>
                  </div>
                )}
              </Card.Content>
            </Card>
          )}

          {/* Phase 3: live map when IN_TRANSIT */}
          {['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(job.status) && (
            <Card className="mb-6"><Card.Header><Card.Title>Live location</Card.Title></Card.Header><Card.Content><LiveMap jobId={job.id} fallbackLat={job.pickup_lat} fallbackLng={job.pickup_lng} /><DetentionAlarm jobId={job.id} /></Card.Content></Card>
          )}
          {/* Phase 4: EIR for carrier at pickup */}
          {isAwardedCarrier && ['PICKED_UP','IN_TRANSIT'].includes(job.status) && <div className="mb-6"><EirChecklist jobId={job.id} onDone={load} /></div>}
          {isAwardedCarrier && BACKLOAD_ELIGIBLE_STATUSES.includes(job.status) && <BackloadMatches jobId={job.id} />}

          {job.status === 'DISPUTED' && (isShipper || isAwardedCarrier) && (
            <Link to={`/jobs/${job.id}/dispute`} className="btn-danger mb-6 w-full justify-center">
              <IconGavel size={15} /> View dispute
            </Link>
          )}

          <Card className="mb-6">
            <Card.Header><Card.Title>Actions</Card.Title></Card.Header>
            <Card.Content className="space-y-2">
              {isAwardedCarrier && job.status === 'AWARDED' && (
                <Button className="w-full" onClick={() => act(() => api.setStatus(job.id, 'PICKED_UP'))} loading={busy}>Mark picked up</Button>
              )}
              {isAwardedCarrier && job.status === 'PICKED_UP' && (
                <Button className="w-full" onClick={() => act(() => api.setStatus(job.id, 'IN_TRANSIT'))} loading={busy}>Mark in transit</Button>
              )}
              {isAwardedCarrier && job.status === 'IN_TRANSIT' && (
                <PodForm jobId={job.id} onDone={load} busy={busy} setBusy={setBusy} setError={setError} />
              )}
              {isShipper && job.status === 'DELIVERED' && (
                <Button className="w-full" variant="accent" onClick={() => act(() => api.setStatus(job.id, 'COMPLETED'))} loading={busy}>Confirm delivery & release escrow</Button>
              )}
              {isShipper && ['OPEN', 'AWARDED', 'DRAFT'].includes(job.status) && (
                <Button className="w-full" variant="danger" onClick={() => act(() => api.setStatus(job.id, 'CANCELLED'))} loading={busy}>Cancel job</Button>
              )}
              {isAwardedCarrier && job.status === 'AWARDED' && (
                <Button className="w-full" variant="ghost" onClick={() => act(() => api.setStatus(job.id, 'CANCELLED'))} loading={busy}>Cancel before pickup</Button>
              )}
              {!isAwardedCarrier && !isShipper && !myBid && job.status !== 'OPEN' && (
                <p className="text-xs text-ink-muted">No actions available.</p>
              )}
              {(isShipper || isAwardedCarrier) && DISPUTABLE_STATUSES.includes(job.status) && (
                <DisputePanel jobId={job.id} onDone={load} />
              )}
            </Card.Content>
          </Card>

          {isAwardedCarrier && ['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status) && (
            <DriverPanel job={job} onDone={load} />
          )}
        </div>
      </div>
    </div>
  );
}


// datetime-local inputs need "YYYY-MM-DDTHH:mm" — stored values can be
// either that exact shape (created via this same form) or SQLite's
// "YYYY-MM-DD HH:MM:SS" (seeded data), so normalize rather than assume.


// "Zero deadhead miles" — while hauling this job, surface OPEN jobs that
// start roughly where it's dropping off, so the return leg isn't empty.
// Ranking (real distance vs. same-emirate fallback) is entirely server-side
// (GET /api/jobs/:id/backload-matches) — this just renders what comes back.





