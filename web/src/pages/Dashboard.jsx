import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import {
  CONTAINER_SIZES, CONTAINER_TYPES, TERMINALS, AREAS, DEPOTS, SHIPMENT_TYPES, EQUIPMENT_TYPES, CONTAINER_EQUIPMENT, STATUS_FLOW,
  equipmentLabel, formatAED, formatDate, formatLabel, depotLabel,
} from '../lib/constants.js';
import { Button, Card, Input, Label, Select, Textarea, EmptyState, StatusBadge, RatingPill, Pagination, BentoStat, JobCard } from '../components/ui.jsx';
import { IconPlus, IconPackage, IconSearch, IconUpload, IconDownload, IconCheck, IconX, IconWallet, IconClose } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { parseCsv, csvRowsToJobs, downloadJobImportTemplate } from '../lib/csv.js';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'deadline_asc', label: 'Deadline: soonest' },
];

const emptyJob = {
  shipmentType: 'IMPORT',
  equipmentType: 'CONTAINER_CHASSIS',
  containerSize: '40HC', containerType: 'DRY', containerNumber: '', pickupTerminal: TERMINALS[0], deliveryArea: AREAS[0],
  deliveryAddress: '', readyAt: '', deadline: '', targetPriceAed: '', cargoWeightTons: '', customRequirement: '', notes: '',
  containerCount: 1, truckCount: 1,
  importPickupTerminal: TERMINALS[0], importUnloadingLocation: AREAS[0], importEmptyReturnLocation: DEPOTS[0],
  exportEmptyPickupLocation: DEPOTS[0], exportLoadingLocation: AREAS[0], exportDepositTerminal: TERMINALS[0],
};

