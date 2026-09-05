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
