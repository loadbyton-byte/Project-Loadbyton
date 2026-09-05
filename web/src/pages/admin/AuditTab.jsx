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


function AuditTab() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  function load() {
    setError('');
    api.adminAudit().then((d) => setEntries(d.entries)).catch((err) => { setEntries([]); setError(err.message); });
  }
  useEffect(load, []);
  if (!entries) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (error) return <ErrorState title="Couldn't load the audit log" description={error} onRetry={load} />;
  return (
    <Card className="overflow-hidden">
      <div className="max-h-[600px] overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Details</th>
              <th className="px-5 py-3 font-medium">Transition</th>
              <th className="px-5 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-5 py-3"><Badge>{e.action}</Badge></td>
                <td className="px-5 py-3 text-ink-secondary">{e.details}</td>
                <td className="px-5 py-3 font-mono text-xs text-ink-muted">{e.before_state && e.after_state ? `${e.before_state} → ${e.after_state}` : '—'}</td>
                <td className="px-5 py-3 text-ink-muted">{formatDateTime(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-5 py-3 text-xs text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
        <IconCheck size={12} className="mr-1 inline" /> Append-only — the database rejects any UPDATE or DELETE on this table.
      </p>
    </Card>
  );
}

export default AuditTab;