export default function Dashboard() {
  usePageTitle('Dashboard');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(emptyJob);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const { addToast } = useToasts();

  // Search-as-you-type without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setOffset(0); }, [filter, sort, debouncedSearch]);

  // Popup modal: close on Escape, lock body scroll
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowForm(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [showForm]);

  function loadStats() {
    api.analytics().then((d) => setAnalytics(d.analytics)).catch(() => {});
    api.listTemplates().then((d) => setTemplates(d.templates.slice(0, 3))).catch(() => {});
  }
  function loadJobs() {
    const params = { sort, limit: PAGE_SIZE, offset };
    if (filter !== 'all') params.status = filter;
    if (debouncedSearch.trim()) params.q = debouncedSearch.trim();
    api.listJobs(params).then((d) => { setJobs(d.jobs); setJobsTotal(d.total ?? d.jobs.length); }).catch(() => { setJobs([]); setJobsTotal(0); });
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
      const created = await api.createJob({
        ...form,
        targetPriceAed: form.targetPriceAed ? Number(form.targetPriceAed) : undefined,
        cargoWeightTons: form.cargoWeightTons === '' ? undefined : Number(form.cargoWeightTons),
        containerCount: Number(form.containerCount) || 1,
        truckCount: Number(form.truckCount) || 1,
      });
      setForm(emptyJob);
      setShowForm(false);
      addToast({
        type: 'status_change',
        title: 'Job posted',
        body: `${created.job?.job_code || 'New job'} posted successfully`,
      });
      load();
    } catch (err) {
      setError(err.message);
      addToast({
        type: 'system_message',
        title: 'Error',
        body: err.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function rerun(id) {
    await api.rerunTemplate(id);
    load();
  }

  return (
    <div className="container-page py-6" dir="ltr">
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
            <p className="mt-0.5 font-mono text-xs font-semibold text-brand-accent">Tier {user?.tier} · {analytics?.jobsPosted ?? 0} jobs posted</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={() => setShowImport((v) => !v)}>
            <IconUpload size={15} /> Import CSV
          </Button>
          <Button size="sm" className="flex-1 sm:flex-none" disabled={user?.account_approval_status && user.account_approval_status !== 'APPROVED'} onClick={() => setShowForm(true)}>
            <IconPlus size={15} /> Post a job
          </Button>
        </div>
      </section>

      {showImport && <CsvImportPanel onDone={() => { setShowImport(false); load(); }} onCancel={() => setShowImport(false)} />}

      {analytics && (
        <section className="mt-4 grid grid-cols-2 gap-3">
          <BentoStat label="Active jobs" value={analytics.activeJobs} />
          <BentoStat label="Completed" value={analytics.jobsCompleted} />
          <BentoStat label="Total spent" value={formatAED(analytics.totalSpentAED)} icon={<IconWallet size={22} />} />
          <BentoStat label="Savings vs. market" value={`${analytics.savingsPercent}%`} tone="accent" />
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Post a new job" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-surface shadow-2xl" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
            <Card className="border-0 shadow-none">
              <Card.Header>
                <Card.Title className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-accent)' }}><IconPlus size={14} /></span> Post a new job</Card.Title>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-full p-1.5 text-ink-muted hover:bg-surface-container hover:text-ink" aria-label="Close"><IconClose size={18} /></button>
              </Card.Header>
          <form onSubmit={onCreate}>
            <Card.Content className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Equipment type</Label>
                <Select value={form.equipmentType} onChange={(e) => setForm({ ...form, equipmentType: e.target.value })}>
                  {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{equipmentLabel(t)}</option>)}
                </Select>
                <p className="mt-1 text-xs text-ink-muted">
                  {CONTAINER_EQUIPMENT.includes(form.equipmentType)
                    ? 'Container-carrying equipment — set the container size and type below.'
                    : 'General freight — describe the cargo in the notes field below instead of a container size.'}
                </p>
              </div>
              {CONTAINER_EQUIPMENT.includes(form.equipmentType) ? (
                <>
                  <div>
                    <Label>Container size</Label>
                    <Select value={form.containerSize} onChange={(e) => setForm({ ...form, containerSize: e.target.value })}>
                      {CONTAINER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Container type</Label>
                    <Select value={form.containerType} onChange={(e) => setForm({ ...form, containerType: e.target.value })}>
                      {CONTAINER_TYPES.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
                    </Select>
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
              ) : null}
              <div className="sm:col-span-2">
                <Label>Shipment direction</Label>
                <div className="mt-1 flex rounded-lg border p-1" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-subtle)' }}>
                  {SHIPMENT_TYPES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setForm({ ...form, shipmentType: st })}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${form.shipmentType === st ? 'bg-white shadow text-ink' : 'text-ink-muted hover:text-ink'}`}
                      style={form.shipmentType === st ? { background: 'var(--bg-raised)', borderColor: 'var(--border-default)' } : {}}
                    >
                      {st === 'IMPORT' ? 'Import — Terminal → Customer → Depot' : 'Export — Depot → Shipper → Terminal'}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {form.shipmentType === 'IMPORT'
                    ? 'Container is picked at the port terminal, delivered to your customer, empty returns to depot.'
                    : 'Empty is picked at depot, loaded at your site, then deposited at the port.'}
                </p>
              </div>
              {form.shipmentType === 'IMPORT' ? (
                <>
                  <div>
                    <Label>Container pickup at terminal <span className="text-status-danger">*</span></Label>
                    <Select value={form.importPickupTerminal} onChange={(e) => setForm({ ...form, importPickupTerminal: e.target.value, pickupTerminal: e.target.value })}>
                      {TERMINALS.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 1/3 — where the laden container is picked up.</p>
                  </div>
                  <div>
                    <Label>Unloading location (delivery) <span className="text-status-danger">*</span></Label>
                    <Select value={form.importUnloadingLocation} onChange={(e) => setForm({ ...form, importUnloadingLocation: e.target.value, deliveryArea: e.target.value, deliveryAddress: e.target.value })}>
                      {AREAS.map((a) => <option key={a} value={a}>{formatLabel(a)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 2/3 — where cargo is unloaded.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Empty container return location <span className="text-status-danger">*</span></Label>
                    <Select value={form.importEmptyReturnLocation} onChange={(e) => setForm({ ...form, importEmptyReturnLocation: e.target.value })}>
                      {DEPOTS.map((d) => <option key={d} value={d}>{depotLabel(d)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 3/3 — depot where empty is returned (detention clock stops here).</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>Empty pickup location <span className="text-status-danger">*</span></Label>
                    <Select value={form.exportEmptyPickupLocation} onChange={(e) => setForm({ ...form, exportEmptyPickupLocation: e.target.value })}>
                      {DEPOTS.map((d) => <option key={d} value={d}>{depotLabel(d)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 1/3 — depot where empty container is picked up.</p>
                  </div>
                  <div>
                    <Label>Loading location <span className="text-status-danger">*</span></Label>
                    <Select value={form.exportLoadingLocation} onChange={(e) => setForm({ ...form, exportLoadingLocation: e.target.value, deliveryArea: e.target.value, deliveryAddress: e.target.value })}>
                      {AREAS.map((a) => <option key={a} value={a}>{formatLabel(a)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 2/3 — shipper site where container is stuffed.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Deposit location (port/terminal) <span className="text-status-danger">*</span></Label>
                    <Select value={form.exportDepositTerminal} onChange={(e) => setForm({ ...form, exportDepositTerminal: e.target.value, pickupTerminal: e.target.value })}>
                      {TERMINALS.map((t) => <option key={t} value={t}>{formatLabel(t)}</option>)}
                    </Select>
                    <p className="mt-1 text-xs text-ink-muted">Leg 3/3 — terminal where laden container is deposited.</p>
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <Label>Delivery address detail</Label>
                <Input value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Street, warehouse, building, contact" />
                <p className="mt-1 text-xs text-ink-muted">Precise address for the unloading/loading location above.</p>
              </div>
              <div>
                <Label>Cargo weight (tons)</Label>
                <Input type="number" min="0" step="0.5" value={form.cargoWeightTons} onChange={(e) => setForm({ ...form, cargoWeightTons: e.target.value })} placeholder="e.g. 24" />
                <p className="mt-1 text-xs text-ink-muted">Approximate gross weight of the cargo — helps carriers pick the right equipment.</p>
              </div>
              <div>
                <Label>Ready at</Label>
                <Input type="datetime-local" required value={form.readyAt} onChange={(e) => setForm({ ...form, readyAt: e.target.value })} />
              </div>
              <div>
                <Label>Deadline</Label>
                <Input type="datetime-local" required value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </div>
              <div className="sm:col-span-2 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
                <p className="text-sm font-medium text-ink">Volume — how much does this job cover?</p>
                <p className="mt-0.5 text-xs text-ink-muted">Leave both at 1 for a single load. Raise either to post one inquiry a carrier fulfils as a batch.</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>No. of containers</Label>
                    <Input type="number" min="1" value={form.containerCount} onChange={(e) => setForm({ ...form, containerCount: e.target.value })} />
                  </div>
                  <div>
                    <Label>No. of trucks</Label>
                    <Input type="number" min="1" value={form.truckCount} onChange={(e) => setForm({ ...form, truckCount: e.target.value })} />
                  </div>
                </div>
              </div>
              <div>
                <Label>Target price (AED, per trip)</Label>
                <Input type="number" min="0" value={form.targetPriceAed} onChange={(e) => setForm({ ...form, targetPriceAed: e.target.value })} placeholder="600" />
                <p className="mt-1 text-xs text-ink-muted">The price you're targeting for this trip — not a hard cap; higher bids still arrive, flagged.</p>
              </div>
              <div className="flex flex-wrap items-end gap-4 pb-2">
                <label className="flex items-center gap-2 text-sm text-ink-secondary">
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-secondary">
                </label>
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
              {error && <p className="sm:col-span-2 rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>{error}</p>}
            </Card.Content>
            <Card.Footer>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" loading={submitting}>Post job</Button>
            </Card.Footer>
          </form>
        </Card>
          </div>
        </div>
      )}

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

      <div className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">Your jobs</h2>
        {jobs === null ? (
          <p className="mt-3 text-sm text-ink-muted">Loading…</p>
        ) : jobs.length === 0 && filter === 'all' && !debouncedSearch ? (
          <EmptyState className="mt-3" title="No jobs yet" description="Post your first drayage job to start getting carrier bids." action={<Button onClick={() => setShowForm(true)}>Post a job</Button>} />
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-end gap-3">
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
                <Label>Search</Label>
                {/* Icon lives in its own relative wrapper around just the
                    Input (not the Label), so top-1/2 centers against the
                    input's own box instead of a hardcoded pixel guess at
                    label+input combined height. */}
                <div className="relative">
                  <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job code, address, notes…" className="pl-9" />
                </div>
              </div>
            </div>
            {jobs.length === 0 ? (
              <EmptyState className="mt-4" title="No jobs match these filters" description="Try a broader search or clear a filter." />
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