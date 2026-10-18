// Benefits dashboard: the company's verification, Business OS activation and
// plan, usage ceilings, and premium membership state. Reads
// GET /api/ecosystem/benefits; the server decides everything shown here.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { usePageTitle } from '../../lib/seo.jsx';
import { formatDate } from '../../lib/constants.js';
import { Badge, Button, Card, EmptyState, ErrorState, Label, Select, Skeleton } from '../../components/ui.jsx';
import { STORE_SECTORS, sectorName } from '../../brand/storeSectors.js';
import { useToasts } from '../../components/Toast.jsx';

const PLAN_NAME = { starter_included: 'Starter Included', enterprise_included: 'Enterprise Included' };
const STATUS = {
  active: { color: 'success', label: 'Active' },
  grace: { color: 'warning', label: 'Payment grace' },
  suspended: { color: 'danger', label: 'Suspended' },
  ended: { color: 'neutral', label: 'Ended' },
};
const LIMIT_ROWS = [
  ['max_users', 'Users'], ['max_branches', 'Branches'], ['max_sectors', 'Sectors'], ['max_entities', 'Legal entities'],
  ['storage_mb', 'Storage', (v) => (v >= 1024 ? `${v / 1024} GB` : `${v} MB`)],
  ['jobs_per_month', 'Jobs per month'], ['trips_per_month', 'Trips per month'], ['fulfilment_orders_per_month', 'Fulfilment orders per month'],
  ['wh_orders_per_month', 'Warehouse orders per month'], ['parcels_per_month', 'Parcels per month'], ['cus_cases_per_month', 'Customs cases per month'],
  ['specialist_cases_per_month', 'Specialist cases per month'], ['messages_per_month', 'Messages per month'], ['ai_drafts_per_month', 'Assistant drafts per month'],
];
const n = (v) => Number(v).toLocaleString('en-AE');

