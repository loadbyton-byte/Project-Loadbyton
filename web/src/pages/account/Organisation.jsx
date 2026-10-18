// Organisation identity: the company behind the account, its verification and
// its seats. Seats are managed from Profile; this page is the read-only view
// of how the company appears across Loadbyton sites.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { usePageTitle } from '../../lib/seo.jsx';
import { Badge, Card, ErrorState, Skeleton } from '../../components/ui.jsx';

export default function Organisation() {
  usePageTitle('Organisation');
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setError('');
    Promise.all([api.ecosystemMe(), api.orgMembers().catch(() => ({ root: null, seats: [] }))])
      .then(([m, o]) => { setMe(m); setMembers(o); })
      .catch((e) => setError(e.message || 'Could not load your organisation.'));
  }
  useEffect(load, []);

  if (error) return <div className="container-page py-6"><ErrorState title="Couldn’t load your organisation" description={error} onRetry={load} /></div>;
  if (!me || !members) return <div className="container-page py-6"><Skeleton count={3} /></div>;
  const org = me.organisation;

  return (
    <div className="container-page py-6">
      <h1 className="font-display text-2xl font-bold text-ink">Organisation</h1>
      <p className="mt-1 text-sm text-ink-muted">How your company is identified across Loadbyton sites.</p>

      <Card className="mt-5 p-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-wide text-ink-muted">Company</dt><dd className="font-display text-lg font-semibold text-ink">{org.name}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-ink-muted">Verification</dt><dd><Badge color={org.verification === 'VERIFIED' ? 'success' : 'warning'}>{org.verification === 'VERIFIED' ? 'Verified' : 'Not verified yet'}</Badge></dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-ink-muted">Organisation ID</dt><dd className="font-mono text-sm text-ink break-all">{org.subjectId}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-ink-muted">Your role</dt><dd className="text-ink capitalize">{me.orgRole}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-ink-muted">Other Loadbyton sites recognise your company by this ID. Your freight jobs, bids and documents stay on loadbyton.com.</p>
      </Card>

      <Card className="mt-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">People</h2>
          <Link className="text-sm text-brand-secondary underline" to="/profile">Manage seats</Link>
        </div>
        <ul className="mt-3 divide-y text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
          {members.root && <li className="flex justify-between py-2"><span className="text-ink">{members.root.displayName || members.root.email}</span><span className="text-ink-muted">Owner</span></li>}
          {members.seats.map((s) => (
            <li key={s.id} className="flex justify-between py-2">
              <span className="text-ink">{s.display_name || s.email}</span>
              <span className="text-ink-muted">{String(s.seat_role || 'member').toLowerCase()}{s.is_active ? '' : ' · inactive'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
