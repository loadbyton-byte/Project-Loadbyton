import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth, roleHome } from '../../lib/auth.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { usePageTitle } from '../../lib/seo.jsx';
import { formatAED, formatDate, formatDateTime, formatLabel } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Label, Badge, Select, EmptyState, ErrorState, Pagination } from '../../components/ui.jsx';
import { IconShield, IconAlert, IconCheck, IconInfo, IconUser, IconFile, IconWallet } from '../../components/icons.jsx';

const TABS = ['Health', 'Verification', 'Account approvals', 'Members', 'Disputes', 'Registrations', 'Payout SLA', 'Audit log', 'Revenue', 'Settings'];


function SettingsTab() {
  const { addToast } = useToasts();
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);

  function load() {
    setLoadError('');
    api.adminGetSettings().then((d) => setSettings(d.settings)).catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      const d = await api.adminUpdateSettings(settings);
      setSettings(d.settings);
      setSaved(true);
    } catch (err) {
      // F16, fixed independently on both branches: an out-of-range value
      // (e.g. commission_rate_bps > 10000) used to 400 with zero on-screen
      // feedback.
      addToast({ type: 'system_message', title: 'Could not save settings', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function forceSweep() {
    setSweeping(true);
    try {
      const d = await api.runAutoRelease();
      setSweepResult(d.message);
    } catch (err) {
      addToast({ type: 'system_message', title: 'Sweep failed', body: err.message });
    } finally {
      setSweeping(false);
    }
  }

  if (loadError) return <ErrorState title="Couldn't load settings" description={loadError} onRetry={load} />;
  if (!settings) return <p className="text-sm text-ink-muted">Loading…</p>;
  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <form onSubmit={save}>
          <Card.Header><Card.Title>Platform settings</Card.Title></Card.Header>
          <Card.Content className="space-y-4">
            <div>
              <Label>Commission rate (basis points, 6% = 600)</Label>
              <Input type="number" min="0" max="10000" value={settings.commission_rate_bps} onChange={(e) => setSettings({ ...settings, commission_rate_bps: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Auto-release window (hours)</Label>
              <Input type="number" min="1" max="168" value={settings.auto_release_hours} onChange={(e) => setSettings({ ...settings, auto_release_hours: Number(e.target.value) })} />
            </div>
          </Card.Content>
          <Card.Footer>
            {saved && <span className="mr-auto text-sm text-status-success">Saved — takes effect on the next award.</span>}
            <Button type="submit" loading={busy}>Save settings</Button>
          </Card.Footer>
        </form>
      </Card>

      <Card className="p-5">
        <p className="font-display text-base font-semibold text-ink">Force auto-release sweep</p>
        <p className="mt-1 text-sm text-ink-muted">Runs immediately instead of waiting for the 10-minute in-process interval.</p>
        <Button className="mt-3" variant="secondary" onClick={forceSweep} loading={sweeping}>Run sweep now</Button>
        {sweepResult && <p className="mt-2 text-sm text-ink-secondary">{sweepResult}</p>}
      </Card>
    </div>
  );
}

export default SettingsTab;
