import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatAED } from '../../lib/constants.js';
import { Stat, ErrorState } from '../../components/ui.jsx';

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
