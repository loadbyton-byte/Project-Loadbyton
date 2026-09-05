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


function RevenueTab() {
  const [revenue, setRevenue] = useState(null);
  const [error, setError] = useState('');
  function load() {
    setError('');
    api.adminRevenue().then((d) => setRevenue(d.revenue)).catch((err) => setError(err.message));
  }
  useEffect(load, []);
  if (error) return <ErrorState title="Couldn't load revenue" description={error} onRetry={load} />;
  if (!revenue) return <p className="text-sm text-ink-muted">Loading…</p>;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="GMV" value={formatAED(revenue.gmvAED)} />
      <Stat label="Platform fees" value={formatAED(revenue.platformFeesAED)} tone="accent" />
      <Stat label="Escrow held" value={formatAED(revenue.escrowHeldAED)} />
      <Stat label="Avg take rate" value={revenue.avgTakeRate} />
    </div>
  );
}

export default RevenueTab;
