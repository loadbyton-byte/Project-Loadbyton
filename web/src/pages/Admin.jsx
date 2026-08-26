import React, { useState, lazy, Suspense } from 'react';
import { usePageTitle } from '../lib/seo.jsx';
import { Spinner } from '../components/ui.jsx';

const HealthTab = lazy(() => import('./admin/HealthTab.jsx'));
const LiveActivityTab = lazy(() => import('./admin/LiveActivityTab.jsx'));
const VerificationTab = lazy(() => import('./admin/VerificationTab.jsx'));
const AccountApprovalsTab = lazy(() => import('./admin/AccountApprovalsTab.jsx'));
const MembersTab = lazy(() => import('./admin/MembersTab.jsx'));
const DisputesTab = lazy(() => import('./admin/DisputesTab.jsx'));
const RegistrationsTab = lazy(() => import('./admin/RegistrationsTab.jsx'));
const PayoutsSlaTab = lazy(() => import('./admin/PayoutsSlaTab.jsx'));
const AuditTab = lazy(() => import('./admin/AuditTab.jsx'));
const RevenueTab = lazy(() => import('./admin/RevenueTab.jsx'));
const SettingsTab = lazy(() => import('./admin/SettingsTab.jsx'));

const TABS = ['Health', 'Live activity', 'Verification', 'Account approvals', 'Members', 'Disputes', 'Registrations', 'Payout SLA', 'Audit log', 'Revenue', 'Settings'];
const TAB_COMPONENTS = {
  Health: HealthTab,
  'Live activity': LiveActivityTab,
  Verification: VerificationTab,
  'Account approvals': AccountApprovalsTab,
  Members: MembersTab,
  Disputes: DisputesTab,
  Registrations: RegistrationsTab,
  'Payout SLA': PayoutsSlaTab,
  'Audit log': AuditTab,
  Revenue: RevenueTab,
  Settings: SettingsTab,
};

export default function Admin() {
  usePageTitle('Admin console');
  const [tab, setTab] = useState('Health');
  const Active = TAB_COMPONENTS[tab];
  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Admin console</h1>
      <p className="mt-1 text-sm text-ink-muted">Verification, escrow oversight, disputes, and the audit trail.</p>
      <div className="mt-6 flex gap-1 overflow-x-auto scroll-fade-x border-b" style={{ borderColor: 'var(--border-default)' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className="shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors" style={tab === t ? { borderColor: 'var(--brand-accent)', color: 'var(--text-primary)' } : { borderColor: 'transparent', color: 'var(--text-muted)' }}>
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        <Suspense fallback={<div className="flex justify-center py-12"><Spinner /></div>}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}
