import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, roleHome } from '../lib/auth.jsx';
import { Button, Input, Label, Card } from '../components/ui.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { IconTruck, IconPackage, IconArrowLeft, IconArrowRight, IconCheckCircle } from '../components/icons.jsx';

const STEPS = ['Role', 'Business', 'Account'];

// Client-side mirror of the server's UAE-format validators (server/index.js)
// so a wrong format is caught before submit, not after a round trip. The
// server enforces the same rules regardless — this only improves UX.
const UAE_MOBILE_RE = /^(\+9715|05)\d{8}$/;
const UAE_TRN_RE = /^\d{15}$/;
const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;

export default function Register() {
  usePageTitle('Create your account');
  const { register } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('role') === 'CARRIER' ? 'CARRIER' : params.get('role') === 'SHIPPER' ? 'SHIPPER' : null);
  const [step, setStep] = useState(role ? 1 : 0);
  const [form, setForm] = useState({
    companyName: '', email: '', password: '', phone: '', trnNumber: '', tradeLicenseNumber: '', referralCode: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateField(name) {
    if (name === 'phone') {
      const phone = form.phone.trim().replace(/\s+/g, '');
      if (!phone) return 'Phone number is required.';
      if (!UAE_MOBILE_RE.test(phone)) return 'Enter a valid UAE mobile number — 05XXXXXXXX or +9715XXXXXXXX. Landlines and international numbers aren\u2019t accepted.';
    }
    if (name === 'trnNumber') {
      const trn = form.trnNumber.trim();
      if (!trn) return 'TRN is required.';
      if (!UAE_TRN_RE.test(trn)) return 'TRN must be exactly 15 digits — the UAE Tax Registration Number on your VAT certificate.';
    }
    if (name === 'tradeLicenseNumber') {
      const licence = form.tradeLicenseNumber.trim().toUpperCase();
      if (!licence) return 'Trade licence number is required.';
      if (!UAE_LICENCE_RE.test(licence)) return 'Trade licence must be 5\u201315 letters, digits, or dashes and contain at least one digit.';
    }
    if (name === 'companyName' && !form.companyName.trim()) return 'Company name is required.';
    return null;
  }

  function validateBusinessFields() {
    const errors = {};
    for (const f of ['companyName', 'phone', 'trnNumber', 'tradeLicenseNumber']) {
      const msg = validateField(f);
      if (msg) errors[f] = msg;
    }
    return errors;
  }

  function handleBlur(e) {
    const msg = validateField(e.target.name);
    setFieldErrors((prev) => ({ ...prev, [e.target.name]: msg || undefined }));
  }

  function handleContinue() {
    const errors = validateBusinessFields();
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setError('');
    setStep(2);
    scrollTop();
  }

  function FieldError({ name }) {
    return fieldErrors[name] ? (
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--status-danger)' }} role="alert">{fieldErrors[name]}</p>
    ) : null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    const errors = validateBusinessFields();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setStep(1);
      scrollTop();
      return;
    }
    setLoading(true);
    try {
      const user = await register({ ...form, role });
      navigate(roleHome(user.role), { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  function chooseRole(r) {
    setRole(r);
    setStep(1);
    scrollTop();
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] items-center justify-center py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <p className="font-display text-xl font-bold text-ink">Create your account</p>
        <p className="mt-1 text-sm text-ink-muted">Post drayage jobs, or bid on them — pick which one you are.</p>

        {/* Step progress — matches the carrier_registration multi-step
            pattern (get_started_choice -> business details -> account). */}
        <div className="mt-5 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-1.5">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold"
                  style={i <= step ? { background: 'var(--brand-accent)', color: 'var(--text-on-accent)' } : { background: 'var(--surface-container-high)', color: 'var(--text-muted)' }}
                >
                  {i < step ? <IconCheckCircle size={13} /> : i + 1}
                </span>
                <span className={i <= step ? 'text-xs font-semibold text-ink' : 'text-xs text-ink-muted'}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <span className="h-0.5 flex-1" style={{ background: i < step ? 'var(--brand-accent)' : 'var(--outline-variant)' }} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 0 — get-started role choice */}
        {step === 0 && (
          <div className="mt-6 flex flex-col gap-3">
            <button type="button" onClick={() => chooseRole('SHIPPER')} className="card flex items-center gap-4 p-5 text-left hover:shadow-elevated">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-container-high)' }}>
                <IconPackage size={22} className="text-brand-accent" />
              </span>
              <div className="flex-1">
                <p className="font-display font-bold text-ink">I ship freight</p>
                <p className="text-sm text-ink-muted">Post jobs, get verified-carrier bids, track under escrow.</p>
              </div>
              <IconArrowRight size={18} className="text-ink-muted" />
            </button>
            <button type="button" onClick={() => chooseRole('CARRIER')} className="card flex items-center gap-4 p-5 text-left hover:shadow-elevated">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-container-high)' }}>
                <IconTruck size={22} className="text-brand-accent" />
              </span>
              <div className="flex-1">
                <p className="font-display font-bold text-ink">I move freight</p>
                <p className="text-sm text-ink-muted">Browse open loads, bid, get paid on delivery.</p>
              </div>
              <IconArrowRight size={18} className="text-ink-muted" />
            </button>
          </div>
        )}

        {/* Step 1 — business details */}
        {step === 1 && (
          <div className="mt-6 space-y-4">
            <div>
              <Label htmlFor="companyName">{t('auth.companyName')}</Label>
              <Input id="companyName" name="companyName" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} onBlur={handleBlur} placeholder="Al-Majid Global Freight" />
              <FieldError name="companyName" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} onBlur={handleBlur} placeholder="05XXXXXXXX or +9715XXXXXXXX" />
                <p className="mt-1 text-xs text-ink-muted">UAE mobile number — no landlines</p>
                <FieldError name="phone" />
              </div>
              <div>
                <Label htmlFor="trn">TRN number</Label>
                <Input id="trn" name="trnNumber" required value={form.trnNumber} onChange={(e) => setForm({ ...form, trnNumber: e.target.value })} onBlur={handleBlur} placeholder="100000000000000" inputMode="numeric" maxLength={15} />
                <p className="mt-1 text-xs text-ink-muted">UAE Tax Registration Number — exactly 15 digits</p>
                <FieldError name="trnNumber" />
              </div>
            </div>
            <div>
              <Label htmlFor="license">Trade licence number</Label>
              <Input id="license" name="tradeLicenseNumber" required value={form.tradeLicenseNumber} onChange={(e) => setForm({ ...form, tradeLicenseNumber: e.target.value.toUpperCase() })} onBlur={handleBlur} placeholder="CN-1122334" maxLength={15} />
              <p className="mt-1 text-xs text-ink-muted">5-15 letters/digits/dashes, at least one digit</p>
              <FieldError name="tradeLicenseNumber" />
            </div>
            {role === 'CARRIER' && (
              <p className="rounded-md px-3 py-2 text-xs" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
                New accounts are read-only until an admin approves them; carrier verification (TRN, trade licence, insurance) happens separately before bidding — usually within a day.
              </p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setStep(0); scrollTop(); }}><IconArrowLeft size={15} /> Back</Button>
              <Button type="button" className="flex-1" disabled={!form.companyName} onClick={handleContinue}>Continue</Button>
            </div>
          </div>
        )}

        {/* Step 2 — account credentials + submit */}
        {step === 2 && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.ae" />
              </div>
              <div>
                <Label htmlFor="password">{t('auth.password')}</Label>
                {/* Matches the server's MIN_PASSWORD_LENGTH (server/index.js). */}
                <Input id="password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
              </div>
            </div>
            <div>
              <Label htmlFor="referral">Referral code (optional)</Label>
              <Input id="referral" value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} placeholder="CAR-EMIRATES" />
            </div>
            {error && (
              <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setStep(1); scrollTop(); }}><IconArrowLeft size={15} /> Back</Button>
              <Button type="submit" className="flex-1" loading={loading}>{t('auth.register')}</Button>
            </div>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-ink-muted">
          Already have an account? <Link to="/login" className="font-medium text-brand-secondary hover:underline">Log in</Link>
        </p>
      </Card>
    </div>
  );
}
