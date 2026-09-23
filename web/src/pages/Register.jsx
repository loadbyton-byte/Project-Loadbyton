// Redesigned Register page — visual design ported from the design-tool
// export's pages/Auth.jsx (RegisterPage), wired to the real account
// service. The export's own submit handler was a non-functional preview
// stub (`setDone(true)` with no request sent) — this uses the same
// register/redirect/validation logic the previous Register.jsx had
// (useAuth().register, UAE TRN/phone/trade-licence validation, redirect to
// role home on success).
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, roleHome } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { MktIcon } from '../components/marketing/MktIcon.jsx';
import { SitePage, PHOTOS, PAGE, delay } from '../components/marketing/SubKit.jsx';
import { MktAuthFrame, PwField } from '../components/marketing/AuthKit.jsx';
import TermsModal from '../components/TermsModal.jsx';

// Client-side mirror of the server's UAE-format validators (server/index.js)
// so a wrong format is caught before submit, not after a round trip. The
// server enforces the same rules regardless — this only improves UX.
const UAE_MOBILE_RE = /^(\+9715|05)\d{8}$/;
const UAE_TRN_RE = /^\d{15}$/;
const UAE_LICENCE_RE = /^(?=.*\d)[A-Z0-9-]{5,15}$/;

const ROLES = [
  { key: 'SHIPPER', icon: 'Package', label: 'I am a shipper', desc: 'Post freight jobs, get transporter bids, track with payment protection' },
  { key: 'CARRIER', icon: 'Truck', label: 'I am a transporter', desc: 'Browse open loads, bid, get paid on delivery' },
  { key: 'FORWARDER', icon: 'Compass', label: 'I am a freight forwarder', desc: 'Manage freight forwarding, client roster, assign loads' },
  { key: 'BROKER', icon: 'Layers', label: 'I am a freight broker', desc: 'Broker jobs, direct-assign carriers, earn broker spread' },
  { key: 'OWNER_OPERATOR', icon: 'Trailer', label: 'I am a fleet owner', desc: 'Own and operate your own fleet of trucks' },
];
const STEPS = ['Role', 'Business', 'Account'];

