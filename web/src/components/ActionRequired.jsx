import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

// Product-elevation plan, Phase 3 — brief §15/§16: "what needs my
// attention" leads the dashboard, above even the KPI tiles, not buried
// under them. Sourced from the same notifications the bell/toast/center
// already show (Phase 1's priority column), filtered to unread
// critical/high — exactly what Notifications.jsx's own "Action Required"
// tab shows, surfaced here too since a user shouldn't have to go looking
// for it. Shared across every role's landing page (Dashboard.jsx,
// OpenLoads.jsx) rather than duplicated per page — it has no dependency
// on either page's own state, purely notification-driven.
export default function ActionRequired() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.notifications().then((d) => setItems(d.notifications)).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    function onNew(n) {
      setItems((prev) => (prev ? [n, ...prev.filter((x) => x.id !== n.id)] : prev));
    }
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, []);

  const actionItems = (items || []).filter((n) => !n.is_read && (n.priority === 'critical' || n.priority === 'high'));
  if (actionItems.length === 0) return null;

  return (
    <section className="mt-4">
      <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Action required</p>
      <div className="flex flex-col gap-2">
        {actionItems.map((n) => (
          <Link
            key={n.id}
            to={n.job_id ? `/jobs/${n.job_id}` : '/notifications'}
            className="card flex items-center justify-between gap-3 border-s-4 p-4 transition-colors hover:bg-surface-container"
            style={{ borderInlineStartColor: 'var(--status-danger)' }}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{n.title}</p>
              {n.body && <p className="mt-0.5 truncate text-sm text-ink-muted">{n.body}</p>}
            </div>
            <span className="shrink-0 text-sm font-semibold" style={{ color: 'var(--brand-accent-on-tint)' }}>Review →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
