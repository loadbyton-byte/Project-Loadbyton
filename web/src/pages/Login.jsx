import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { ApiError } from '../lib/api.js';
import { Button, Input, Label, Card } from '../components/ui.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import AuthFrame from '../components/AuthFrame.jsx';
import BrandWordmark from '../components/BrandWordmark.jsx';

export default function Login() {
  usePageTitle('Log in');
  const { login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', totpCode: '' });
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user, actingAs } = await login({ email: form.email, password: form.password, totpCode: form.totpCode || undefined });
      // A driver seat always lands on its own minimal view, ignoring any
      // deep link it was bounced here from — RequireAuth would send it
      // there anyway, this just skips the extra redirect.
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
    <AuthFrame title="Return to the operating record." body="Your loads, bids, drivers, documents and delivery state remain connected in one freight workspace.">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold text-ink">
          <span>Log in to</span><BrandWordmark className="h-6 w-auto" />
        </div>
        <p className="mt-1 text-sm text-ink-muted">Post loads, bid on freight, or run the ops console.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.ae" />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Link to="/forgot-password" className="mb-1.5 text-xs font-medium text-brand-secondary hover:underline">Forgot password?</Link>
            </div>
            <div className="relative">
              <Input id="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" className="pr-16" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-brand-secondary" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          {needsMfa && (
            <div>
              <Label htmlFor="totp">6-digit authentication code</Label>
              <Input id="totp" inputMode="numeric" maxLength={6} value={form.totpCode} onChange={(e) => setForm({ ...form, totpCode: e.target.value })} placeholder="123456" />
            </div>
          )}
          {error && (
            <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={loading}>{t('auth.login')}</Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          New to Loadbyton? <Link to="/register" className="font-medium text-brand-secondary hover:underline">Create an account</Link>
        </p>
      </Card>
    </AuthFrame>
  );
}