export default function Register() {
  usePageTitle('Create your account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qRole = params.get('role');
  const initRole = ROLES.some((r) => r.key === qRole) ? qRole : null;
  const [role, setRole] = useState(initRole);
  const [step, setStep] = useState(initRole ? 1 : 0);
  const [form, setForm] = useState({ companyName: '', phone: '', trnNumber: '', tradeLicenseNumber: '', email: '', password: '', referralCode: '', agreed: false });
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: k === 'tradeLicenseNumber' ? e.target.value.toUpperCase() : e.target.value });
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  function check(name) {
    if (name === 'companyName' && !form.companyName.trim()) return 'Company name is required.';
    if (name === 'phone') { const p = form.phone.trim().replace(/\s+/g, ''); if (!p) return 'Phone number is required.'; if (!UAE_MOBILE_RE.test(p)) return 'Enter a valid UAE mobile number — 05XXXXXXXX or +9715XXXXXXXX. Landlines and international numbers aren’t accepted.'; }
    if (name === 'trnNumber') { const t = form.trnNumber.trim(); if (!t) return 'TRN is required.'; if (!UAE_TRN_RE.test(t)) return 'TRN must be exactly 15 digits — the UAE Tax Registration Number on your VAT certificate.'; }
    if (name === 'tradeLicenseNumber') { const l = form.tradeLicenseNumber.trim(); if (!l) return 'Trade licence number is required.'; if (!UAE_LICENCE_RE.test(l)) return 'Trade licence must be 5–15 letters, digits, or dashes and contain at least one digit.'; }
    return null;
  }
  function validateBusinessFields() {
    const e = {};
    ['companyName', 'phone', 'trnNumber', 'tradeLicenseNumber'].forEach((f) => { const m = check(f); if (m) e[f] = m; });
    return e;
  }
  function blur(e) { const m = check(e.target.name); setErrs((p) => ({ ...p, [e.target.name]: m || undefined })); }
  function cont() {
    const e = validateBusinessFields();
    setErrs(e); if (Object.keys(e).length) return; setStep(2); top();
  }
  async function submit(e) {
    e.preventDefault();
    setError('');
    const errors = validateBusinessFields();
    if (Object.keys(errors).length) { setErrs(errors); setStep(1); top(); return; }
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
  function Err({ n }) { return errs[n] ? <p className="field-err" role="alert">{errs[n]}</p> : null; }
  const roleObj = ROLES.find((r) => r.key === role);

  return (
    <SitePage>
      <MktAuthFrame photo={PHOTOS.yard} kicker="JOIN THE VERIFIED FREIGHT NETWORK" title="Start with your real operating role." body="A shipper, transporter, forwarder, broker and owner-operator need different controls — but they all contribute to the same accountable load record.">
        <div className="auth-card mkt-reveal">
          <div className="auth-card-head">
            <h2>Create your account</h2>
            <p>Post drayage jobs, or bid on them — pick which one you are.</p>
            <div className="auth-steps" aria-label={'Step ' + (step + 1) + ' of 3'}>
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <span className={'s' + (i <= step ? ' on' : '')}><b>{i < step ? <MktIcon name="Check" size={12} strokeWidth={2.5} /> : i + 1}</b>{s}</span>
                  {i < STEPS.length - 1 && <span className={'bar' + (i < step ? ' on' : '')} />}
                </React.Fragment>
              ))}
            </div>
          </div>

          {step === 0 ? (
            <div className="auth-card-body step-in">
              <div className="role-list">
                {ROLES.map((r) => (
                  <button key={r.key} type="button" className="role-opt" onClick={() => { setRole(r.key); setStep(1); top(); }}>
                    <span className="pcard-ico"><MktIcon name={r.icon} size={20} /></span>
                    <span><b>{r.label}</b><small>{r.desc}</small></span>
                    <MktIcon name="ArrowRight" size={18} />
                  </button>
                ))}
              </div>
            </div>
          ) : step === 1 ? (
            <div className="auth-card-body step-in">
              {roleObj && <p className="sub-post-meta"><span>{roleObj.label}</span></p>}
              <div className="group"><label htmlFor="companyName">Company name</label><input className="input" id="companyName" name="companyName" value={form.companyName} onChange={set('companyName')} onBlur={blur} placeholder="Al-Majid Global Freight" /><Err n="companyName" /></div>
              <div className="auth-grid2">
                <div className="group"><label htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" value={form.phone} onChange={set('phone')} onBlur={blur} placeholder="05XXXXXXXX" /><span className="field-hint">UAE mobile number — no landlines</span><Err n="phone" /></div>
                <div className="group"><label htmlFor="trn">TRN number</label><input className="input" id="trn" name="trnNumber" inputMode="numeric" maxLength={15} value={form.trnNumber} onChange={set('trnNumber')} onBlur={blur} placeholder="100000000000000" /><span className="field-hint">Exactly 15 digits</span><Err n="trnNumber" /></div>
              </div>
              <div className="group"><label htmlFor="license">Trade licence number</label><input className="input" id="license" name="tradeLicenseNumber" maxLength={15} value={form.tradeLicenseNumber} onChange={set('tradeLicenseNumber')} onBlur={blur} placeholder="CN-1122334" /><span className="field-hint">5&ndash;15 letters/digits/dashes, at least one digit</span><Err n="tradeLicenseNumber" /></div>
              {role === 'CARRIER' && <p className="auth-note warn">New accounts are read-only until an admin approves them; transporter verification (TRN, trade licence, insurance) happens separately before bidding — usually within a day.</p>}
              <div className="auth-actions">
                <button className="btn btn-light" type="button" onClick={() => { setStep(0); top(); }}>&#8592; Back</button>
                <button className="btn btn-red" type="button" disabled={!form.companyName} onClick={cont}>Continue &#8594;</button>
              </div>
            </div>
          ) : (
            <form className="auth-card-body step-in" onSubmit={submit}>
              <div className="auth-grid2">
                <div className="group"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" required value={form.email} onChange={set('email')} placeholder="you@company.ae" /></div>
                <div className="group"><label htmlFor="password">Password</label><PwField id="password" name="password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="new-password" minLength={8} /></div>
              </div>
              <div className="group"><label htmlFor="referral">Referral code (optional)</label><input className="input" id="referral" name="referralCode" value={form.referralCode} onChange={set('referralCode')} placeholder="CAR-EMIRATES" /></div>
              <label className="auth-check"><input type="checkbox" required checked={form.agreed} onChange={(e) => setForm({ ...form, agreed: e.target.checked })} /><span>I have read and agree to the <button type="button" className="auth-link" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowTermsModal(true)}>Terms &amp; Conditions</button></span></label>
              {showTermsModal && <TermsModal onClose={() => setShowTermsModal(false)} />}
              {error && <p className="auth-note err" role="status" style={delay(0)}>{error}</p>}
              <div className="auth-actions">
                <button className="btn btn-light" type="button" onClick={() => { setStep(1); top(); }}>&#8592; Back</button>
                <button className="btn btn-red shimmer" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account →'}</button>
              </div>
            </form>
          )}
          <div className="auth-foot">Already have an account? <Link to={PAGE.login}>Log in</Link></div>
        </div>
      </MktAuthFrame>
    </SitePage>
  );
}
