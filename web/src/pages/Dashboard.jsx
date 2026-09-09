import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import {
  CONTAINER_SIZES, CONTAINER_TYPES, TERMINALS, AREAS, DEPOTS, SHIPMENT_TYPES, CONTAINER_EQUIPMENT, CARGO_TYPES, STATUS_FLOW, shipmentTypeLabel,
  equipmentLabel, cargoTypeLabel, formatAED, formatDate, formatLabel,
  PAYMENT_TERMS, PAYMENT_TERM_DESCRIPTIONS, paymentTermLabel, DEFERRED_PAYMENT_TERMS,
  VEHICLE_CLASSES, vehicleClassOf, equipmentTypesForClass,
  LOCAL_EQUIPMENT, LOCAL_LENGTH_TYPES, LOCAL_BODY_TYPE_TYPES, TRUCK_LENGTH_OPTIONS_M, EQUIPMENT_BODY_TYPES, equipmentBodyTypeLabel,
} from '../lib/constants.js';
import { Button, Card, Input, Label, Select, Textarea, EmptyState, ErrorState, StatusBadge, RatingPill, Pagination, BentoStat, JobCard } from '../components/ui.jsx';
import { IconPlus, IconPackage, IconSearch, IconUpload, IconDownload, IconCheck, IconX, IconClose, IconArrowRight, IconTrendUp } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { parseCsv, csvRowsToJobs, downloadJobImportTemplate } from '../lib/csv.js';
import PlaceAutocomplete from '../components/PlaceAutocomplete.jsx';
import TimeSlotPicker from '../components/TimeSlotPicker.jsx';
import TermsModal from '../components/TermsModal.jsx';

const PAGE_SIZE = 20;
// jobs.deadline is a required DB column (sort options, detention/demurrage
// alarms, and job-card displays all read it) — removing the manual picker
// from the post form doesn't remove the need for a value, so this fills it
// in automatically instead of asking the shipper to think about it.
const DEFAULT_DEADLINE_HOURS = 48;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'deadline_asc', label: 'Deadline: soonest' },
];

// Change 1b Phase E — post-a-job as a 3-step wizard, matching the mockup.
const POST_JOB_STEPS = ['Shipment', 'Equipment', 'Locations'];

const emptyJob = {
  shipmentType: 'IMPORT',
  paymentTier: 'INSTANT',
  loadingLocation: '', deliveryLocation: '', scheduleForLater: false, scheduledPostAt: '', packingList: null,
  pickupLat: undefined, pickupLng: undefined, deliveryLat: undefined, deliveryLng: undefined,
  equipmentType: 'TRAILER_20FT', cargoType: 'GENERAL_GOODS',
  containerSize: '20FT', containerType: 'DRY', containerNumber: '', pickupTerminal: TERMINALS[0], deliveryArea: AREAS[0],
  deliveryAddress: '', readyAt: '', targetPriceAed: '', cargoWeightTons: '', customRequirement: '', notes: '',
  containerCount: 1, truckCount: 1, truckLengthM: '', equipmentBodyType: '',
  importPickupTerminal: TERMINALS[0], importUnloadingLocation: AREAS[0], importEmptyReturnLocation: DEPOTS[0],
  exportEmptyPickupLocation: DEPOTS[0], exportLoadingLocation: AREAS[0], exportDepositTerminal: TERMINALS[0],
};

