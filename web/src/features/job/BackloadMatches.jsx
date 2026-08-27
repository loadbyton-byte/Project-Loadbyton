import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatAED, formatLabel } from '../../lib/constants.js';
import { Card, Badge, RatingPill } from '../../components/ui.jsx';

export default function BackloadMatches({ jobId }) {
  const [matches, setMatches] = useState(null);
  useEffect(() => {
    api.backloadMatches(jobId).then((d) => setMatches(d.matches)).catch(() => setMatches([]));
  }, [jobId]);

  if (matches === null) return null;

  return (
    <div className="mb-6">
      <div className="rounded-xl border bg-white p-4">
        <h3 className="font-semibold text-ink mb-3">Backload matches</h3>
        <div className="space-y-3 text-sm">
          {matches.length === 0 ? (
            <p className="text-ink-muted">No open loads near this delivery point right now — check back as new jobs are posted.</p>
          ) : (
            matches.map((m) => (
              <Link key={m.id} to={`/jobs/${m.id}`} className="block rounded-md border px-3 py-2.5 hover:bg-raised" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink-muted">{m.job_code}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${m.matchType === 'coords' ? 'border-success bg-success-bg text-success' : 'border-neutral bg-neutral-bg text-ink'}`}>
                    {m.matchType === 'coords' ? `${m.distanceKm} km away` : 'Same emirate'}
                  </span>
                </div>
                <p className="mt-1 font-medium text-ink">{formatLabel(m.pickup_terminal)} → {formatLabel(m.delivery_area)}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-secondary">
                  {m.shipper_company} <span className="inline-flex items-center justify-center rounded-full bg-brand-bg px-1.5 py-0.5 text-[10px] font-bold text-brand">★ {m.shipper_rating?.toFixed(1) || '—'}</span> · {formatAED(m.max_budget_aed)} target
                </p>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}