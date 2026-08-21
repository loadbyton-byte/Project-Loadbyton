import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth, roleHome } from '../../lib/auth.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { usePageTitle } from '../../lib/seo.jsx';
import { formatAED, formatDate, formatDateTime, formatLabel } from '../../lib/constants.js';
import { Button, Card, Stat, Input, Label, Badge, Select, EmptyState, Pagination } from '../../components/ui.jsx';
import { IconShield, IconAlert, IconCheck, IconInfo, IconUser, IconFile, IconWallet } from '../../components/icons.jsx';

const TABS = ['Health', 'Verification', 'Account approvals', 'Members', 'Disputes', 'Registrations', 'Payout SLA', 'Audit log', 'Revenue', 'Settings'];


function VerificationTab() {
  const { addToast } = useToasts();
  const [queue, setQueue] = useState(null);
  const [ibanDrafts, setIbanDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function load() {
    api.adminVerificationQueue().then((d) => { setQueue(d.queue); setSelected(new Set()); }).catch(() => setQueue([]));
  }
  useEffect(load, []);

  async function act(id, action) {
    setBusyId(id);
    try {
      await api.adminVerify(id, { action, iban: ibanDrafts[id] || undefined });
      load();
    } catch (err) {
      // F16, fixed independently on both branches: no catch meant e.g. a
      // missing-IBAN 400 on approve did nothing visible.
      addToast({ type: 'system_message', title: 'Could not update verification', body: err.message });
    } finally {
      setBusyId(null);
    }
  }

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Bulk approve only succeeds for a carrier that already has an IBAN on
  // file (see server's verifyCarrier) — there's no per-carrier IBAN input
  // in bulk mode. Rejects that fail are reported inline rather than silently.
  async function bulkAct(action) {
    setBulkBusy(true);
    try {
      const ids = [...selected];
      const d = await api.adminVerifyBulk(ids, action);
      if (d.failed > 0) {
        const failedIds = d.results.filter((r) => !r.ok).map((r) => `#${r.id}`).join(', ');
        addToast({ type: 'system_message', title: `${d.succeeded} of ${ids.length} ${action}d`, body: `Failed: ${failedIds} — likely missing IBAN, approve those individually.` });
      } else {
        addToast({ type: 'status_change', title: `${d.succeeded} carrier(s) ${action}d` });
      }
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Bulk action failed', body: err.message });
    } finally {
      setBulkBusy(false);
    }
  }

  if (!queue) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (queue.length === 0) return <EmptyState icon={<IconShield size={26} />} title="Queue is empty" description="No carriers are waiting on verification right now." />

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5" style={{ borderColor: 'var(--border-default)' }}>
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={selected.size === queue.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(queue.map((c) => c.id)) : new Set())}
          />
          {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={selected.size === 0} loading={bulkBusy} onClick={() => bulkAct('approve')}>Approve selected</Button>
          <Button size="sm" variant="danger" disabled={selected.size === 0} loading={bulkBusy} onClick={() => bulkAct('reject')}>Reject selected</Button>
        </div>
      </div>

      <div className="space-y-4">
        {queue.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1.5" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <div>
                  <p className="font-display text-base font-semibold text-ink">{c.profile.company_name}</p>
                  <p className="text-sm text-ink-muted">{c.email} · applied {formatDateTime(c.created_at)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <div><dt className="text-ink-muted">TRN</dt><dd className="text-ink">{c.profile.trn_number || '—'}</dd></div>
                    <div><dt className="text-ink-muted">Trade licence</dt><dd className="text-ink">{c.profile.trade_license_number || '—'}</dd></div>
                    <div><dt className="text-ink-muted">Fleet</dt><dd className="text-ink">{c.profile.fleet_size} ({c.profile.owned_chassis} owned)</dd></div>
                    <div><dt className="text-ink-muted">Insurance</dt><dd className="text-ink">{c.profile.insurance_uploaded ? 'Uploaded' : 'Missing'}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:min-w-[260px]">
                <Input placeholder="IBAN (required to approve)" value={ibanDrafts[c.id] || ''} onChange={(e) => setIbanDrafts({ ...ibanDrafts, [c.id]: e.target.value })} />
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => act(c.id, 'approve')} loading={busyId === c.id}>Approve</Button>
                  <Button className="flex-1" variant="danger" onClick={() => act(c.id, 'reject')} loading={busyId === c.id}>Reject</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default VerificationTab;