export default function Dashboard() {
  usePageTitle('Dashboard');
  const { user } = useAuth();
  const { t, isRtl } = useLocale();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  // Independent of the filterable/paginated `jobs` list below — always
  // the true most-recent jobs regardless of whatever status filter/search
  // the shipper currently has applied to the full list, so "Recent
  // activity" and the lane-rate card (which reads recentJobs[0]) never
  // silently reflect a filtered view.
  const [recentJobs, setRecentJobs] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsError, setJobsError] = useState('');
  const [templates, setTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(emptyJob);
  // Extra container-type line items beyond the primary size/type/count
  // above — empty by default, so a job posted without touching this stays
  // exactly the single-container request it always was.
  const [extraLineItems, setExtraLineItems] = useState([]);
  // Change 1b Phase E — post-a-job as a 3-step wizard (Shipment type ->
  // Equipment & volume -> Locations & timing), matching the mockup. Every
  // field/handler below is the exact same one the old single-scroll form
  // used; only which step's block renders (and thus which fields are
  // mounted, hence HTML5-validated, at any given moment) has changed.
  const [postStep, setPostStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Progressive disclosure: most shippers already have a standing
  // acceptance of the current Terms version (from signup, or an earlier
  // job) — the backend silently skips requiring this per job in that case
  // (see server/validators/job.schema.js). This checkbox only appears
  // after a first submit attempt actually comes back needing it, instead
  // of showing on every single post and causing checkbox fatigue.
  const [needsTermsCheckbox, setNeedsTermsCheckbox] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const { addToast } = useToasts();

  // Search-as-you-type without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setOffset(0); }, [filter, sort, debouncedSearch]);

  // Closing the modal by any path (Escape, backdrop click, X, Cancel)
  // should also drop any in-progress extra container-type rows, not just a
  // successful submit — otherwise reopening the form shows stale rows.
  // Same reset covers the step position (Change 1b Phase E) — a fresh
  // "Post a job" always starts at step 1, not wherever the last session
  // left off.
  useEffect(() => { if (!showForm) { setExtraLineItems([]); setPostStep(0); } }, [showForm]);

  // Popup modal: close on Escape, lock body scroll
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowForm(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [showForm]);

  // A fresh key per time the form is opened for a new job — reused across
  // retries of the same submit attempt (e.g. after a network error, before
  // the form has closed) so the backend's idempotency middleware can
  // replay the first response instead of creating a duplicate job.
  const postJobIdempotencyKeyRef = React.useRef(null);
  useEffect(() => {
    if (showForm) postJobIdempotencyKeyRef.current = crypto.randomUUID();
  }, [showForm]);

  function loadStats() {
    api.analytics().then((d) => setAnalytics(d.analytics)).catch(() => {});
    // Templates (save-and-reuse job postings) is a SHIPPER-only backend
    // endpoint (server/routes/retention.routes.js) — FORWARDER/BROKER/
    // OWNER_OPERATOR also land on this dashboard but calling it for them
    // just 403s on every page load, so only fetch it for the role that owns it.
    if (user?.role === 'SHIPPER') {
      api.listTemplates().then((d) => setTemplates(d.templates.slice(0, 3))).catch(() => {});
    }
    api.listJobs({ sort: 'date_desc', limit: 3 }).then((d) => setRecentJobs(d.jobs)).catch(() => setRecentJobs([]));
  }
  function loadJobs() {
    const params = { sort, limit: PAGE_SIZE, offset };
    if (filter !== 'all') params.status = filter;
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    setJobsError('');
    api.listJobs(params).then((d) => { setJobs(d.jobs); setJobsTotal(d.total ?? d.jobs.length); }).catch((err) => { setJobs([]); setJobsTotal(0); setJobsError(err.message); });
  }
  function load() {
    loadStats();
    loadJobs();
  }
  useEffect(loadStats, []);
  useEffect(loadJobs, [filter, sort, debouncedSearch, offset]);

  async function onCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      // F11, fixed independently on both branches — kept main's optional
      // chaining (form never had a job_code field; the server generates it,
      // so the toast always fell back to a placeholder before this).
      const deadline = new Date(new Date(form.readyAt).getTime() + DEFAULT_DEADLINE_HOURS * 3600 * 1000).toISOString();
      const created = await api.createJob({
        ...form,
        deadline,
        targetPriceAed: form.targetPriceAed ? Number(form.targetPriceAed) : undefined,
        cargoWeightTons: form.cargoWeightTons === '' ? undefined : Number(form.cargoWeightTons),
        containerCount: CONTAINER_EQUIPMENT.includes(form.equipmentType) ? Number(form.containerCount) || 1 : 1,
        truckCount: CONTAINER_EQUIPMENT.includes(form.equipmentType) ? 1 : Number(form.truckCount) || 1,
        scheduledPostAt: form.scheduleForLater && form.scheduledPostAt ? new Date(form.scheduledPostAt).toISOString() : undefined,
        agreedToTerms,
        // Only sent when the shipper actually used the "add another
        // container type" rows — omitting lineItems keeps the exact
        // pre-existing single-container request shape otherwise.
        lineItems: extraLineItems.length > 0
          ? [{ containerSize: form.containerSize, containerType: form.containerType, count: Number(form.containerCount) || 1 }, ...extraLineItems.map((li) => ({ ...li, count: Number(li.count) || 1 }))]
          : undefined,
      }, postJobIdempotencyKeyRef.current);
      const jobId = created.job?.id;
      if (form.packingList && jobId) {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(form.packingList);
        });
        if (b64) {
          try {
            await api.addDocument(jobId, { title: 'Packing list', docType: 'PACKING_LIST', mimeType: 'application/pdf', fileBase64: b64 });
          } catch (uploadErr) {
            addToast({ type: 'system_message', title: 'Packing list upload failed', body: uploadErr.message });
          }
        }
      }
      setForm(emptyJob);
      setExtraLineItems([]);
      setShowForm(false);
      addToast({
        type: 'status_change',
        title: form.scheduleForLater ? 'Scheduled' : 'Job posted',
        body: form.scheduleForLater
          ? `${created.job?.job_code || 'New job'} will publish automatically at the chosen time`
          : `${created.job?.job_code || 'New job'} posted successfully`,
      });
      load();
    } catch (err) {
      setError(err.message);
      if (/agree to the current Terms/i.test(err.message)) {
        setNeedsTermsCheckbox(true);
      } else {
        addToast({
          type: 'system_message',
          title: 'Error',
          body: err.message,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function rerun(id) {
    await api.rerunTemplate(id);
    load();
  }

  // The 3-leg terminal/depot flow (Step 3) only makes sense when a real
  // shipping container is actually moving through a port terminal and
  // empty-return depot — that's what IMPORT/EXPORT's own labels describe
  // ("Terminal → Customer → Depot"). A shipper who picked IMPORT/EXPORT
  // but a non-container-carrying vehicle (any truck, or a trailer that
  // isn't a container chassis/genset trailer — a lowbed hauling
  // machinery, say) has no container and no depot leg to speak of, so
  // this collapses to the same simple pickup+delivery pair LOCAL already
  // uses, regardless of the shipmentType label chosen in Step 1.
  const useSimpleLocations = form.shipmentType === 'LOCAL' || !CONTAINER_EQUIPMENT.includes(form.equipmentType);

  return (
    <div className="container-page py-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Profile banner — the Stitch shipper-dashboard header pattern.
          Stacks on mobile: identity row, then a full-width action row —
          the previous single flex row squeezed a long company name against
          two buttons on a 360-390px screen, wrapping the name onto 3 lines. */}
      <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-ink-inverse" style={{ background: 'var(--brand-primary)' }}>
            {user?.profile?.company_name?.[0]?.toUpperCase() || '?'}
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold text-ink">{user?.profile?.company_name}</h1>
            <p className="mt-0.5 font-mono text-xs font-semibold text-brand-accent">{t('dashboard.tier', 'Tier {tier} · {count} jobs posted', { tier: user?.tier, count: analytics?.jobsPosted ?? 0 })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={() => setShowImport((v) => !v)}>
            <IconUpload size={15} /> {t('dashboard.importCsv', 'Import CSV')}
          </Button>
          <Button size="sm" className="flex-1 sm:flex-none" disabled={user?.account_approval_status && user.account_approval_status !== 'APPROVED'} onClick={() => setShowForm(true)}>
            <IconPlus size={15} /> {t('dashboard.postJob', 'Post a job')}
          </Button>
        </div>
      </section>

      {showImport && <CsvImportPanel onDone={() => { setShowImport(false); load(); }} onCancel={() => setShowImport(false)} />}

      {analytics && (
        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* accentBar (Change 1b) — the app-shell redesign's KPI-tile
              treatment: a colored left border carries the semantic tone
              instead of a tinted background, same motif as the sidebar's
              active-nav accent bar. Metrics/tones unchanged from the
              earlier Change 1 pass, just the visual shape. */}
          <BentoStat label={t('dashboard.stat.activeJobs', 'Active jobs')} value={analytics.activeJobs} tone="info" accentBar />
          <BentoStat label={t('dashboard.stat.completed', 'Completed')} value={analytics.jobsCompleted} tone="success" accentBar />
          <BentoStat label={t('dashboard.stat.totalSpent', 'Total spent')} value={formatAED(analytics.totalSpentAED)} accentBar />
          <BentoStat label={t('dashboard.stat.savings', 'Savings vs. market')} value={`${analytics.savingsPercent}%`} tone="accent" accentBar />
        </section>
      )}

      {recentJobs && recentJobs.length > 0 && (
        <section className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <RecentActivity jobs={recentJobs} onViewAll={() => document.getElementById('dashboard-job-list')?.scrollIntoView({ behavior: 'smooth' })} />
          <LaneRateBenchmark job={recentJobs[0]} />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('dashboard.postNewJob', 'Post a new job')} onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-surface shadow-2xl" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
            <Card className="border-0 shadow-none">
              <Card.Header>
                <Card.Title className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-accent)' }}><IconPlus size={14} /></span> {t('dashboard.postNewJob', 'Post a new job')}</Card.Title>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-full p-1.5 text-ink-muted hover:bg-surface-container hover:text-ink" aria-label="Close"><IconClose size={18} /></button>
              </Card.Header>
          <form onSubmit={onCreate}>
            <Card.Content>
              {/* Stepper header (Change 1b Phase E) — matches the mockup's
                  boxed step indicator: a filled accent box for the active
                  step, a checkmark for a done one, a bare number for
                  upcoming. Clicking a done step's box jumps back to it
                  (matches "Back" behavior) without needing to re-click
                  Back repeatedly. */}
              <div className="mb-1.5 flex gap-2">
                {POST_JOB_STEPS.map((label, i) => {
                  const done = i < postStep;
                  const active = i === postStep;
                  return (
                    <button
                      type="button"
                      key={label}
                      onClick={() => done && setPostStep(i)}
                      disabled={!done}
                      title={label}
                      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border px-2 py-2.5 text-left transition-colors sm:justify-start sm:px-3"
                      style={{
                        borderColor: active ? 'var(--brand-accent)' : done ? 'var(--status-success)' : 'var(--border-default)',
                        background: active ? 'var(--brand-accent-bg)' : 'var(--bg-surface)',
                        cursor: done ? 'pointer' : 'default',
                      }}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                        style={{
                          background: active ? 'var(--brand-accent)' : done ? 'var(--status-success)' : 'var(--surface-container-high)',
                          color: active || done ? 'var(--text-on-accent)' : 'var(--text-muted)',
                        }}
                      >
                        {done ? <IconCheck size={11} /> : i + 1}
                      </span>
                      {/* Full label only where there's room to show it without
                          truncating into illegible "Shi…"/"Eq…" fragments
                          (see the mobile-fit audit) — the caption below
                          covers narrower screens instead. */}
                      <span className="hidden truncate text-xs font-semibold text-ink sm:inline">{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mb-5 text-xs font-semibold text-ink-muted sm:hidden">Step {postStep + 1} of {POST_JOB_STEPS.length}: {POST_JOB_STEPS[postStep]}</p>

              <div className="grid gap-4 sm:grid-cols-2">
              {/* Step 1 — Shipment type. Everything below (equipment, cargo,
                  locations) depends on this choice, so it comes first —
                  the old single-scroll form buried the picker in the
                  middle, after equipment fields that don't actually need
                  it to render sensibly, but the stepper's own logical
                  order should lead with the choice everything else reads. */}
              {postStep === 0 && (
                <div className="sm:col-span-2">
                  <Label>Shipment direction</Label>
                  <div className="mt-1 grid grid-cols-1 gap-1.5 rounded-lg border p-1 sm:grid-cols-3 sm:gap-0" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-subtle)' }}>
                    {SHIPMENT_TYPES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          // LOCAL never carries a container — skip the
                          // Trailer/Truck picker entirely and default into
                          // the LOCAL-only truck list; switching away from
                          // LOCAL resets back to a sensible trailer default.
                          const enteringLocal = st === 'LOCAL' && form.shipmentType !== 'LOCAL';
                          const leavingLocal = st !== 'LOCAL' && form.shipmentType === 'LOCAL';
                          setForm({
                            ...form,
                            shipmentType: st,
                            ...(enteringLocal ? { equipmentType: LOCAL_EQUIPMENT[0], truckLengthM: '', equipmentBodyType: '' } : {}),
                            ...(leavingLocal ? { equipmentType: 'TRAILER_20FT', truckLengthM: '', equipmentBodyType: '' } : {}),
                          });
                        }}
                        className={`rounded-md px-3 py-2 text-left text-sm font-semibold transition sm:text-center ${form.shipmentType === st ? 'bg-white shadow text-ink' : 'text-ink-muted hover:text-ink'}`}
                        style={form.shipmentType === st ? { background: 'var(--bg-raised)', borderColor: 'var(--border-default)' } : {}}
                      >
                        {shipmentTypeLabel(st)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {form.shipmentType === 'IMPORT'
                      ? 'Container is picked at the port terminal, delivered to your customer, empty returns to depot.'
                      : form.shipmentType === 'EXPORT'
                        ? 'Empty is picked at depot, loaded at your site, then deposited at the port.'
                        : 'Inland move with any road equipment — box truck, pickup, flatbed or custom. No container needed.'}
                  </p>

                  <div className="mt-4">
                    <Label>When will you pay?</Label>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {PAYMENT_TERMS.map((pt) => {
                        const isDeferred = DEFERRED_PAYMENT_TERMS.includes(pt);
                        const creditEligible = !!user?.profile?.credit_approved_at;
                        const creditAvailable = (user?.profile?.credit_limit_aed || 0) - (user?.profile?.credit_balance_aed || 0);
                        const disabled = isDeferred && !creditEligible;
                        return (
                          <button
                            key={pt}
                            type="button"
                            disabled={disabled}
                            onClick={() => setForm({ ...form, paymentTier: pt })}
                            className="rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
                            style={{
                              borderColor: form.paymentTier === pt ? 'var(--brand-accent)' : 'var(--border-default)',
                              background: form.paymentTier === pt ? 'var(--brand-accent-bg)' : 'var(--bg-surface)',
                            }}
                          >
                            <p className="text-sm font-semibold text-ink">{paymentTermLabel(pt)}</p>
                            <p className="mt-0.5 text-xs text-ink-muted">{PAYMENT_TERM_DESCRIPTIONS[pt]}</p>
                            {isDeferred && (
                              <p className="mt-1 text-xs font-medium" style={{ color: creditEligible ? 'var(--status-success)' : 'var(--status-warning)' }}>
                                {creditEligible ? `AED ${creditAvailable.toLocaleString()} available of AED ${(user.profile.credit_limit_aed || 0).toLocaleString()}` : 'Not yet approved for your account — contact Loadbyton.'}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2 — Equipment & volume */}
              {postStep === 1 && (
                <>
                  {form.shipmentType === 'LOCAL' ? (
                    <div className="sm:col-span-2">
                      <Label>Truck type</Label>
                      <Select
                        value={form.equipmentType}
                        onChange={(e) => setForm({ ...form, equipmentType: e.target.value, truckLengthM: '', equipmentBodyType: '' })}
                      >
                        {LOCAL_EQUIPMENT.map((t) => <option key={t} value={t}>{equipmentLabel(t)}</option>)}
                      </Select>
                      <p className="mt-1 text-xs text-ink-muted">A local move never needs a shipping container — pick the truck body that fits the load.</p>
                    </div>
                  ) : (
                    <>
                  <div className="sm:col-span-2">
                    <Label>Trailer or truck?</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {VEHICLE_CLASSES.map((vc) => {
                        const active = vehicleClassOf(form.equipmentType) === vc;
                        return (
                          <button
                            key={vc}
                            type="button"
                            onClick={() => { if (!active) setForm({ ...form, equipmentType: equipmentTypesForClass(vc)[0] }); }}
                            className="rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors"
                            style={{
                              borderColor: active ? 'var(--brand-accent)' : 'var(--border-default)',
                              background: active ? 'var(--brand-accent-bg)' : 'var(--bg-surface)',
                              color: active ? 'var(--brand-accent)' : 'var(--ink)',
                            }}
                          >
                            {vc === 'TRAILER' ? 'Trailer' : 'Truck'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">A trailer is towed by a separate tractor unit; a truck's bed is fixed to its own chassis.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>{vehicleClassOf(form.equipmentType) === 'TRAILER' ? 'Trailer type' : 'Truck type'}</Label>
                    <Select
                      value={form.equipmentType}
                      onChange={(e) => {
                        const next = e.target.value;
                        // TRAILER_20FT/40FT name the container size they're
                        // built for — the size field below locks to match
                        // instead of letting the two contradict each other.
                        const impliedSize = next === 'TRAILER_20FT' ? '20FT' : next === 'TRAILER_40FT' ? '40FT' : null;
                        setForm({ ...form, equipmentType: next, ...(impliedSize ? { containerSize: impliedSize } : {}) });
                      }}
                    >
                      {equipmentTypesForClass(vehicleClassOf(form.equipmentType)).map((t) => <option key={t} value={t}>{equipmentLabel(t)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">
                      {CONTAINER_EQUIPMENT.includes(form.equipmentType)
                        ? 'Container-carrying equipment — set the container size and type below.'
                        : 'General freight — describe the cargo in the notes field below instead of a container size.'}
                    </p>
                  </div>
                    </>
                  )}
                  {CONTAINER_EQUIPMENT.includes(form.equipmentType) ? (
                    <div>
                      <Label>No. of containers</Label>
                      <Input type="number" min="1" value={form.containerCount} onChange={(e) => setForm({ ...form, containerCount: e.target.value })} />
                      <p className="mt-1 text-xs text-ink-muted">Leave at 1 for a single load. Raise to post one inquiry a carrier fulfils as a batch.</p>
                    </div>
                  ) : (
                    <div>
                      <Label>No. of trucks required</Label>
                      <Input type="number" min="1" value={form.truckCount} onChange={(e) => setForm({ ...form, truckCount: e.target.value })} />
                      <p className="mt-1 text-xs text-ink-muted">Leave at 1 for a single load. Raise to post one inquiry a carrier fulfils as a batch.</p>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <Label>Cargo type</Label>
                    <Select value={form.cargoType} onChange={(e) => setForm({ ...form, cargoType: e.target.value })}>
                      {CARGO_TYPES.map((t) => <option key={t} value={t}>{cargoTypeLabel(t)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">What's inside the load — helps carriers judge handling requirements before bidding.</p>
                  </div>
                  {CONTAINER_EQUIPMENT.includes(form.equipmentType) ? (
                    <>
                      <div>
                        <Label>Container size</Label>
                        {form.equipmentType === 'TRAILER_20FT' || form.equipmentType === 'TRAILER_40FT' ? (
                          <>
                            <Select value={form.containerSize} disabled>
                              <option value={form.containerSize}>{form.containerSize}</option>
                            </Select>
                            <p className="mt-1 text-xs text-ink-muted">Locked to match the trailer type chosen above.</p>
                          </>
                        ) : (
                          <Select value={form.containerSize} onChange={(e) => setForm({ ...form, containerSize: e.target.value })}>
                            {CONTAINER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        )}
                      </div>
                      <div>
                        <Label>Container type</Label>
                        <Select value={form.containerType} onChange={(e) => setForm({ ...form, containerType: e.target.value })}>
                          {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
                        </Select>
                      </div>
                      {/* Multi-container-type support: needs more than one size/
                          type in the same job (e.g. 2x 40HC + 1x 20FT) instead
                          of posting separate jobs. Optional — empty by default. */}
                      <div className="sm:col-span-2 flex flex-col gap-2">
                        {extraLineItems.map((li, idx) => (
                          <div key={idx} className="flex items-center gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border-default)' }}>
                            <Select
                              value={li.containerSize}
                              onChange={(e) => setExtraLineItems((items) => items.map((it, i) => (i === idx ? { ...it, containerSize: e.target.value } : it)))}
                              className="flex-1"
                            >
                              {CONTAINER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Select
                              value={li.containerType}
                              onChange={(e) => setExtraLineItems((items) => items.map((it, i) => (i === idx ? { ...it, containerType: e.target.value } : it)))}
                              className="flex-1"
                            >
                              {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
                            </Select>
                            <Input
                              type="number"
                              min="1"
                              value={li.count}
                              onChange={(e) => setExtraLineItems((items) => items.map((it, i) => (i === idx ? { ...it, count: e.target.value } : it)))}
                              className="w-20"
                              aria-label="Count"
                            />
                            <Button type="button" variant="ghost" size="sm" onClick={() => setExtraLineItems((items) => items.filter((_, i) => i !== idx))} aria-label="Remove line item">
                              <IconX size={14} />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => setExtraLineItems((items) => [...items, { containerSize: CONTAINER_SIZES[0], containerType: CONTAINER_TYPES[0], count: 1 }])}
                        >
                          <IconPlus size={13} /> Add another container type
                        </Button>
                      </div>
                    </>
                  ) : form.equipmentType === 'CUSTOM' ? (
                    <div className="sm:col-span-2">
                      <Label>Truck / requirement (required for custom)</Label>
                      <Input
                        required
                        value={form.customRequirement}
                        onChange={(e) => setForm({ ...form, customRequirement: e.target.value })}
                        placeholder='e.g. "Double-deck trailer with 20 ft deck, load securement harness included"'
                      />
                      <p className="mt-1 text-xs text-ink-muted">Carriers see this as the job's requirement and bid with their own matching equipment.</p>
                    </div>
                  ) : LOCAL_LENGTH_TYPES.includes(form.equipmentType) ? (
                    <>
                      <div>
                        <Label>Truck length</Label>
                        <Select value={form.truckLengthM} onChange={(e) => setForm({ ...form, truckLengthM: e.target.value })}>
                          <option value="" disabled>Select length</option>
                          {TRUCK_LENGTH_OPTIONS_M.map((m) => <option key={m} value={m}>{m}m</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Cargo weight (tons)</Label>
                        <Input type="number" min="0.1" step="0.1" value={form.cargoWeightTons} onChange={(e) => setForm({ ...form, cargoWeightTons: e.target.value })} placeholder="e.g. 8.5" />
                      </div>
                    </>
                  ) : LOCAL_BODY_TYPE_TYPES.includes(form.equipmentType) ? (
                    <div>
                      <Label>Body type</Label>
                      <Select value={form.equipmentBodyType} onChange={(e) => setForm({ ...form, equipmentBodyType: e.target.value })}>
                        <option value="" disabled>Select body type</option>
                        {EQUIPMENT_BODY_TYPES.map((b) => <option key={b} value={b}>{equipmentBodyTypeLabel(b)}</option>)}
                      </Select>
                    </div>
                  ) : null}
                </>
              )}

              {/* Step 3 — Locations & timing */}
              {postStep === 2 && (
                <>
                  {useSimpleLocations ? (
                    <>
                      <div>
                        <Label>Loading location <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.loadingLocation}
                          onChange={(e) => setForm({ ...form, loadingLocation: e.target.value, pickupTerminal: e.target.value, pickupLat: undefined, pickupLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, loadingLocation: address, pickupTerminal: address, pickupLat: lat, pickupLng: lng }))}
                          placeholder="Warehouse, yard, site — e.g. Al Quoz Industrial 3"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Where the truck loads your cargo.</p>
                      </div>
                      <div>
                        <Label>Delivery location <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.deliveryLocation}
                          onChange={(e) => setForm({ ...form, deliveryLocation: e.target.value, deliveryArea: e.target.value, deliveryAddress: e.target.value, deliveryLat: undefined, deliveryLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, deliveryLocation: address, deliveryArea: address, deliveryAddress: address, deliveryLat: lat, deliveryLng: lng }))}
                          placeholder="Drop-off address or area"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Where the cargo is unloaded.</p>
                      </div>
                    </>
                  ) : form.shipmentType === 'IMPORT' ? (
                    <>
                      <div>
                        <Label>Container pickup at terminal <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.importPickupTerminal}
                          onChange={(e) => setForm({ ...form, importPickupTerminal: e.target.value, pickupTerminal: e.target.value, pickupLat: undefined, pickupLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, importPickupTerminal: address, pickupTerminal: address, pickupLat: lat, pickupLng: lng }))}
                          placeholder="Search terminals…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 1/3 — where the laden container is picked up.</p>
                      </div>
                      <div>
                        <Label>Unloading location (delivery) <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.importUnloadingLocation}
                          onChange={(e) => setForm({ ...form, importUnloadingLocation: e.target.value, deliveryArea: e.target.value, deliveryAddress: e.target.value, deliveryLat: undefined, deliveryLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, importUnloadingLocation: address, deliveryArea: address, deliveryAddress: address, deliveryLat: lat, deliveryLng: lng }))}
                          placeholder="Search delivery address…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 2/3 — where cargo is unloaded.</p>
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Empty container return location <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.importEmptyReturnLocation}
                          onChange={(e) => setForm({ ...form, importEmptyReturnLocation: e.target.value })}
                          onPlaceSelect={({ address }) => setForm((f) => ({ ...f, importEmptyReturnLocation: address }))}
                          placeholder="Search depots…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 3/3 — depot where empty is returned (detention clock stops here).</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <Label>Empty pickup location <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.exportEmptyPickupLocation}
                          onChange={(e) => setForm({ ...form, exportEmptyPickupLocation: e.target.value })}
                          onPlaceSelect={({ address }) => setForm((f) => ({ ...f, exportEmptyPickupLocation: address }))}
                          placeholder="Search depots…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 1/3 — depot where empty container is picked up.</p>
                      </div>
                      <div>
                        <Label>Loading location <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.exportLoadingLocation}
                          onChange={(e) => setForm({ ...form, exportLoadingLocation: e.target.value, deliveryArea: e.target.value, deliveryAddress: e.target.value, deliveryLat: undefined, deliveryLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, exportLoadingLocation: address, deliveryArea: address, deliveryAddress: address, deliveryLat: lat, deliveryLng: lng }))}
                          placeholder="Search shipper site address…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 2/3 — shipper site where container is stuffed.</p>
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Deposit location (port/terminal) <span className="text-status-danger">*</span></Label>
                        <PlaceAutocomplete
                          required
                          value={form.exportDepositTerminal}
                          onChange={(e) => setForm({ ...form, exportDepositTerminal: e.target.value, pickupTerminal: e.target.value, pickupLat: undefined, pickupLng: undefined })}
                          onPlaceSelect={({ address, lat, lng }) => setForm((f) => ({ ...f, exportDepositTerminal: address, pickupTerminal: address, pickupLat: lat, pickupLng: lng }))}
                          placeholder="Search terminals…"
                        />
                        <p className="mt-1 text-xs text-ink-muted">Leg 3/3 — terminal where laden container is deposited.</p>
                      </div>
                    </>
                  )}
                  <div className="sm:col-span-2">
                    <Label>Delivery address detail</Label>
                    <Input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Street, warehouse, building, contact" />
                    <p className="mt-1 text-xs text-ink-muted">Precise address for the unloading/loading location above.</p>
                  </div>
                  {/* Already captured on step 2 for LOCAL's "vehicle body"
                      equipment types (right next to truck length, where it's
                      required before advancing) — asking again here would be
                      the same question twice on two different steps. */}
                  {!(form.shipmentType === 'LOCAL' && LOCAL_LENGTH_TYPES.includes(form.equipmentType)) && (
                  <div>
                    <Label>Cargo weight (tons)</Label>
                    <Input type="number" min="0" step="0.5" value={form.cargoWeightTons} onChange={(e) => setForm({ ...form, cargoWeightTons: e.target.value })} placeholder="e.g. 24" />
                    <p className="mt-1 text-xs text-ink-muted">Approximate gross weight of the cargo — helps carriers pick the right equipment.</p>
                  </div>
                  )}
                  <div className="sm:col-span-2">
                    <TimeSlotPicker
                      label={useSimpleLocations ? 'Loading date & time slot' : 'Ready at (time slot)'}
                      required
                      value={form.readyAt}
                      onChange={(v) => setForm({ ...form, readyAt: v })}
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      No separate deadline to set — carriers see this job as open for {DEFAULT_DEADLINE_HOURS} hours from the start of your slot.
                    </p>
                  </div>
                  <div>
                    <Label>Target price (AED, per trip)</Label>
                    <Input type="number" min="0" value={form.targetPriceAed} onChange={(e) => setForm({ ...form, targetPriceAed: e.target.value })} placeholder="600" />
                    <p className="mt-1 text-xs text-ink-muted">The price you're targeting for this trip — not a hard cap; higher bids still arrive, flagged.</p>
                  </div>
                  <div className="sm:col-span-2 grid gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
                    <div>
                      <Label>Packing list (PDF, optional)</Label>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => setForm({ ...form, packingList: e.target.files && e.target.files[0] ? e.target.files[0] : null })}
                        className="mt-1 block w-full text-sm text-ink-secondary file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand-accent)] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:opacity-90"
                      />
                      <p className="mt-1 text-xs text-ink-muted">Attached to this job; the awarded carrier sees it once you confirm their bid.</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-ink-secondary">
                      <input type="checkbox" checked={form.scheduleForLater} onChange={(e) => setForm({ ...form, scheduleForLater: e.target.checked })} /> Post later (schedule publishing)
                    </label>
                    {form.scheduleForLater && (
                      <div>
                        <TimeSlotPicker
                          label="Publish at (time slot)"
                          required
                          value={form.scheduledPostAt}
                          onChange={(v) => setForm({ ...form, scheduledPostAt: v })}
                        />
                        <p className="mt-1 text-xs text-ink-muted">Job stays a private draft until this time, then goes live to carriers automatically.</p>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <Label>{CONTAINER_EQUIPMENT.includes(form.equipmentType) ? 'Notes (optional)' : 'Cargo description'}</Label>
                    <Textarea
                      rows={2}
                      required={!CONTAINER_EQUIPMENT.includes(form.equipmentType)}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder={CONTAINER_EQUIPMENT.includes(form.equipmentType) ? 'Gate pass instructions, contact on site, etc.' : 'What is being moved — e.g. "40 tonnes of aggregate, site access via gate 4."'}
                    />
                  </div>
                  {needsTermsCheckbox && (
                    <label className="sm:col-span-2 flex items-start gap-2 text-sm text-ink-secondary">
                      <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} className="mt-0.5" />
                      <span>I have read and agree to the current <button type="button" onClick={() => setShowTermsModal(true)} className="font-medium text-brand-secondary hover:underline">Terms &amp; Conditions</button> (updated since your last acceptance)</span>
                    </label>
                  )}
                </>
              )}

              {error && <p className="sm:col-span-2 rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>{error}</p>}
              </div>
            </Card.Content>
            <Card.Footer>
              {postStep > 0 ? (
                <Button type="button" variant="ghost" onClick={() => { setError(''); setPostStep(postStep - 1); }}>Back</Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              )}
              {postStep < POST_JOB_STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={() => {
                    // The one truly-required field that would otherwise sit
                    // unmounted (and so unvalidated by the browser) once its
                    // own step is left: a CUSTOM equipment job's requirement
                    // text. Everything else required lives in the final
                    // step, still mounted together with the submit button,
                    // so native HTML5 validation already covers it.
                    if (postStep === 1 && form.equipmentType === 'CUSTOM' && !form.customRequirement.trim()) {
                      setError('Enter the truck/requirement for custom equipment before continuing.');
                      return;
                    }
                    if (postStep === 1 && LOCAL_LENGTH_TYPES.includes(form.equipmentType) && (!form.truckLengthM || !form.cargoWeightTons)) {
                      setError('Select a truck length and enter the cargo weight before continuing.');
                      return;
                    }
                    if (postStep === 1 && LOCAL_BODY_TYPE_TYPES.includes(form.equipmentType) && !form.equipmentBodyType) {
                      setError('Select a body type (open or covered) before continuing.');
                      return;
                    }
                    setError('');
                    setPostStep(postStep + 1);
                  }}
                >
                  Continue
                </Button>
              ) : (
                <Button type="submit" loading={submitting} disabled={needsTermsCheckbox && !agreedToTerms}>Post job</Button>
              )}
            </Card.Footer>
          </form>
        </Card>
          </div>
        </div>
      )}

      {showTermsModal && <TermsModal onClose={() => setShowTermsModal(false)} />}

      {templates.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Re-run a saved lane</p>
          <div className="scroll-fade-x flex gap-2.5 overflow-x-auto pb-1">
            {templates.map((t) => (
              <button key={t.id} onClick={() => rerun(t.id)} className="card flex shrink-0 items-center gap-2 px-4 py-3 text-sm hover:shadow-md">
                <IconPackage size={16} style={{ color: 'var(--brand-accent)' }} />
                <span className="font-medium text-ink">{t.name}</span>
                <span className="text-ink-muted">· re-run</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div id="dashboard-job-list" className="mt-8 scroll-mt-20">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">Your jobs</h2>
        {jobs === null ? (
          <p className="mt-3 text-sm text-ink-muted">Loading…</p>
        ) : jobsError ? (
          <ErrorState className="mt-3" title="Couldn't load your jobs" description={jobsError} onRetry={loadJobs} />
        ) : jobs.length === 0 && filter === 'all' && !debouncedSearch ? (
          <EmptyState className="mt-3" title="No jobs yet" description="Post your first drayage job to start getting carrier bids." action={<Button onClick={() => setShowForm(true)}>Post a job</Button>} />
        ) : (
          <div className="mt-3">
            {/* Sticky filter bar (Change 1 mockup §2) — top-14 clears
                Shell.jsx's own sticky h-14 header (mobile and desktop both),
                z-20 keeps it below that header's z-30/z-40 so nothing
                overlaps; the solid --bg-canvas background (the real page
                background token, not a card surface) stops scrolled job
                cards from showing through underneath it. */}
            <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-end gap-3 px-4 py-3 sm:mx-0 sm:px-0" style={{ background: 'var(--bg-canvas)' }}>
              <div className="min-w-[140px]">
                <Label>Filter by status</Label>
                <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full">
                  <option value="all">All statuses</option>
                  {STATUS_FLOW.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
                  <option value="CANCELLED">Cancelled</option>
                  <option value="DISPUTED">Disputed</option>
                </Select>
              </div>
              <div className="min-w-[140px]">
                <Label>Sort</Label>
                <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-full">
                  {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
              <div className="min-w-[200px] flex-1 sm:max-w-xs">
                <Label>{t('dashboard.search', 'Search')}</Label>
                {/* Icon lives in its own relative wrapper around just the
                    Input (not the Label), so top-1/2 centers against the
                    input's own box instead of a hardcoded pixel guess at
                    label+input combined height. RTL-aware: the icon and its
                    matching input padding both flip sides under dir="rtl". */}
                <div className="relative">
                  <IconSearch size={15} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRtl ? 'right-3' : 'left-3'}`} />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('dashboard.searchPlaceholder', 'Job code, address, notes…')} className={isRtl ? 'pr-9' : 'pl-9'} />
                </div>
              </div>
            </div>
            {jobs.length === 0 ? (
              <EmptyState className="mt-4" title={t('dashboard.empty.title', 'No jobs match these filters')} description={t('dashboard.empty.description', 'Try a broader search or clear a filter.')} />
            ) : (
              <div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {jobs.map((j) => (
                    <JobCard
                      key={j.id}
                      onClick={() => navigate(`/jobs/${j.id}`)}
                      jobCode={j.job_code}
                      topRight={<StatusBadge status={j.status} />}
                      priceLabel={formatAED(j.agreed_price_aed || j.max_budget_aed)}
                      origin={formatLabel(j.pickup_terminal)}
                      destination={formatLabel(j.delivery_area)}
                      chips={[
                        CONTAINER_EQUIPMENT.includes(j.equipment_type) ? `${j.container_size} ${formatLabel(j.container_type)}` : equipmentLabel(j.equipment_type),
                        ...(j.container_count > 1 ? [`×${j.container_count} containers`] : []),
                        ...(j.truck_count > 1 ? [`×${j.truck_count} trucks`] : []),
                      ]}
                      meta={<span className="flex items-center justify-between"><span>Deadline {formatDate(j.deadline)}</span><RatingPill rating={j.carrier_rating} /></span>}
                    />
                  ))}
                </div>
                <Pagination total={jobsTotal} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// CSV job import — parses client-side (web/src/lib/csv.js), previews the
// parsed rows, then posts them as an array to POST /api/jobs/import, which
// validates/creates each row independently and reports per-row success.
function CsvImportPanel({ onDone, onCancel }) {
  const { addToast } = useToasts();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setParseError('');
    setResults(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = csvRowsToJobs(parseCsv(String(reader.result)));
        if (parsed.length === 0) throw new Error('No data rows found — check the file has a header row plus at least one job.');
        setRows(parsed);
      } catch (err) {
        setParseError(err.message);
        setRows(null);
      }
    };
    reader.readAsText(file);
  }

  async function submit() {
    setBusy(true);
    try {
      const d = await api.importJobs(rows);
      setResults(d.results);
      if (d.created > 0) {
        addToast({ type: 'status_change', title: 'Import complete', body: `${d.created} job(s) posted${d.failed ? `, ${d.failed} failed` : ''}.` });
      }
      if (d.failed === 0) onDone();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Import failed', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-8">
      <Card.Header>
        <Card.Title>Import jobs from CSV</Card.Title>
        <Button variant="ghost" size="sm" onClick={downloadJobImportTemplate}><IconDownload size={14} /> Download template</Button>
      </Card.Header>
      <Card.Content className="space-y-4">
        <div>
          <Label>CSV file</Label>
          <input type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
          <p className="mt-1 text-xs text-ink-muted">Header row must match the template — pickupTerminal, deliveryArea, deliveryAddress, readyAt, deadline are required per row.</p>
        </div>
        {parseError && <p className="text-sm text-status-danger">{parseError}</p>}
        {rows && !results && (
          <div>
            <p className="text-sm text-ink-secondary">{fileName} — {rows.length} row(s) parsed. Review before importing:</p>
            <div className="mt-2 max-h-56 overflow-auto rounded-md border text-xs" style={{ borderColor: 'var(--border-default)' }}>
              <table className="w-full text-left">
                <thead><tr className="border-b text-ink-muted" style={{ borderColor: 'var(--border-subtle)' }}><th className="whitespace-nowrap px-3 py-1.5">#</th><th className="whitespace-nowrap px-3 py-1.5">Lane</th><th className="whitespace-nowrap px-3 py-1.5">Ready → Deadline</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="whitespace-nowrap px-3 py-1.5">{i + 1}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.pickupTerminal || '—'} → {r.deliveryArea || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.readyAt || '—'} → {r.deadline || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {results && (
          <div>
            <p className="text-sm text-ink-secondary">{results.filter((r) => r.ok).length} of {results.length} imported.</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
              {results.map((r) => (
                <li key={r.row} className="flex items-start gap-2">
                  {r.ok ? <IconCheck size={13} className="mt-0.5 shrink-0 text-status-success" /> : <IconX size={13} className="mt-0.5 shrink-0 text-status-danger" />}
                  <span className="shrink-0 text-ink-muted">Row {r.row}:</span>
                  {r.ok ? <span className="min-w-0 break-words text-ink">{r.jobCode} posted</span> : <span className="min-w-0 break-words text-status-danger">{r.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card.Content>
      <Card.Footer>
        <Button type="button" variant="ghost" onClick={onCancel}>Close</Button>
        {rows && !results && (
          <Button onClick={submit} loading={busy}><IconUpload size={14} /> Import {rows.length} job(s)</Button>
        )}
      </Card.Footer>
    </Card>
  );
}

// Change 1b (app-shell redesign) — a 3-row preview of the shipper's most
// recent jobs, always sorted newest-first and never affected by whatever
// status filter/search is applied to the full list below (Dashboard's own
// `recentJobs` state is an independent fetch — see `loadStats()`). "View
// all jobs" scrolls to the existing full list rather than duplicating its
// filter/sort/search/pagination here.
function RecentActivity({ jobs, onViewAll }) {
  const navigate = useNavigate();
  return (
    <Card>
      <Card.Header>
        <Card.Title>Recent activity</Card.Title>
        <button type="button" onClick={onViewAll} className="flex items-center gap-1 text-xs font-semibold text-brand-secondary hover:underline">
          View all jobs <IconArrowRight size={12} />
        </button>
      </Card.Header>
      <Card.Content className="!p-0">
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => navigate(`/jobs/${j.id}`)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-container"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px] font-semibold text-ink">{j.job_code}</p>
                <p className="truncate text-xs text-ink-muted">{formatLabel(j.pickup_terminal)} → {formatLabel(j.delivery_area)}</p>
              </div>
              <StatusBadge status={j.status} />
            </button>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

// Real data, not a mockup placeholder: GET /api/lanes/quote (already used
// by BidForm's target-price suggestion) against the shipper's own
// most-recently-posted job's terminal/area pair. The seed lane data only
// carries one reference price per lane (no historical range), so this
// shows that reference price + on-time%/monthly-load-volume context
// instead of inventing a min-max spread the backend can't actually back up.
// Renders nothing (not an error state) when there's no lane reference or
// no job yet — this is a nice-to-have insight, not a required panel.
function LaneRateBenchmark({ job }) {
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    if (!job?.pickup_terminal || !job?.delivery_area) return;
    api.getLaneQuote(job.pickup_terminal, job.delivery_area).then(setQuote).catch(() => setQuote(null));
  }, [job?.pickup_terminal, job?.delivery_area]);

  if (!job) return null;
  if (quote && !quote.lane) return null; // no exact reference for this lane — nothing useful to show

  return (
    <Card>
      <Card.Header>
        <Card.Title>Lane rate benchmark</Card.Title>
      </Card.Header>
      <Card.Content>
        <p className="text-xs text-ink-muted">{formatLabel(job.pickup_terminal)} → {formatLabel(job.delivery_area)}</p>
        {quote?.guidance ? (
          <>
            <p className="mt-1 font-display text-2xl font-bold text-ink tabular">{formatAED(quote.guidance.suggestedTargetAed)}</p>
            <div className="mt-3 flex items-center gap-4 text-xs text-ink-secondary">
              <span className="flex items-center gap-1"><IconTrendUp size={13} style={{ color: 'var(--status-success)' }} /> {quote.guidance.onTimePct}% on-time</span>
              <span>{quote.guidance.monthlyLoads} loads/mo on this lane</span>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">{quote.guidance.note}</p>
          </>
        ) : (
          <p className="mt-2 h-16 animate-pulse rounded" style={{ background: 'var(--surface-container-low)' }} />
        )}
      </Card.Content>
    </Card>
  );
}