import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { STATUS_FLOW, formatAED, formatMoney, formatDate, formatDateTime, formatLabel, ltrIsolate, EQUIPMENT_TYPES, CONTAINER_EQUIPMENT, equipmentLabel, cargoTypeLabel, TERMINALS, AREAS, DEPOTS, depotLabel, ANCILLARY_CHARGE_LABELS, CURRENCIES, paymentTermLabel, DEFERRED_PAYMENT_TERMS } from '../lib/constants.js';
import { Button, Card, Input, Label, Select, Textarea, Badge, StatusBadge, PaymentStatusBadge, RatingPill, ErrorState, Skeleton, Modal } from '../components/ui.jsx';
import { IconClock, IconMapPin, IconFile, IconAlert, IconArrowLeft, IconGavel, IconStar } from '../components/icons.jsx';
import { documentFileUrl, driverDocumentUrl } from '../lib/upload.js';
import { LiveMap, useLiveTracking } from '../components/LiveMap.jsx';
import { EirChecklist } from '../components/EirChecklist.jsx';
import { DetentionAlarm } from '../components/DetentionAlarm.jsx';
import JobHeader from '../features/job/JobHeader.jsx';
import JobTimeline from '../features/job/JobTimeline.jsx';
import EventHistory from '../features/job/EventHistory.jsx';
import ChatPopup from '../features/job/ChatPopup.jsx';
import DriverPanel from '../features/job/DriverPanel.jsx';
import FuelAdvancePanel from '../features/job/FuelAdvancePanel.jsx';
import RatingPanel from '../features/job/RatingPanel.jsx';
import BidForm from '../features/job/BidForm.jsx';
import PaymentPanel from '../features/job/PaymentPanel.jsx';
import JobEditForm from '../features/job/JobEditForm.jsx';
import DocumentList from '../features/job/DocumentList.jsx';
import HaulierCodeToken from '../features/job/HaulierCodeToken.jsx';
import BackloadMatches from '../features/job/BackloadMatches.jsx';
import PodForm from '../features/job/PodForm.jsx';
import DisputePanel from '../features/job/DisputePanel.jsx';
import CancelJobPanel from '../features/job/CancelJobPanel.jsx';

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
  const { t, isRtl } = useLocale();
  const [data, setData] = useState(null);
  const [track, setTrack] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingJob, setEditingJob] = useState(false);
  const [awardConfirm, setAwardConfirm] = useState(null);
  // Pre-award negotiation/ancillary-charges state — award.service.js now
  // requires this bid's terms_confirmed_at to be set (or an explicit
  // skipNegotiation) before it will award, so this modal is where that
  // actually happens instead of a single-click award.
  const [negotiationMessages, setNegotiationMessages] = useState([]);
  const [ancillaryCharges, setAncillaryCharges] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [newChargeType, setNewChargeType] = useState('SALIK');
  const [newChargeAmount, setNewChargeAmount] = useState('');
  const [lowCapacityAcked, setLowCapacityAcked] = useState(false);
  const [negotiationBusy, setNegotiationBusy] = useState(false);
  const [etaPrediction, setEtaPrediction] = useState(null);
  const [etaPredicting, setEtaPredicting] = useState(false);
  const [telematicsLogs, setTelematicsLogs] = useState([]);

  const load = useCallback(async () => {
    try {
      // ChatPopup fetches its own thread data (GET .../threads) lazily when
      // opened, not eagerly here — most job views never open the widget.
      // Telematics (reefer temperature/speed/fuel) is real hardware data
      // that most jobs simply have none of — fetched here so the section
      // below can just render nothing rather than an empty-state box for
      // the common case, but caught silently like track() since its
      // absence isn't an error.
      const [jobData, trackData, telematicsData] = await Promise.all([
        api.getJob(id),
        api.track(id).catch(() => null),
        api.getTelematicsLogs(id).catch(() => null),
      ]);
      setData(jobData);
      setTrack(trackData);
      setTelematicsLogs(telematicsData?.logs || []);
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
    if (v === 'ok') return 'Payment received — funds are now held for this transport.';
    if (v === 'cancel' || v === 'declined') return 'Payment was cancelled or declined. You can retry from the payment panel below.';
    return null;
  });
  useEffect(() => {
    if (payNotice) window.history.replaceState({}, '', window.location.pathname);
  }, [payNotice]);

  // Award confirmation popup: close on Escape, lock body scroll — same
  // pattern as Dashboard.jsx's "post a job" popup. Must be called
  // unconditionally on every render (before the loading/error early
  // returns below) — placing it after them made it skip the first
  // render while `data` is still null, then run on later renders once
  // data loads, which is a "rendered more hooks than previous render"
  // violation (React error #310) that crashed this page in production.
  useEffect(() => {
    if (!awardConfirm) return;
    const onKey = (e) => { if (e.key === 'Escape') setAwardConfirm(null); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [awardConfirm]);

  // Pre-award bid negotiation had no real-time path at all — the sender
  // saw their own message (from the POST response below), but the other
  // party only ever saw a new one by closing and reopening this modal.
  // bids.routes.js's POST /:id/negotiation already calls notify() (type
  // 'bid') to the other party right alongside the insert — reuses that
  // existing push instead of adding a new server-side event, same fix as
  // Messages.jsx/JobDispute.jsx. Kept above the early data-loading returns
  // below (React hooks must run in the same order every render).
  useEffect(() => {
    if (!awardConfirm || !data?.job?.id) return;
    const jobId = data.job.id;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    function onNotification(n) {
      if (n.type === 'bid' && String(n.job_id) === String(jobId)) {
        api.getBidNegotiation(awardConfirm.id).then((neg) => setNegotiationMessages(neg.messages || [])).catch(() => {});
      }
    }
    socket.on('notification:new', onNotification);
    return () => socket.off('notification:new', onNotification);
  }, [awardConfirm, data?.job?.id]);

  if (error && !data) {
    return (
      <div className="container-page py-10">
        <ErrorState
          title="Couldn't load this job"
          description={error}
          onRetry={() => { setError(''); load(); }}
        />
      </div>
    );
  }
  // Shaped like the real page (header block, then a 2-column body) rather
  // than a bare centered spinner — this is the single most-visited,
  // longest page in the app, so what "loading" looks like here matters.
  if (!data) {
    return (
      <div className="container-page py-10">
        <Skeleton variant="text" count={2} className="max-w-md" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr,340px]">
          <Skeleton variant="card" count={3} className="grid-cols-1" />
          <Skeleton variant="card" count={2} className="grid-cols-1" />
        </div>
      </div>
    );
  }

  const { job, bids, documents, payout, myRating, events } = data;
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

  // POST /api/ml/predict-eta (ml.routes.js) — a QA audit found this fully
  // implemented with an api.js client method already defined, but nothing
  // in the app ever called it. On demand rather than auto-fetched on
  // page load: the backend's own comment says this is a deterministic
  // mock (random port-congestion component) standing in for a real
  // AIS/NOAA pipeline, so refetching it silently on every render would
  // make the "prediction" look like it's tracking something real when
  // it's actually just re-rolling.
  async function getEtaPrediction() {
    setEtaPredicting(true);
    setError('');
    try {
      const { prediction } = await api.predictEta({ jobId: job.id });
      setEtaPrediction(prediction);
    } catch (err) {
      setError(err.message);
    } finally {
      setEtaPredicting(false);
    }
  }

  async function openAwardFlow(b) {
    setAwardConfirm(b);
    setNegotiationMessages([]);
    setAncillaryCharges([]);
    setLowCapacityAcked(false);
    try {
      const [neg, charges] = await Promise.all([api.getBidNegotiation(b.id), api.getAncillaryCharges(b.id)]);
      setNegotiationMessages(neg.messages || []);
      setAncillaryCharges(charges.charges || []);
    } catch (err) {
      setError(err.message);
    }
  }


  async function sendNegotiationMessage() {
    if (!newMessage.trim()) return;
    setNegotiationBusy(true);
    try {
      const res = await api.postBidNegotiation(awardConfirm.id, newMessage.trim());
      setNegotiationMessages(res.messages || []);
      setNewMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setNegotiationBusy(false);
    }
  }

  async function proposeCharge() {
    const amount = Number(newChargeAmount);
    if (!amount || amount <= 0) return setError('Enter a valid charge amount');
    setNegotiationBusy(true);
    try {
      await api.proposeAncillaryCharge(awardConfirm.id, newChargeType, amount);
      const charges = await api.getAncillaryCharges(awardConfirm.id);
      setAncillaryCharges(charges.charges || []);
      setNewChargeAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setNegotiationBusy(false);
    }
  }

  async function agreeCharge(chargeId) {
    setNegotiationBusy(true);
    try {
      await api.agreeAncillaryCharge(awardConfirm.id, chargeId);
      const charges = await api.getAncillaryCharges(awardConfirm.id);
      setAncillaryCharges(charges.charges || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setNegotiationBusy(false);
    }
  }

  // DELETE /api/bids/:id/ancillary-charges/:chargeId had a real backend
  // (blocked once terms_confirmed_at is set) and an api.js client
  // (deleteBidAncillaryCharge) but no button anywhere called it — a
  // charge either side disagreed with, proposed by mistake, or wanted to
  // retract before terms lock could never actually be removed.
  async function removeCharge(chargeId) {
    setNegotiationBusy(true);
    try {
      await api.deleteBidAncillaryCharge(awardConfirm.id, chargeId);
      const charges = await api.getAncillaryCharges(awardConfirm.id);
      setAncillaryCharges(charges.charges || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setNegotiationBusy(false);
    }
  }

  const allChargesAgreed = ancillaryCharges.every((c) => c.agreed_by_shipper && c.agreed_by_carrier);
  // Matches award.service.js exactly: only charges BOTH sides have agreed
  // become part of the final price — a proposed-but-unagreed charge
  // doesn't count, even if it's still sitting in the list below.
  const agreedChargesTotal = ancillaryCharges.filter((c) => c.agreed_by_shipper && c.agreed_by_carrier).reduce((sum, c) => sum + c.amount_aed, 0);
  const finalAwardTotal = (awardConfirm?.amount_aed || 0) + agreedChargesTotal;
  const isLowCapacity = awardConfirm && awardConfirm.carrier_available_units != null && awardConfirm.carrier_available_units <= 0;

  function skipAndAward() {
    const bid = awardConfirm;
    setAwardConfirm(null);
    act(() => api.awardJob(job.id, bid.id, { skipNegotiation: true, acknowledgeLowCapacity: lowCapacityAcked }));
  }

  function confirmAward() {
    const bid = awardConfirm;
    setAwardConfirm(null);
    act(async () => {
      await api.confirmBidTerms(bid.id);
      await api.awardJob(job.id, bid.id, { acknowledgeLowCapacity: lowCapacityAcked });
    });
  }

  return (
    <div className="container-page py-10" dir={isRtl ? 'rtl' : 'ltr'}>
      {awardConfirm && (
        <Modal
          open
          onClose={() => setAwardConfirm(null)}
          title={
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-accent)' }}><IconGavel size={14} /></span>
              {isShipper ? 'Discuss & award this bid' : 'Discuss your bid with the shipper'}
            </span>
          }
        >
                <p className="text-sm text-ink">
                  <strong>{formatMoney(awardConfirm.amount_aed, job.currency)}</strong>
                  {isShipper ? <> from <strong>{awardConfirm.carrier_company || 'this transporter'}</strong>.</> : ' — your bid on this job.'}
                </p>
                {isShipper && (
                  <>
                    <ul className="mt-3 space-y-1.5 text-sm text-ink-secondary" style={{ listStyle: 'disc', paddingInlineStart: '1.1rem' }}>
                      <li>Every other bid on this job will be rejected once assigned</li>
                      <li>
                        {agreedChargesTotal > 0
                          ? <>Final price locks at <strong className="text-ink">{formatMoney(finalAwardTotal, job.currency)}</strong> ({formatMoney(awardConfirm.amount_aed, job.currency)} bid + {formatMoney(agreedChargesTotal, job.currency)} agreed extras) — nothing can be changed after this</>
                          : <>The price is locked at {formatMoney(awardConfirm.amount_aed, job.currency)} — bids can't be changed after this</>}
                      </li>
                      <li>{(!job.payment_tier || job.payment_tier === 'INSTANT') ? 'Payment is held for this transport and the job moves to "Awarded"' : `The job moves to "Awarded" — ${paymentTermLabel(job.payment_tier)}`}</li>
                    </ul>

                    {isLowCapacity && (
                      <div
                        className="mt-3 rounded-md px-3 py-2 text-sm"
                        style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
                      >
                        <p className="font-semibold">⚠ This transporter has declared 0 available units.</p>
                        <p className="mt-0.5 text-xs">They may already be fully committed to other jobs. You can still award — just confirm you understand the risk.</p>
                        <label className="mt-2 flex items-center gap-2 text-xs font-medium">
                          <input type="checkbox" checked={lowCapacityAcked} onChange={(e) => setLowCapacityAcked(e.target.checked)} />
                          Award anyway
                        </label>
                      </div>
                    )}
                  </>
                )}

                {/* Ancillary charges — Salik, e-token, demurrage, inspection
                    waiting — each needs BOTH sides to agree before terms
                    can be confirmed. */}
                <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ancillary charges</p>
                  {ancillaryCharges.length === 0 && <p className="mt-1 text-sm text-ink-muted">None proposed yet.</p>}
                  <ul className="mt-2 space-y-1.5">
                    {ancillaryCharges.map((c) => {
                      // Which side "I am" depends on who's viewing — this modal
                      // is now opened by either party (previously shipper-only,
                      // so hardcoding agreed_by_shipper as "my side" happened to
                      // work by accident). Read my/their agreement off the
                      // correct column for whoever's actually looking at it.
                      const myAgreed = isShipper ? c.agreed_by_shipper : c.agreed_by_carrier;
                      const otherAgreed = isShipper ? c.agreed_by_carrier : c.agreed_by_shipper;
                      const otherLabel = isShipper ? 'transporter' : 'shipper';
                      return (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                          <span>{c.charge_type} — {formatMoney(c.amount_aed, job.currency)}</span>
                          <span className="flex items-center gap-1.5">
                            {myAgreed && otherAgreed ? (
                              <Badge color="success">Agreed</Badge>
                            ) : !myAgreed ? (
                              <Button size="sm" variant="ghost" onClick={() => agreeCharge(c.id)} loading={negotiationBusy}>Agree</Button>
                            ) : (
                              <Badge color="neutral">Awaiting {otherLabel}</Badge>
                            )}
                            {/* Only the party who proposed a charge can withdraw it (server now
                                enforces this — see bids.routes.js) — a shipper couldn't previously
                                tell a carrier-proposed charge apart here, and this button would
                                have 403'd on one instead of just not being offered. */}
                            {c.proposed_by === user?.id && (
                              <Button size="sm" variant="ghost" onClick={() => removeCharge(c.id)} loading={negotiationBusy}>Remove</Button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Select value={newChargeType} onChange={(e) => setNewChargeType(e.target.value)} className="text-sm">
                      <option value="SALIK">Salik</option>
                      <option value="ETOKEN">E-Token</option>
                      <option value="DEMURRAGE">Demurrage/Waiting</option>
                      <option value="INSPECTION_WAITING">Inspection waiting</option>
                      <option value="OTHER">Other</option>
                    </Select>
                    <Input type="number" min="1" placeholder="AED" value={newChargeAmount} onChange={(e) => setNewChargeAmount(e.target.value)} className="w-24" />
                    <Button size="sm" variant="ghost" onClick={proposeCharge} loading={negotiationBusy}>Propose</Button>
                  </div>
                </div>

                {/* Negotiation thread — pre-award commercial chat on this
                    specific bid, separate from the post-award job chat. Now a
                    real two-way conversation (previously only the shipper had
                    any entry point to it at all): messages are attributed by
                    sender so either side can actually follow who said what. */}
                <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{isShipper ? 'Discuss with this transporter' : 'Discuss with the shipper'}</p>
                  <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto text-sm">
                    {negotiationMessages.length === 0 && <p className="text-ink-muted">No messages yet.</p>}
                    {negotiationMessages.map((m) => {
                      const mine = m.sender_id === user?.id;
                      return (
                        <p
                          key={m.id}
                          className={`rounded-md px-2 py-1 ${mine ? 'ms-6' : 'me-6'}`}
                          style={{ background: mine ? 'color-mix(in srgb, var(--brand-accent) 12%, transparent)' : 'var(--surface-container)' }}
                        >
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{mine ? 'You' : isShipper ? 'Transporter' : 'Shipper'}</span>
                          {m.message}
                        </p>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="e.g. Any Salik charges expected?" className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={sendNegotiationMessage} loading={negotiationBusy}>Send</Button>
                  </div>
                </div>

                {isShipper ? (
                  <>
                    <p className="mt-3 text-xs text-ink-muted">This can't be undone from here — only a cancellation afterward can reverse it.</p>
                    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                      <Button variant="ghost" onClick={() => setAwardConfirm(null)}>Cancel</Button>
                      {ancillaryCharges.length === 0 && (
                        <Button variant="ghost" onClick={skipAndAward} loading={busy} disabled={isLowCapacity && !lowCapacityAcked}>No charges — award now</Button>
                      )}
                      <Button variant="accent" onClick={confirmAward} loading={busy} disabled={!allChargesAgreed || (isLowCapacity && !lowCapacityAcked)}>
                        Confirm terms &amp; assign
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                    <Button variant="ghost" onClick={() => setAwardConfirm(null)}>Close</Button>
                  </div>
                )}
        </Modal>
      )}
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
            {/* Theme-aware shipment pill — was light-mode-only pastel
                primitives (--lb-blue-100/--lb-orange-100) with no dark
                override, floating pale on the navy canvas. status-* and
                brand-accent-bg/on-tint pairs exist in both themes. */}
            <span className="me-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: job.shipment_type === 'EXPORT' ? 'var(--status-info-bg)' : job.shipment_type === 'LOCAL' ? 'var(--status-success-bg)' : 'var(--brand-accent-bg)', color: job.shipment_type === 'EXPORT' ? 'var(--status-info)' : job.shipment_type === 'LOCAL' ? 'var(--status-success)' : 'var(--brand-accent-on-tint)' }}>{job.shipment_type || 'IMPORT'}{job.status === 'DRAFT' && job.scheduled_post_at ? ` · publishes ${formatDateTime(job.scheduled_post_at)}` : ''}</span>
            {CONTAINER_EQUIPMENT.includes(job.equipment_type) ? `${job.container_size} ${formatLabel(job.container_type)}` : equipmentLabel(job.equipment_type)} · {formatLabel(job.pickup_terminal)} → {formatLabel(job.delivery_area)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            {/* Escrow is real, accurate machinery for INSTANT jobs — but
                nothing is ever actually escrowed for a deferred (NET_*)
                job, so showing it there would be the same misleading
                "Escrow: PENDING forever" the badge used to render for
                every tier. The credit-due/overdue/settled badge just below
                is the accurate status for those instead. */}
            {(!job.payment_tier || job.payment_tier === 'INSTANT') && <PaymentStatusBadge status={job.escrow_status} jobStatus={job.status} />}
            <Badge color={job.payment_tier && job.payment_tier !== 'INSTANT' ? 'accent' : 'neutral'}>{paymentTermLabel(job.payment_tier || 'INSTANT')}</Badge>
            {DEFERRED_PAYMENT_TERMS.includes(job.payment_tier) && job.credit_due_at && (() => {
              // Matches admin/CreditTab.jsx's overdue calculation exactly —
              // a shipper should see the same "this is late" signal an
              // admin does, not a flat neutral badge regardless of how
              // overdue it is.
              const overdue = !job.credit_settled_at && new Date(job.credit_due_at).getTime() < Date.now();
              return (
                <Badge color={job.credit_settled_at ? 'success' : overdue ? 'danger' : 'neutral'}>
                  {job.credit_settled_at ? 'Credit settled' : `${overdue ? 'Credit overdue — ' : 'Credit due '}${formatDate(job.credit_due_at)}`}
                </Badge>
              );
            })()}
            <Badge color="neutral">{equipmentLabel(job.equipment_type)}</Badge>
            {job.container_count > 1 && <Badge color="accent">×{job.container_count} containers</Badge>}
            {job.truck_count > 1 && <Badge color="accent">×{job.truck_count} trucks</Badge>}
            {job.extra_line_items?.length > 0 && <Badge color="accent">+{job.extra_line_items.length} more container type{job.extra_line_items.length === 1 ? '' : 's'}</Badge>}
          </div>
        </div>
        <div className={isRtl ? 'text-left' : 'text-right'}>
          <p className="text-xs text-ink-muted">{job.status === 'OPEN' ? t('jobDetail.targetPrice', 'Target price (per trip)') : t('jobDetail.agreedPrice', 'Agreed price')}</p>
          <p className="tabular font-display text-2xl font-semibold text-ink">{formatMoney(job.agreed_price_aed || job.max_budget_aed, job.currency)}</p>
        </div>
      </div>

      {payNotice && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}>
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
            title={t('jobDetail.shipmentDetails', 'Shipment details')}
            action={
              <div className="flex items-center gap-2">
                {isShipper && (
                  <Link to={`/jobs/${job.id}/insurance`} className="text-sm font-medium" style={{ color: 'var(--brand-accent)' }}>
                    {job.insurance_opt_in ? 'View insurance policy' : 'Insure this cargo'}
                  </Link>
                )}
                {canEditJob && !editingJob && <Button variant="ghost" size="sm" onClick={() => setEditingJob(true)}>{t('jobDetail.edit', 'Edit')}</Button>}
              </div>
            }
          >
            {editingJob ? (
              <JobEditForm job={job} onDone={() => { setEditingJob(false); load(); }} onCancel={() => setEditingJob(false)} />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-ink-muted">{t('jobDetail.equipment', 'Equipment')}</dt><dd className="mt-0.5 font-medium text-ink">{equipmentLabel(job.equipment_type)}</dd></div>
                <div><dt className="text-ink-muted">{t('jobDetail.cargoType', 'Cargo type')}</dt><dd className="mt-0.5 font-medium text-ink">{cargoTypeLabel(job.cargo_type)}</dd></div>
                {job.cargo_weight_tons != null && (
                  <div><dt className="text-ink-muted">{t('jobDetail.cargoWeight', 'Cargo weight')}</dt><dd className="mt-0.5 font-medium text-ink">{job.cargo_weight_tons} t</dd></div>
                )}
                {CONTAINER_EQUIPMENT.includes(job.equipment_type) && (
                  <div><dt className="text-ink-muted">{t('jobDetail.containerNumber', 'Container #')}</dt><dd className="mt-0.5 font-medium text-ink">{job.container_number || '—'}</dd></div>
                )}
                {(job.container_count > 1 || job.truck_count > 1) && (
                  <div><dt className="text-ink-muted">{t('jobDetail.volume', 'Volume')}</dt><dd className="mt-0.5 font-medium text-ink">{job.container_count > 1 ? `${job.container_count} containers` : `${job.truck_count} trucks`}</dd></div>
                )}
                {job.extra_line_items?.length > 0 && (
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-ink-muted">{t('jobDetail.lineItems', 'Container line items')}</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {job.container_count}× {job.container_size} {formatLabel(job.container_type)}
                      {job.extra_line_items.map((li) => `, ${li.count}× ${li.container_size} ${formatLabel(li.container_type)}`).join('')}
                    </dd>
                  </div>
                )}
                <div><dt className="text-ink-muted">{t('jobDetail.readyAt', 'Ready at')}</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(job.ready_at)}</dd></div>
                <div><dt className="text-ink-muted">{t('jobDetail.deadline', 'Deadline')}</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(job.deadline)}</dd></div>
                <div className="col-span-2 sm:col-span-3"><dt className="text-ink-muted">{t('jobDetail.deliveryAddress', 'Delivery address')}</dt><dd className="mt-0.5 font-medium text-ink">{job.delivery_address}</dd></div>
                {job.notes && <div className="col-span-2 sm:col-span-3"><dt className="text-ink-muted">{t('jobDetail.notes', 'Notes')}</dt><dd className="mt-0.5 text-ink-secondary">{job.notes}</dd></div>}
              </dl>
            )}
          </Section>

          <Section title="Shipment legs">
            {/* Matches Dashboard.jsx's useSimpleLocations exactly: the 3-leg
                terminal/depot breakdown only makes sense when a real
                container actually moved through one — an IMPORT/EXPORT job
                posted with truck (non-container) equipment never collected
                terminal/depot fields to show here, so it renders the same
                simple 2-leg view LOCAL always has instead of 3 legs with
                blank terminals. */}
            {job.shipment_type === 'LOCAL' || !CONTAINER_EQUIPMENT.includes(job.equipment_type) ? (
              <div className="grid gap-3">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--brand-primary)' }}>1</span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Loading location</p>
                    <p className="font-medium text-ink">{formatLabel(job.loading_location || job.pickup_terminal)}</p>
                    {job.ready_at && <p className="text-sm text-ink-secondary" dir="ltr">Loading {formatDateTime(job.ready_at)}</p>}
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
            {job.shipment_type !== 'LOCAL' && CONTAINER_EQUIPMENT.includes(job.equipment_type) && (
              <p className="mt-4 text-xs text-ink-muted">Turn-key price covers all 3 legs.</p>
            )}
          </Section>

          <Section title={`Bids (${bids.length})`}>
            {bids.length === 0 ? (
              <p className="text-sm text-ink-muted">No bids yet.</p>
            ) : (
              <div className="space-y-3">
                {bids.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3" style={{ borderColor: b.status === 'ACCEPTED' ? 'var(--status-success)' : 'var(--border-default)' }}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="tabular font-display text-base font-semibold text-ink">{b.masked ? 'Hidden until award' : formatMoney(b.amount_aed, job.currency)}</p>
                        {!b.masked && b.ancillary_charges?.length > 0 && (
                          <p className="tabular text-sm font-semibold" style={{ color: 'var(--status-warning)' }}>
                            + {formatMoney(b.ancillary_charges.reduce((sum, c) => sum + c.amount_aed, 0), job.currency)} extras = {formatMoney(b.amount_aed + b.ancillary_charges.reduce((sum, c) => sum + c.amount_aed, 0), job.currency)} est. total
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted">{b.masked ? 'Competing bid' : `Delivery by ${formatDateTime(b.eta_at)} · ${b.truck_type ? equipmentLabel(b.truck_type) : 'equipment n/a'}`}</p>
                      {!b.masked && b.carrier_company && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
                          <span className="truncate">{b.carrier_company}</span> <RatingPill rating={b.carrier_rating} />
                        </p>
                      )}
                      {!b.masked && b.ancillary_charges?.length > 0 && (
                        <p
                          className="mt-1 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
                        >
                          ⚠ Transporter expects extra charges: {b.ancillary_charges.map((c) => `${ANCILLARY_CHARGE_LABELS[c.charge_type] || c.charge_type} (${formatMoney(c.amount_aed, job.currency)})`).join(', ')}
                        </p>
                      )}
                      {!b.masked && b.carrier_available_units != null && (
                        <p className="mt-0.5 text-xs" style={{ color: b.carrier_available_units <= 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                          {/* One ltrIsolate around the WHOLE combined string, not
                              one per fragment — two separately-isolated LTR runs
                              placed next to each other inside an RTL paragraph
                              still get their relative order reversed by the bidi
                              algorithm (isolation fixes each run's own internal
                              order, not the order runs appear in relative to
                              each other), so this must isolate as one unit. */}
                          {ltrIsolate(
                            (b.carrier_available_units <= 0 ? '⚠ 0 declared available units' : `${b.carrier_available_units} unit(s) available`) +
                            (b.carrier_reliability_score != null ? ` · reliability ${Number(b.carrier_reliability_score).toFixed(1)}` : '')
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge color={b.status === 'ACCEPTED' ? 'success' : b.status === 'REJECTED' ? 'danger' : 'neutral'}>{b.status}</Badge>
                      {isShipper && job.status === 'OPEN' && b.status === 'PENDING' && (
                        <Button variant="accent" onClick={() => openAwardFlow(b)} loading={busy}>Discuss &amp; award</Button>
                      )}
                      {/* Real-life gap: a carrier previously had no way at all to
                          discuss their own bid with the shipper (propose/agree
                          ancillary charges, ask a question) — only the shipper
                          could open this thread, from their side, via "Discuss &
                          award" above. The backend already allowed the bid's own
                          carrier to read/post to it (bids.routes.js's
                          loadBidWithJobForNegotiation), it just had no frontend
                          entry point. Reuses the exact same modal/state as the
                          shipper's flow — see isShipper checks inside it for
                          what's award-only vs. shared. */}
                      {isCarrier && job.status === 'OPEN' && b.status === 'PENDING' && b.carrier_id === user.id && (
                        <Button variant="secondary" onClick={() => openAwardFlow(b)}>Discuss with shipper</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isCarrier && job.status === 'OPEN' && !myBid && (
              <BidForm jobId={job.id} verified={user.is_verified} defaultEquipment={job.equipment_type} paymentTier={job.payment_tier} onDone={load} />
            )}
          </Section>

          <Section title="Documents">
            <DocumentList documents={documents} jobId={job.id} onAdd={load} isShipperParty={isShipper} isCarrierParty={isAwardedCarrier} />
          </Section>

          <Section title="Event history">
            <EventHistory events={events} />
          </Section>

          {/* Haulier Code / Token — import/export only, and only once a
              carrier is actually assigned. Modeled as free text, not tied
              to DP World's specific process, so it holds up for an Abu
              Dhabi Ports or Sharjah Ports job too. */}
          {job.carrier_id && job.shipment_type !== 'LOCAL' && (isShipper || isAwardedCarrier) && (
            <Section title="Haulier Code / Token">
              <HaulierCodeToken job={job} isShipper={isShipper} isAwardedCarrier={isAwardedCarrier} onDone={load} />
            </Section>
          )}

          {job.status === 'COMPLETED' && (isShipper || isAwardedCarrier) && (
            <Section title="Rate your counterparty">
              {myRating ? (
                <div className="flex items-center gap-2 text-sm text-ink">
                  <div className="flex" aria-label={`You rated ${myRating.score} stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <IconStar key={n} size={18} style={{ color: n <= myRating.score ? 'var(--brand-accent)' : 'var(--border-strong)' }} />
                    ))}
                  </div>
                  <span className="text-ink-muted">You already rated this job{myRating.comment ? ` — "${myRating.comment}"` : ''}.</span>
                </div>
              ) : (
                <RatingPanel job={job} onSubmit={load} />
              )}
            </Section>
          )}
        </div>

        <div>
          {track && (
            <Card className="mb-6">
              <Card.Header><Card.Title>Track & payment</Card.Title></Card.Header>
              <Card.Content className="space-y-4 text-sm">
                {job.carrier_id && (
                  // Pickup/delivery tracking only means something once a
                  // carrier is actually assigned (AWARDED+) — an OPEN job
                  // with zero bids has nothing to track yet, so showing
                  // "Awaiting pickup · En route" here reads as if transit
                  // were already underway.
                  <div className="flex items-center gap-2 text-ink-secondary">
                    <IconMapPin size={15} className="text-ink-muted" />
                    <span>{track.geofence.atPickup ? 'At/past pickup' : 'Awaiting pickup'} · {track.geofence.atDelivery ? 'At delivery' : 'En route'}</span>
                  </div>
                )}
                {track.autoReleaseAt && (
                  <div className="flex items-center gap-2 text-ink-secondary">
                    <IconClock size={15} className="text-ink-muted" />
                    <span>Auto-releases {formatDateTime(track.autoReleaseAt)}</span>
                  </div>
                )}
                {job.status === 'CANCELLED' ? (
                  // A cancelled job's payouts row still exists (flipped to
                  // status='CANCELLED', not deleted — job.service.js) so
                  // `payout` below is still truthy here, but its gross/net/
                  // fee figures are the now-moot CARRIER payout that never
                  // happened — showing them to whoever cancelled (usually
                  // the shipper) answered a question nobody asked instead
                  // of the one that matters: what did cancelling actually
                  // cost, and what comes back. Both are already computed
                  // and stored (job.service.js's cancellation transaction),
                  // just never surfaced here before.
                  <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <p className="text-ink-muted">Cancelled</p>
                    {job.agreed_price_aed ? (
                      <>
                        <p className="tabular font-display text-lg font-semibold text-ink">
                          {formatMoney(job.agreed_price_aed - (job.cancellation_fee_aed || 0), job.currency)} refunded
                        </p>
                        <p className="text-xs text-ink-muted">
                          Agreed price {formatMoney(job.agreed_price_aed, job.currency)}
                          {job.cancellation_fee_aed > 0 ? ` − cancellation fee ${formatMoney(job.cancellation_fee_aed, job.currency)}` : ' — no cancellation fee applied'}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-ink-muted">Cancelled before award — nothing was charged.</p>
                    )}
                    {job.cancelled_by_role && (
                      <p className="mt-1 text-xs text-ink-muted">Cancelled by {job.cancelled_by_role.toLowerCase()}{job.cancelled_at ? ` · ${formatDateTime(job.cancelled_at)}` : ''}</p>
                    )}
                    {job.cancellation_reason && (
                      <p className="mt-1 text-xs italic text-ink-muted">"{job.cancellation_reason}"</p>
                    )}
                  </div>
                ) : payout && (
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
            <Card className="mb-6"><Card.Header><Card.Title>Live location</Card.Title></Card.Header><Card.Content><LiveMap jobId={job.id} fallbackLat={job.pickup_lat} fallbackLng={job.pickup_lng} deliveryLat={job.delivery_lat} deliveryLng={job.delivery_lng} /><DetentionAlarm jobId={job.id} /></Card.Content></Card>
          )}

          {/* Hardware telematics (reefer temperature/speed/fuel) — GET
              /api/telematics/logs (telematics.routes.js) was fully built
              with role-scoped access but no frontend caller anywhere,
              found by a QA audit. Renders nothing at all when this job has
              no device data (most jobs don't — it depends on the truck
              actually carrying a telematics unit), rather than an
              empty-state box every job would otherwise show. */}
          {telematicsLogs.length > 0 && (
            <Card className="mb-6">
              <Card.Header><Card.Title>Telematics</Card.Title></Card.Header>
              <Card.Content className="text-sm">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-ink-muted">Temperature</p>
                    <p className="tabular font-display text-xl font-bold text-ink">{telematicsLogs[0].temperature != null ? `${telematicsLogs[0].temperature}°C` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Speed</p>
                    <p className="tabular font-display text-xl font-bold text-ink">{telematicsLogs[0].speed != null ? `${telematicsLogs[0].speed} km/h` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Fuel</p>
                    <p className="tabular font-display text-xl font-bold text-ink">{telematicsLogs[0].fuel_level != null ? `${telematicsLogs[0].fuel_level}%` : '—'}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Last reading {formatDateTime(telematicsLogs[0].recorded_at)} · device {telematicsLogs[0].device_id}</p>
                {telematicsLogs.length > 1 && (
                  <div className="mt-3 max-h-32 overflow-y-auto border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    {telematicsLogs.slice(1, 10).map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-2 py-1 text-xs text-ink-muted">
                        <span>{formatDateTime(l.recorded_at)}</span>
                        <span className="tabular">{l.temperature != null ? `${l.temperature}°C` : '—'} · {l.speed != null ? `${l.speed} km/h` : '—'} · {l.fuel_level != null ? `${l.fuel_level}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Content>
            </Card>
          )}

          {/* ETA prediction — see getEtaPrediction()'s comment on why this is
              a manual "get a prediction" action rather than something
              auto-fetched: the backend is an explicitly-labeled mock model
              standing in for a real AIS/weather pipeline. Useful once
              there's an actual movement to predict a duration for. */}
          {['AWARDED', 'PICKED_UP', 'IN_TRANSIT'].includes(job.status) && (
            <Card className="mb-6">
              <Card.Header>
                <Card.Title>ETA prediction</Card.Title>
                <Button size="sm" variant="secondary" onClick={getEtaPrediction} loading={etaPredicting}>
                  {etaPrediction ? 'Refresh prediction' : 'Get ETA prediction'}
                </Button>
              </Card.Header>
              <Card.Content className="text-sm">
                {!etaPrediction ? (
                  <p className="text-ink-muted">Estimate a delivery window from route, weather, and port-congestion factors.</p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-ink-muted">Predicted transit time</p>
                      <p className="tabular font-display text-2xl font-bold text-ink">{etaPrediction.predictedHours}h</p>
                      <p className="text-xs text-ink-muted">
                        Base {etaPrediction.baseHours}h + weather {etaPrediction.weatherPenalty}h + port congestion {etaPrediction.congestion}h
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Route alternatives</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {etaPrediction.alternatives.map((alt) => (
                          <li key={alt.route} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: 'var(--surface-container)' }}>
                            <span className="flex items-center gap-1.5"><IconClock size={13} className="text-ink-muted" /> {alt.route}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular font-semibold text-ink">{alt.etaHours}h</span>
                              <Badge color={alt.risk === 'LOW' ? 'success' : alt.risk === 'MEDIUM' ? 'warning' : 'danger'}>{alt.risk}</Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs italic text-ink-muted">Model estimate, not a guarantee — refresh for an updated read.</p>
                  </div>
                )}
              </Card.Content>
            </Card>
          )}
          {/* Phase 4: EIR for carrier — captured at BOTH pickup and
              delivery now, not just pickup, so a damage/shortage dispute
              has evidence from both ends of the journey. Each stage only
              renders until its own photos exist. */}
          {isAwardedCarrier && ['PICKED_UP','IN_TRANSIT'].includes(job.status) && !job.eir_photos_pickup && (
            <div className="mb-6"><EirChecklist jobId={job.id} stage="pickup" requiresSeal={!!job.requires_seal} onDone={load} /></div>
          )}
          {isAwardedCarrier && job.status === 'DELIVERED' && !job.eir_photos_delivery && (
            <div className="mb-6"><EirChecklist jobId={job.id} stage="delivery" requiresSeal={!!job.requires_seal} onDone={load} /></div>
          )}
          {isAwardedCarrier && BACKLOAD_ELIGIBLE_STATUSES.includes(job.status) && <BackloadMatches jobId={job.id} />}

          {job.status === 'DISPUTED' && (isShipper || isAwardedCarrier) && (
            <Link to={`/jobs/${job.id}/dispute`} className="btn-danger mb-6 w-full justify-center">
              <IconGavel size={15} /> View dispute
            </Link>
          )}

          {/* Currency selector — shipper can change job currency before award */}
          {isShipper && ['OPEN', 'QUOTING'].includes(job.status) && (
            <Section title={t('jobDetail.currency', 'Currency')} className="mb-6">
              <Card className="border-l-4" style={{ borderLeftColor: 'var(--lb-orange-600)' }}>
                <Card.Content className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-ink">{t('jobDetail.currencyLabel', 'Job Currency')}</p>
                    <p className="text-xs text-ink-muted">{t('jobDetail.currencyDesc', 'Set the currency for this job. All bids and payments will use this currency.')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={job.currency || 'AED'}
                      onChange={(e) => act(async () => { await api.setJobCurrency(job.id, { currency: e.target.value }); })}
                    >
                      {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                    </Select>
                  </div>
                </Card.Content>
              </Card>
            </Section>
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
                <Button className="w-full" variant="accent" onClick={() => act(() => api.setStatus(job.id, 'COMPLETED'))} loading={busy}>
                  {(!job.payment_tier || job.payment_tier === 'INSTANT') ? 'Confirm delivery & release payment' : 'Confirm delivery'}
                </Button>
              )}
              {isShipper && ['OPEN', 'AWARDED', 'DRAFT'].includes(job.status) && (
                <CancelJobPanel job={job} actorRole="SHIPPER" pendingBidCount={bids.filter((b) => b.status === 'PENDING').length} label="Cancel job" variant="danger" onDone={load} />
              )}
              {isAwardedCarrier && job.status === 'AWARDED' && (
                <CancelJobPanel job={job} actorRole="CARRIER" label="Cancel before pickup" variant="ghost" onDone={load} />
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

          {isAwardedCarrier && job.escrow_status !== 'RELEASED' && ['AWARDED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(job.status) && (
            <FuelAdvancePanel job={job} onDone={load} />
          )}

          {/* Read-only for the shipper — the carrier's DriverPanel above is
              where the driver/roster actually gets assigned. */}
          {isShipper && job.assigned_driver_name && (
            <Card className="mb-6">
              <Card.Content>
                <p className="text-xs text-ink-muted">Assigned driver</p>
                <p className="flex items-center gap-2 font-medium text-ink">
                  {job.assigned_driver_name}
                  {/* Commercial-logic audit finding: a carrier can type a
                      driver name/phone with no link to their verified
                      roster — no license, no vehicle doc, nothing checked.
                      Not blocked (a carrier may genuinely need a one-off
                      driver), but the shipper should see the difference
                      rather than this looking identical to a roster driver. */}
                  {!job.driver_verified && (
                    <Badge color="warning" title="This driver was entered by name/phone only — not linked to the transporter's verified roster (no license or vehicle document on file)">
                      Not verified
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-ink-muted">{job.assigned_driver_phone}</p>
                {job.driver_info?.licenseNumber && (
                  <p className="mt-1 text-xs text-ink-muted">
                    Licence {job.driver_info.licenseNumber}{job.driver_info.licenseExpiry ? ` · expires ${job.driver_info.licenseExpiry}` : ''}
                  </p>
                )}
                {(job.driver_info?.hasLicenseDoc || job.driver_info?.hasVehicleDoc) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    {job.driver_info.hasLicenseDoc && (
                      <a href={driverDocumentUrl(job.assigned_driver_id, 'license')} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-secondary hover:underline">
                        <IconFile size={13} /> License document
                      </a>
                    )}
                    {job.driver_info.hasVehicleDoc && (
                      <a href={driverDocumentUrl(job.assigned_driver_id, 'vehicle')} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-secondary hover:underline">
                        <IconFile size={13} /> Vehicle document
                      </a>
                    )}
                  </div>
                )}
              </Card.Content>
            </Card>
          )}
        </div>
      </div>

      {/* Floating, not inline — per the product ask, messaging is a popped-up
          live channel between the two parties once a carrier is actually
          assigned, not part of the page's normal reading flow. */}
      {(isShipper || isAwardedCarrier) && !['OPEN', 'DRAFT'].includes(job.status) && (
        <ChatPopup jobId={job.id} />
      )}
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





