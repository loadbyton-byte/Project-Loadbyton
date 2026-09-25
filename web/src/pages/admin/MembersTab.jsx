import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth, roleHome } from '../../lib/auth.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { Button, Card, Input, Badge, Select, EmptyState, ErrorState } from '../../components/ui.jsx';
import { IconUser } from '../../components/icons.jsx';

// Admin-set per-account commission override (award.service.js resolves
// carrier override > shipper override > the global settings.commission_rate_bps
// — see that file). Doesn't apply to ADMIN rows, which never bid or ship.
function CommissionCell({ user, onSaved }) {
  const { addToast } = useToasts();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.profile?.commission_rate_bps != null ? String(user.profile.commission_rate_bps / 100) : '');
  const [busy, setBusy] = useState(false);

  if (user.role === 'ADMIN') return <span className="text-xs text-ink-muted">—</span>;

  async function save(rateBps) {
    setBusy(true);
    try {
      await api.adminSetCommission(user.id, rateBps);
      addToast({ type: 'status_change', title: rateBps === null ? 'Commission override cleared' : 'Commission override set' });
      setEditing(false);
      onSaved();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not update commission', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-2">
        {user.profile?.commission_rate_bps != null ? (
          <Badge color="accent">{(user.profile.commission_rate_bps / 100).toFixed(2)}%</Badge>
        ) : (
          <span className="text-xs text-ink-muted">Default</span>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Input
        type="number"
        min="0"
        max="100"
        step="0.01"
        placeholder="%"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20"
      />
      <Button size="sm" loading={busy} onClick={() => save(value === '' ? null : Math.round(Number(value) * 100))}>Save</Button>
      {user.profile?.commission_rate_bps != null && (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => save(null)}>Clear</Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  );
}

function MembersTab() {
  const { refresh } = useAuth();
  const { addToast } = useToasts();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState('');
  const [filters, setFilters] = useState({ role: 'all', verified: 'all', search: '' });
  const [impersonatingId, setImpersonatingId] = useState(null);

  function load() {
    setUsersError('');
    api.adminUsers().then((d) => setUsers(d.users)).catch((err) => { setUsers([]); setUsersError(err.message); });
  }
  useEffect(load, []);

  const filteredUsers = users?.filter((u) => {
    const roleMatch = filters.role === 'all' || u.role === filters.role;
    const verifiedMatch = filters.verified === 'all' || u.is_verified === (filters.verified === 'yes');
    const searchMatch = !filters.search || (u.email && u.email.toLowerCase().includes(filters.search.toLowerCase()));
    return roleMatch && verifiedMatch && searchMatch;
  });

  const roleOptions = ['all', 'SHIPPER', 'CARRIER', 'ADMIN'];

  async function impersonate(u) {
    if (!window.confirm(`Impersonate ${u.profile?.company_name || u.email}? This is logged to the audit trail and expires in 30 minutes.`)) return;
    setImpersonatingId(u.id);
    try {
      const d = await api.adminImpersonate(u.id);
      await refresh();
      navigate(roleHome(d.user.role));
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not impersonate', body: err.message });
    } finally {
      setImpersonatingId(null);
    }
  }

  return (
    <div>
      <Card className="p-5">
        <p className="font-display text-base font-semibold text-ink">Members</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
            {roleOptions.map((r) => <option key={r} value={r}>{r === 'all' ? 'Role: All' : r}</option>)}
          </Select>
          <Select value={filters.verified} onChange={(e) => setFilters({ ...filters, verified: e.target.value })}>
            <option value="all">Verified: All</option>
            <option value="yes">Verified: Yes</option>
            <option value="no">Verified: No</option>
          </Select>
          <Input placeholder="Search by name or email" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="sm:col-span-2" />
        </div>
      </Card>

      {!filteredUsers && !usersError ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : usersError ? (
        <ErrorState className="mt-6" title="Couldn't load members" description={usersError} onRetry={load} />
      ) : filteredUsers.length === 0 ? (
        <EmptyState icon={<IconUser size={26} />} title="No members found" description="Try adjusting the filters above." />
      ) : (
        <div className="mt-6 overflow-x-auto scroll-fade-x">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Verified</th>
                <th className="px-5 py-3 font-medium">Tier</th>
                <th className="px-5 py-3 font-medium">Completed jobs</th>
                <th className="px-5 py-3 text-right font-medium">Commission</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-raised" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-5 py-3">{u.profile?.company_name || u.email}</td>
                  <td className="px-5 py-3 text-ink-secondary">{u.email}</td>
                  <td className="px-5 py-3">
                    <Badge color={u.role === 'CARRIER' ? 'accent' : u.role === 'SHIPPER' ? 'neutral' : 'danger'}>{u.role}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={u.is_verified ? 'success' : 'danger'}>{u.is_verified ? 'Yes' : 'No'}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-secondary">{u.tier || '—'}</td>
                  <td className="px-5 py-3 text-ink-secondary">{u.profile?.completed_jobs || 0}</td>
                  <td className="px-5 py-3"><CommissionCell user={u} onSaved={load} /></td>
                  <td className="px-5 py-3 text-right">
                    {u.role === 'ADMIN' ? (
                      <span className="text-xs text-ink-muted">—</span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => impersonate(u)} loading={impersonatingId === u.id}>Impersonate</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MembersTab;