const formatMoney = (minor, cur = 'AED') => `${String(cur).toUpperCase()} ${(Number(minor) / 100).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Benefits() {
  usePageTitle('Business OS & benefits');
  const { addToast } = useToasts();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [sector, setSector] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState('');
  const [premTerms, setPremTerms] = useState(false);
  const [orders, setOrders] = useState([]);

  function load() {
    setError('');
    api.ecosystemBenefits().then(setData).catch((e) => setError(e.message || 'Could not load your benefits.'));
    api.premiumPlans().then(setPlans).catch(() => setPlans({ plans: [], checkout: 'not_open' }));
    api.premiumOrders().then((r) => setOrders(r.orders || [])).catch(() => setOrders([]));
  }
  useEffect(load, []);

  async function activate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.activateStore({ sector, acceptTerms: accepted });
      addToast({ type: 'status_change', title: 'Business OS activated', body: 'Your workspace is created the first time you open it.' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not activate', body: err.message });
    } finally { setBusy(false); }
  }

  async function subscribe(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.premiumCheckout({ planVersionId: Number(planId), acceptTerms: premTerms });
      if (r.url) { window.location.assign(r.url); return; }
      addToast({ type: 'status_change', title: 'Checkout started', body: 'Waiting for the payment provider to confirm.' });
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not start checkout', body: err.message });
    } finally { setBusy(false); }
  }

  if (error) return <div className="container-page py-6"><ErrorState title="Couldn’t load your benefits" description={error} onRetry={load} /></div>;
  if (!data) return <div className="container-page py-6"><Skeleton count={4} /></div>;

  const { organisation, store, entitlement, premium, viewerRole } = data;
  const isOwner = viewerRole === 'owner';
  const verified = organisation.verification === 'VERIFIED';
  const st = entitlement && (STATUS[entitlement.status] || STATUS.active);

  return (
    <div className="container-page py-6">
      <h1 className="font-display text-2xl font-bold text-ink">Business OS &amp; benefits</h1>
      <p className="mt-1 text-sm text-ink-muted">What your company gets with its Loadbyton account.</p>

      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-muted">Company</p>
            <p className="font-display text-lg font-semibold text-ink">{organisation.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge color={verified ? 'success' : 'warning'}>{verified ? 'Verified company' : 'Not verified yet'}</Badge>
            <Link className="text-sm text-brand-secondary underline" to="/account/organisation">Organisation</Link>
          </div>
        </div>
        {!verified && (
          <p className="mt-3 text-sm text-ink-secondary">
            Business OS is available to verified companies. <Link className="text-brand-secondary underline" to="/documents">Complete your documents</Link> to be reviewed.
          </p>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-display text-lg font-semibold text-ink">Business OS</h2>
        {!store.activated ? (
          isOwner && verified ? (
            <form className="mt-3 space-y-4" onSubmit={activate}>
              <p className="text-sm text-ink-secondary">Operating software for your logistics company, included with your verified account. Activating creates your workspace the first time you open it; nothing is migrated silently.</p>
              <div>
                <Label htmlFor="sector">Your main sector</Label>
                <Select id="sector" value={sector} onChange={(e) => setSector(e.target.value)} required>
                  <option value="" disabled>Choose a sector…</option>
                  {STORE_SECTORS.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
                </Select>
                <p className="mt-1 text-xs text-ink-muted">Starter Included covers one sector.</p>
              </div>
              <label className="flex items-start gap-2 text-sm text-ink-secondary">
                <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>I am authorised to act for {organisation.name} and accept the <Link className="text-brand-secondary underline" to="/business-os-terms">Business OS terms</Link> and the <Link className="text-brand-secondary underline" to="/data-sharing">data sharing notice</Link>, including that limits are plan ceilings and that external usage and managed services are quoted separately.</span>
              </label>
              <Button type="submit" loading={busy} disabled={!sector || !accepted}>Activate Business OS</Button>
            </form>
          ) : (
            <EmptyState title={verified ? 'Not activated yet' : 'Verification needed first'}
              description={verified ? 'Only your company administrator can activate Business OS. Ask them to open this page.' : 'Once your company is verified, your administrator can activate Business OS here.'} />
          )
        ) : (
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-secondary">Sector: <b className="text-ink">{sectorName(store.sector)}</b></p>
              {entitlement && <Badge color={st.color}>{PLAN_NAME[entitlement.planCode] || 'No plan'} · {st.label}</Badge>}
            </div>
            {entitlement && entitlement.status === 'grace' && (
              <p className="rounded-md p-3 text-sm" style={{ background: 'var(--status-warning-bg)', color: 'var(--lb-amber-text)' }} role="status">
                Premium payment is overdue. Enterprise Included continues until {formatDate(entitlement.graceUntil)}, then your company returns to Starter Included. Your data is kept and stays exportable.
              </p>
            )}
            {entitlement && entitlement.endsAt && (
              <p className="rounded-md p-3 text-sm" style={{ background: 'var(--status-info-bg)', color: 'var(--status-info)' }} role="status">
                Premium was cancelled. Enterprise Included continues until {formatDate(entitlement.endsAt)}, then your company returns to Starter Included.
              </p>
            )}
            {entitlement && entitlement.status === 'suspended' && (
              <p className="rounded-md p-3 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }} role="alert">
                Your workspace is read-only because your company is no longer verified. Records stay readable and exportable.
              </p>
            )}
            {store.openUrl && entitlement && entitlement.status !== 'ended' && (
              <a className="btn-primary inline-flex" href={store.openUrl}>Open Business OS</a>
            )}
            {entitlement && entitlement.limits && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <caption className="mb-2 text-left text-xs uppercase tracking-wide text-ink-muted">Plan ceilings</caption>
                  <tbody>
                    {LIMIT_ROWS.map(([key, label, fmt]) => (
                      <tr key={key} className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                        <th scope="row" className="py-2 pr-4 font-normal text-ink-secondary">{label}</th>
                        <td className="py-2 font-mono text-ink">{fmt ? fmt(entitlement.limits[key]) : n(entitlement.limits[key])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-ink-muted">{data.notes.join(' ')}</p>
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-display text-lg font-semibold text-ink">Premium membership</h2>
        {premium.subscriptions.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm text-ink-secondary">
            {premium.subscriptions.map((s) => (
              <li key={s.id}>{s.planName} · <b className="text-ink">{s.status.replace('_', ' ').toLowerCase()}</b> · current period ends {formatDate(s.periodEnd)}</li>
            ))}
          </ul>
        ) : null}
        {premium.subscriptions.length === 0 && plans && plans.plans.length > 0 && plans.checkout === 'open' && isOwner && verified ? (
          <form className="mt-3 space-y-4" onSubmit={subscribe}>
            <p className="text-sm text-ink-secondary">Premium upgrades Business OS from Starter Included to Enterprise Included. Cancel any time; access continues to the end of the period you paid for.</p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Choose a plan</legend>
              {plans.plans.map((p) => (
                <label key={p.id} className="flex items-start gap-3 rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                  <input type="radio" name="plan" className="mt-1" value={p.id} checked={String(planId) === String(p.id)} onChange={() => setPlanId(String(p.id))} />
                  <span className="text-ink-secondary">
                    <b className="text-ink">{p.name}</b> · {formatMoney(p.priceMinor, p.currency)} {p.billingPeriod === 'annual' ? 'per year' : 'per month'}
                    <br /><span className="text-xs text-ink-muted">+ VAT {formatMoney(p.vatMinor, p.currency)} = {formatMoney(p.totalMinor, p.currency)} today</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-ink-muted">{plans.plans[0].taxNote}</p>
            <label className="flex items-start gap-2 text-sm text-ink-secondary">
              <input type="checkbox" className="mt-1" checked={premTerms} onChange={(e) => setPremTerms(e.target.checked)} />
              <span>I am authorised to act for {organisation.name} and accept the <Link className="text-brand-secondary underline" to="/premium-terms">Premium Membership terms</Link>.</span>
            </label>
            <Button type="submit" loading={busy} disabled={!planId || !premTerms}>Continue to secure payment</Button>
          </form>
        ) : premium.subscriptions.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">
            {plans && plans.plans.length > 0
              ? (!isOwner ? 'Only your company administrator can buy Premium.' : !verified ? 'Verify your company to buy Premium.' : 'Online checkout is not open yet. Your account manager can set Premium up for your company.')
              : 'Premium membership is not open for purchase yet.'}
          </p>
        ) : null}
        {orders.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink">Payments and receipts</h3>
            <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
              {orders.map((o) => (
                <li key={o.id}>{formatDate(o.paidAt || o.createdAt)} · {o.planName} · {formatMoney(o.totalMinor, o.currency)} incl. VAT · <b className="text-ink">{o.status.replace('_', ' ').toLowerCase()}</b>{o.receiptNo ? ` · ${o.receiptNo}` : ''}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
