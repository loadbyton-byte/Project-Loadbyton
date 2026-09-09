import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api, ApiError } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { Button, Card, Input, Label, Select, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { IconUser, IconShield, IconChevronRight } from '../components/icons.jsx';
import EquipmentCapacity from '../features/profile/EquipmentCapacity.jsx';

const SEAT_ROLE_HELP = {
  OPS: 'Full day-to-day access — post jobs, bid, award, update status.',
  FINANCE: 'View earnings, invoices, and payouts. Cannot post, bid, or award.',
  VIEWER: 'Read-only access to everything.',
};

function TeamSection() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', seatRole: 'OPS', displayName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoadError('');
    api.orgMembers().then(setData).catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function addSeat(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.addOrgMember(form);
      setForm({ email: '', password: '', seatRole: 'OPS', displayName: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(seat) {
    await api.updateOrgMember(seat.id, { isActive: !seat.is_active });
    load();
  }

  async function changeRole(seat, seatRole) {
    await api.updateOrgMember(seat.id, { seatRole });
    load();
  }

  if (loadError) return <Card className="mt-6"><Card.Content><ErrorState title="Couldn't load your team" description={loadError} onRetry={load} /></Card.Content></Card>;
  if (!data) return null;

  return (
    <Card className="mt-6">
      <Card.Header><Card.Title>Team</Card.Title></Card.Header>
      <Card.Content className="space-y-4">
        <p className="text-sm text-ink-muted">
          Give employees their own login under this company account, scoped to what they need — without sharing
          your password or your bank details.
        </p>

        {data.seats.length === 0 ? (
          <EmptyState icon={<IconUser size={24} />} title="No seats yet" description="Everyone currently shares your single login." />
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {data.seats.map((seat) => (
              <div key={seat.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{seat.display_name || seat.email}</p>
                  <p className="text-xs text-ink-muted">{seat.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={seat.is_active ? 'success' : 'neutral'}>{seat.is_active ? 'Active' : 'Deactivated'}</Badge>
                  <Select value={seat.seat_role} onChange={(e) => changeRole(seat, e.target.value)} className="w-auto">
                    {Object.keys(SEAT_ROLE_HELP).map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                  <Button size="sm" variant={seat.is_active ? 'danger' : 'secondary'} onClick={() => toggleActive(seat)}>
                    {seat.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addSeat} className="grid gap-3 border-t pt-4 sm:grid-cols-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <Label>Name</Label>
            <Input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div>
            <Label>Email</Label>
            <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label>Temporary password</Label>
            <Input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={form.seatRole} onChange={(e) => setForm({ ...form, seatRole: e.target.value })}>
              {Object.keys(SEAT_ROLE_HELP).map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <p className="sm:col-span-2 text-xs text-ink-muted">{SEAT_ROLE_HELP[form.seatRole]}</p>
          {error && <p className="sm:col-span-2 text-sm text-status-danger">{error}</p>}
          <Button type="submit" loading={busy} className="sm:col-span-2">Add team member</Button>
        </form>
      </Card.Content>
    </Card>
  );
}

export default function Profile() {
  usePageTitle('Profile & settings');
  const { user, refresh, restartWalkthrough, isOrgRoot, actingAs } = useAuth();
  const [form, setForm] = useState({
    companyName: user.profile?.company_name || '',
    phone: user.profile?.phone || '',
    trnNumber: user.profile?.trn_number || '',
    tradeLicenseNumber: user.profile?.trade_license_number || '',
    coverageZones: user.profile?.coverage_zones || '',
    fleetSize: user.profile?.fleet_size ?? '',
    ownedChassis: user.profile?.owned_chassis ?? '',
    iban: user.profile?.iban || '',
    insuranceUploaded: !!user.profile?.insurance_uploaded,
    telrSplitId: user.profile?.telr_split_id || '',
  });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [mfa, setMfa] = useState(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  // Enabling or disabling MFA is itself a requireReauth()-gated action
  // (server/routes/auth.routes.js) — same reason the IBAN field below is:
  // a stolen session cookie alone must not be enough to silently strip a
  // victim's second factor, or enroll an attacker-controlled one.
  // mfaReauthAction tracks which of the two triggered the prompt so the
  // same small form can drive either.
  const [mfaReauthAction, setMfaReauthAction] = useState(null); // null | 'setup' | 'disable'
  const [mfaReauthStep, setMfaReauthStep] = useState('password'); // 'password' | 'mfa'
  const [mfaReauthPassword, setMfaReauthPassword] = useState('');
  const [mfaReauthTotp, setMfaReauthTotp] = useState('');
  const [mfaReauthError, setMfaReauthError] = useState('');
  // Changing the payout IBAN re-authenticates — see server/middleware/auth.js's
  // requireReauth, wired up specifically (and only) for that field. reauthNeeded
  // tracks which step the confirm-password prompt is on: null (not asked),
  // 'password', or 'mfa' (password accepted, TOTP code needed too).
  const originalIban = user.profile?.iban || '';
  const [reauthNeeded, setReauthNeeded] = useState(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthTotp, setReauthTotp] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setSaveError('');
    try {
      const payload = { ...form };
      const ibanChanging = form.iban.trim() !== originalIban.trim();
      if (ibanChanging && reauthPassword) {
        payload.password = reauthPassword;
        if (reauthTotp) payload.totpCode = reauthTotp;
      }
      await api.updateProfile(payload);
      await refresh();
      setSaved(true);
      setReauthNeeded(null);
      setReauthPassword('');
      setReauthTotp('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        setReauthNeeded('password');
        setSaveError('Confirm your password to change the payout IBAN.');
      } else if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setReauthNeeded('mfa');
        setSaveError('Enter your authenticator code to confirm this change.');
      } else if (err instanceof ApiError && (err.code === 'REAUTH_FAILED' || err.code === 'MFA_FAILED')) {
        setSaveError(err.message);
      } else {
        setSaveError(err.message);
        setReauthNeeded(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function clearMfaReauth() {
    setMfaReauthAction(null);
    setMfaReauthStep('password');
    setMfaReauthPassword('');
    setMfaReauthTotp('');
    setMfaReauthError('');
  }

  async function runMfaAction(action, credentials) {
    setMfaBusy(true);
    setMfaReauthError('');
    try {
      if (action === 'setup') {
        const d = await api.mfaSetup(credentials);
        setMfa(d);
      } else {
        await api.mfaDisable(credentials);
        setMfa(null);
      }
      await refresh();
      clearMfaReauth();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        setMfaReauthAction(action);
        setMfaReauthStep('password');
        setMfaReauthError('Confirm your password to continue.');
      } else if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setMfaReauthAction(action);
        setMfaReauthStep('mfa');
        setMfaReauthError('Enter your current authenticator code to continue.');
      } else if (err instanceof ApiError && (err.code === 'REAUTH_FAILED' || err.code === 'MFA_FAILED')) {
        setMfaReauthError(err.message);
      } else {
        setMfaReauthError(err.message);
        clearMfaReauth();
      }
    } finally {
      setMfaBusy(false);
    }
  }

  function setupMfa() { runMfaAction('setup'); }
  function disableMfa() { runMfaAction('disable'); }
  function submitMfaReauth(e) {
    e.preventDefault();
    runMfaAction(mfaReauthAction, { password: mfaReauthPassword, totpCode: mfaReauthTotp || undefined });
  }

  return (
    <div className="container-page max-w-2xl py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Profile &amp; settings</h1>
      <p className="mt-1 font-mono text-xs text-ink-muted">{user.email} · {user.role} · Tier {user.tier}</p>
      {actingAs && (
        <p className="mt-1 text-xs text-ink-muted">
          Logged in as {actingAs.displayName || actingAs.email} ({actingAs.seatRole}) — company details below are shared
          across the whole team; only an OPS seat or the account owner can change them.
        </p>
      )}

      <Link to="/documents" className="card mt-5 flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <IconShield size={18} className="text-brand-accent" />
          <span className="text-sm font-semibold text-ink">Document compliance</span>
        </div>
        <IconChevronRight size={16} className="text-ink-muted" />
      </Link>

      <Link to="/account/deletion" className="card mt-5 flex items-center justify-between gap-3 p-4" style={{ borderColor: 'var(--status-warning-bg)' }}>
        <div className="flex items-center gap-3">
          <IconUser size={18} className="text-status-warning" />
          <span className="text-sm font-semibold text-ink">Account deletion & data export</span>
        </div>
        <IconChevronRight size={16} className="text-ink-muted" />
      </Link>

      <Card className="mt-5">
        <form onSubmit={save}>
          <Card.Header><Card.Title>Company profile</Card.Title></Card.Header>
          <Card.Content className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Company name</Label>
              <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>TRN number</Label>
              <Input value={form.trnNumber} onChange={(e) => setForm({ ...form, trnNumber: e.target.value })} />
            </div>
            <div>
              <Label>Trade licence number</Label>
              <Input value={form.tradeLicenseNumber} onChange={(e) => setForm({ ...form, tradeLicenseNumber: e.target.value })} />
            </div>
            {user.role === 'CARRIER' && (
              <>
                <div>
                  <Label>Coverage zones</Label>
                  <Input value={form.coverageZones} onChange={(e) => setForm({ ...form, coverageZones: e.target.value })} placeholder="JAFZA, Al Quoz, DIP" />
                </div>
                <div>
                  <Label>Fleet size</Label>
                  <Input type="number" min="0" value={form.fleetSize} onChange={(e) => setForm({ ...form, fleetSize: e.target.value })} />
                </div>
                <div>
                  <Label>Owned chassis</Label>
                  <Input type="number" min="0" value={form.ownedChassis} onChange={(e) => setForm({ ...form, ownedChassis: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Payout IBAN</Label>
                  <Input
                    value={form.iban}
                    onChange={(e) => { setForm({ ...form, iban: e.target.value }); if (reauthNeeded) { setReauthNeeded(null); setReauthPassword(''); setReauthTotp(''); } }}
                    placeholder="AE070331234567890123456"
                  />
                  <p className="mt-1 text-xs text-ink-muted">Required before an admin can approve verification. Stored encrypted.</p>
                </div>
                <div className="sm:col-span-2">
                  <Label>Telr Split ID (optional)</Label>
                  <Input
                    value={form.telrSplitId}
                    onChange={(e) => setForm({ ...form, telrSplitId: e.target.value })}
                    placeholder="Issued by Telr after their sub-merchant approval"
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    Only relevant if Loadbyton processes payments via Telr. Apply as a sub-merchant through Telr directly — once
                    approved, they'll give you a Split ID; enter it here and your share of future job payments settles to you
                    automatically instead of waiting on a manual transfer.
                  </p>
                </div>
                {form.iban.trim() !== originalIban.trim() && (
                  <div className="sm:col-span-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-raised)' }}>
                    <p className="text-xs text-ink-muted">
                      Changing your payout IBAN needs your password to confirm — this protects your payouts if your
                      session were ever compromised.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input type="password" value={reauthPassword} onChange={(e) => setReauthPassword(e.target.value)} placeholder="Current password" autoComplete="current-password" />
                      {reauthNeeded === 'mfa' && (
                        <Input value={reauthTotp} onChange={(e) => setReauthTotp(e.target.value)} placeholder="6-digit authenticator code" inputMode="numeric" maxLength={6} />
                      )}
                    </div>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm text-ink-secondary">
                    <input type="checkbox" checked={form.insuranceUploaded} onChange={(e) => setForm({ ...form, insuranceUploaded: e.target.checked })} />
                    Fleet/cargo insurance confirmed
                  </label>
                </div>
              </>
            )}
          </Card.Content>
          <Card.Footer>
            {saved && <span className="mr-auto text-sm text-status-success">Saved.</span>}
            {saveError && <span className="mr-auto text-sm text-status-danger">{saveError}</span>}
            <Button type="submit" loading={busy}>Save changes</Button>
          </Card.Footer>
        </form>
      </Card>

      {user.role === 'CARRIER' && <EquipmentCapacity />}

      <Card className="mt-6">
        <Card.Header><Card.Title>Two-factor authentication</Card.Title></Card.Header>
        <Card.Content>
          {user.mfa_enabled ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-secondary">MFA is enabled on your account.</p>
              <Button variant="danger" onClick={disableMfa} loading={mfaBusy} className="self-start shrink-0">Disable</Button>
            </div>
          ) : mfa ? (
            <div className="space-y-2 text-sm">
              <p className="text-ink-secondary">Add this secret to your authenticator app:</p>
              <p className="font-mono text-xs" style={{ background: 'var(--bg-raised)', padding: '8px 12px', borderRadius: 6 }}>{mfa.secret}</p>
              <p className="text-xs text-ink-muted break-all">{mfa.otpauthUrl}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-secondary">Add an authenticator app as a second factor on login.</p>
              <Button variant="secondary" onClick={setupMfa} loading={mfaBusy} className="self-start shrink-0">Enable MFA</Button>
            </div>
          )}
          {mfaReauthAction && (
            <form onSubmit={submitMfaReauth} className="mt-4 space-y-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-sm text-ink-secondary">
                {mfaReauthAction === 'disable' ? 'Confirm your identity to disable MFA.' : 'Confirm your identity to enable MFA.'}
              </p>
              <Input
                type="password"
                placeholder="Current password"
                value={mfaReauthPassword}
                onChange={(e) => setMfaReauthPassword(e.target.value)}
                autoFocus
              />
              {mfaReauthStep === 'mfa' && (
                <Input
                  inputMode="numeric"
                  placeholder="6-digit authenticator code"
                  value={mfaReauthTotp}
                  onChange={(e) => setMfaReauthTotp(e.target.value)}
                />
              )}
              {mfaReauthError && <p className="text-sm text-status-danger">{mfaReauthError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={mfaBusy} disabled={!mfaReauthPassword}>Confirm</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearMfaReauth}>Cancel</Button>
              </div>
            </form>
          )}
        </Card.Content>
      </Card>

      {isOrgRoot && user.role !== 'ADMIN' && <TeamSection />}

      {/* The walkthrough's copy (Shell.jsx's WALKTHROUGH_STEPS) is written
          for the shipper posting flow — for any other role "Start over"
          would silently do nothing, since Shell.jsx now only renders that
          modal for SHIPPER. */}
      {user.role === 'SHIPPER' && (
        <Card className="mt-6">
          <Card.Header><Card.Title>Walkthrough</Card.Title></Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-secondary">Replay the 3-step welcome walkthrough.</p>
              <Button variant="secondary" onClick={restartWalkthrough} className="self-start shrink-0">Start over</Button>
            </div>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}
