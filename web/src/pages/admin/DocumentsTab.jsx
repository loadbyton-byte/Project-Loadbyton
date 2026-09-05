import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { profileDocumentUrl, driverDocumentUrl } from '../../lib/upload.js';
import { Card, Badge, Input, Select, EmptyState, ErrorState, StatusBadge } from '../../components/ui.jsx';
import { IconFile, IconUser, IconCheckCircle } from '../../components/icons.jsx';

// Read-only browsing of what companies have on file — the actual files are
// served by the same owner/admin-gated endpoints the companies themselves
// use (documents.routes.js, fleet.routes.js, job-extras.routes.js), not a
// parallel admin-only file path.
function DocumentsTab() {
  const [companies, setCompanies] = useState(null);
  const [companiesError, setCompaniesError] = useState('');
  const [filters, setFilters] = useState({ role: 'all', search: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  function loadCompanies() {
    setCompaniesError('');
    api.adminDocumentCompanies().then((d) => setCompanies(d.companies)).catch((err) => { setCompanies([]); setCompaniesError(err.message); });
  }
  useEffect(loadCompanies, []);

  const [detailError, setDetailError] = useState('');
  function loadDetail() {
    if (!selectedId) { setDetail(null); return; }
    setDetail(undefined);
    setDetailError('');
    api.adminDocumentCompany(selectedId).then(setDetail).catch((err) => setDetailError(err.message));
  }
  useEffect(loadDetail, [selectedId]);

  const filtered = companies?.filter((c) => {
    const roleMatch = filters.role === 'all' || c.role === filters.role;
    const searchMatch = !filters.search || (c.companyName || '').toLowerCase().includes(filters.search.toLowerCase());
    return roleMatch && searchMatch;
  });

  return (
    <div>
      <Card className="p-5">
        <p className="font-display text-base font-semibold text-ink">Company documents</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
            <option value="all">Role: All</option>
            <option value="SHIPPER">Shipper</option>
            <option value="CARRIER">Carrier</option>
          </Select>
          <Input placeholder="Search by company name" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="sm:col-span-2" />
        </div>
      </Card>

      {!filtered && !companiesError ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : companiesError ? (
        <ErrorState className="mt-6" title="Couldn't load companies" description={companiesError} onRetry={loadCompanies} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconUser size={26} />} title="No companies found" description="Try adjusting the filters above." />
      ) : (
        <div className="mt-6 overflow-x-auto scroll-fade-x">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Trade licence</th>
                <th className="px-5 py-3 font-medium">Insurance</th>
                <th className="px-5 py-3 font-medium">Verified</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="cursor-pointer border-b last:border-0 hover:bg-raised"
                  style={selectedId === c.id ? { background: 'var(--surface-container-high)' } : { borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-5 py-3">{c.companyName || '—'}</td>
                  <td className="px-5 py-3"><Badge color={c.role === 'CARRIER' ? 'accent' : 'neutral'}>{c.role}</Badge></td>
                  <td className="px-5 py-3"><Badge color={c.tradeLicenseDocPresent ? 'success' : 'danger'} dot={false}>{c.tradeLicenseDocPresent ? 'On file' : 'Missing'}</Badge></td>
                  <td className="px-5 py-3"><Badge color={c.insuranceDocPresent ? 'success' : 'danger'} dot={false}>{c.insuranceDocPresent ? 'On file' : 'Missing'}</Badge></td>
                  <td className="px-5 py-3"><Badge color={c.verified ? 'success' : 'danger'} dot={false}>{c.verified ? 'Yes' : 'No'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <Card className="mt-6 p-5">
          {detailError ? (
            <ErrorState title="Couldn't load this company's documents" description={detailError} onRetry={loadDetail} />
          ) : !detail ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : (
            <>
              <p className="font-display text-base font-semibold text-ink">{detail.company.companyName}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {detail.company.tradeLicenseDocPresent && (
                  <a href={profileDocumentUrl('TRADE_LICENSE', detail.company.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-medium text-brand-secondary hover:underline">
                    <IconFile size={14} /> View trade licence
                  </a>
                )}
                {detail.company.insuranceDocPresent && (
                  <a href={profileDocumentUrl('INSURANCE', detail.company.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-medium text-brand-secondary hover:underline">
                    <IconFile size={14} /> View insurance
                  </a>
                )}
                {!detail.company.tradeLicenseDocPresent && !detail.company.insuranceDocPresent && (
                  <p className="text-sm text-ink-muted">No registration documents on file.</p>
                )}
              </div>

              {detail.company.role === 'CARRIER' && (
                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Drivers</p>
                  {detail.drivers.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">No drivers in roster.</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2">
                      {detail.drivers.map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-container-low)' }}>
                          <span>{d.name} <span className="text-ink-muted">· {d.phone}</span></span>
                          <div className="flex items-center gap-2">
                            {d.licenseDocPresent && <a href={driverDocumentUrl(d.id, 'license')} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-secondary hover:underline">Licence</a>}
                            {d.vehicleDocPresent && <a href={driverDocumentUrl(d.id, 'vehicle')} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-secondary hover:underline">Vehicle</a>}
                            {!d.licenseDocPresent && !d.vehicleDocPresent && <span className="text-xs text-ink-muted">No documents</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Jobs with documents</p>
                {detail.jobs.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">No job documents on file.</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.jobs.map((j) => (
                      <Link key={j.id} to={`/jobs/${j.id}`} className="flex items-center justify-between rounded-lg p-2.5 text-sm transition hover:bg-surface-container" style={{ background: 'var(--surface-container-low)' }}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-ink-muted">{j.jobCode}</span>
                          <StatusBadge status={j.status} />
                        </span>
                        <span className="flex items-center gap-1 text-xs text-ink-muted"><IconCheckCircle size={12} /> {j.docCount} doc{j.docCount === 1 ? '' : 's'}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

export default DocumentsTab;
