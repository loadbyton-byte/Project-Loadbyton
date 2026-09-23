// Redesigned Login page — visual design ported from the design-tool
// export's pages/Auth.jsx (LoginPage), wired to the real account service.
// The export's own submit handler was a non-functional preview stub
// (`setMsg("This preview isn't connected...")`) — this uses the same
// login/redirect/error-handling logic the previous Login.jsx had
// (useAuth().login, ApiError-driven MFA prompt, redirect-after-login).
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { ApiError } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { SitePage, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';
import { MktAuthFrame, PwField } from '../components/marketing/AuthKit.jsx';

export default function Login() {
  usePageTitle('Log in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', totpCode: '' });
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user, actingAs } = await login({ email: form.email, password: form.password, totpCode: form.totpCode || undefined });
      // A driver seat always lands on its own minimal view, ignoring any
      // deep link it was bounced here from — RequireAuth (App.jsx) would
      // send it there anyway, this just skips the extra redirect.
      const dest = actingAs?.seatRole === 'DRIVER' ? '/driver' : (location.state?.from?.pathname || homePath(user, actingAs));
      navigate(dest, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && /authentication code/i.test(err.message)) setNeedsMfa(true);
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SitePage>
      <MktAuthFrame photo={PHOTOS.port} kicker="OPERATIONS LOGIN" title="Return to the operating record." body="Your loads, bids, drivers, documents and delivery state remain connected in one freight workspace.">
        <div className="auth-card mkt-reveal">
          <div className="auth-card-head"><h2>Log in to <img src="/brand/logo-full.svg" alt="Loadbyton" /></h2><p>Post loads, bid on freight, or run the ops console.</p></div>
          <form className="auth-card-body" onSubmit={submit}>
            <div className="group"><label htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.ae" /></div>
            <div className="group">
              <div className="auth-row"><label htmlFor="password">Password</label><Link className="auth-link" to="/forgot-password">Forgot password?</Link></div>
              <PwField id="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" autoComplete="current-password" />
            </div>
            {needsMfa && (
              <div className="group">
                <label htmlFor="totp">6-digit authentication code</label>
                <input className="input" id="totp" name="totpCode" inputMode="numeric" maxLength={6} value={form.totpCode} onChange={(e) => setForm({ ...form, totpCode: e.target.value })} placeholder="123456" />
              </div>
            )}
            {error && <p className="auth-note err" role="status">{error}</p>}
            <button className="btn btn-red shimmer" type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Log in →'}</button>
          </form>
          <div className="auth-foot">New to Loadbyton? <Link to={PAGE.register}>Create an account</Link></div>
        </div>
      </MktAuthFrame>
    </SitePage>
  );
}
