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


function RegistrationsTab() {
  const [referrals, setReferrals] = useState(null);

  function load() {
    api.adminReferrals().then((d) => setReferrals(d.referrals)).catch(() => setReferrals([]));
  }
  useEffect(load, []);

  return (
    <div>
      <Card className="p-5">
        <p className="font-display text-base font-semibold text-ink">Referrals</p>
        <p className="mt-2 text-sm text-ink-muted">New sign-ups via referral code. Credited once the referred account completes its first job.</p>
      </Card>

      {!referrals ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : referrals.length === 0 ? (
        <EmptyState icon={<IconInfo size={26} />} title="No referrals yet" description="Sign-ups that used a referral code will show up here." />
      ) : (
        <div className="mt-6 overflow-x-auto scroll-fade-x">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                <th className="px-5 py-3 font-medium">Referral code</th>
                <th className="px-5 py-3 font-medium">Referrer</th>
                <th className="px-5 py-3 font-medium">Referred account</th>
                <th className="px-5 py-3 font-medium">Signed up</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.referredUserId} className="border-b last:border-0 hover:bg-raised" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-5 py-3 font-mono text-xs">{r.referralCode}</td>
                  <td className="px-5 py-3">{r.referrerCompany || r.referrerEmail}</td>
                  <td className="px-5 py-3 text-ink-secondary">{r.referredEmail}</td>
                  <td className="px-5 py-3 text-ink-muted">{formatDate(r.referredAt)}</td>
                  <td className="px-5 py-3">
                    <Badge color={r.status === 'CREDITED' ? 'success' : 'warning'}>{r.status === 'CREDITED' ? 'AED 50 credited' : 'Pending first job'}</Badge>
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

export default RegistrationsTab;
