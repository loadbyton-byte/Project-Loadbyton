import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { formatAED, formatDate } from '../lib/constants.js';
import { Card, Input, EmptyState, ErrorState } from '../components/ui.jsx';
import { IconReceipt } from '../components/icons.jsx';

// Dedicated invoice history/search — Earnings.jsx keeps its existing
// lightweight per-payout link; this is the full list GET /api/invoices
// never had a page of its own for. No new backend endpoint: the API
// already returns everything, filtering below is client-side over that.
export default function Invoices() {
  usePageTitle('Invoices');
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ search: '', from: '', to: '' });

  function load() {
    setError('');
    api.invoices().then((d) => setInvoices(d.invoices)).catch((err) => { setInvoices([]); setError(err.message); });
  }
  useEffect(load, []);

  const filtered = invoices?.filter((inv) => {
    const searchMatch = !filters.search
      || inv.job_code.toLowerCase().includes(filters.search.toLowerCase())
      || inv.invoice_number.toLowerCase().includes(filters.search.toLowerCase());
    const fromMatch = !filters.from || inv.issued_at >= filters.from;
    const toMatch = !filters.to || inv.issued_at <= `${filters.to}T23:59:59`;
    return searchMatch && fromMatch && toMatch;
  });
  const total = filtered?.reduce((s, inv) => s + inv.total_aed, 0) || 0;

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Invoices</h1>
      <p className="mt-1 text-sm text-ink-muted">Every invoice issued on your completed jobs.</p>

      <Card className="mt-5 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input placeholder="Search job code or invoice #" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="sm:col-span-1" />
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} aria-label="From date" />
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} aria-label="To date" />
        </div>
      </Card>

      {!filtered && !error ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <ErrorState className="mt-6" title="Couldn't load invoices" description={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconReceipt size={26} />} title="No invoices found" description="Invoices are issued automatically when a job's payout is released." />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto scroll-fade-x">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-5 py-3 font-medium">Invoice #</th>
                  <th className="px-5 py-3 font-medium">Job</th>
                  <th className="px-5 py-3 font-medium">Issued</th>
                  <th className="px-5 py-3 font-medium">Gross</th>
                  <th className="px-5 py-3 font-medium">VAT</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-raised" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-5 py-3 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-muted">{inv.job_code}</td>
                    <td className="px-5 py-3 text-ink-secondary">{formatDate(inv.issued_at)}</td>
                    <td className="px-5 py-3 font-mono">{formatAED(inv.gross_aed)}</td>
                    <td className="px-5 py-3 font-mono text-ink-muted">{formatAED(inv.vat_aed)}</td>
                    <td className="px-5 py-3 font-mono font-semibold">{formatAED(inv.total_aed)}</td>
                    <td className="px-5 py-3 text-right">
                      <a href={`/api/invoices/${inv.id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-secondary hover:underline">
                        View / print
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm text-ink-muted">{filtered.length} invoice{filtered.length === 1 ? '' : 's'} · total {formatAED(total)}</p>
        </>
      )}
    </div>
  );
}
