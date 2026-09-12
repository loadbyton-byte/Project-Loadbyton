import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatDateTime } from '../lib/constants.js';
import { Button, Card, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { IconBell } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { getSocket } from '../lib/socket.js';

const TYPE_LABELS = {
  bid: 'New bids',
  award: 'Bid accepted / rejected',
  status: 'Shipment status updates',
  payout: 'Payouts',
  dispute: 'Disputes',
  verification: 'Carrier verification',
  message: 'Messages',
};

// Center tabs (brief §21) — a coarser grouping than the mute-preference
// `type` list above. 'Action Required' is priority-driven (server-computed
// NOTIFICATION_PRIORITY_BY_TYPE, lib/constants.js), not its own `type`.
const CENTER_TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'action', label: 'Action Required', match: (n) => !n.is_read && (n.priority === 'critical' || n.priority === 'high') },
  { key: 'operations', label: 'Operations', match: (n) => ['bid', 'award', 'status'].includes(n.type) },
  { key: 'financial', label: 'Financial', match: (n) => ['payout', 'dispute'].includes(n.type) },
  { key: 'messages', label: 'Messages', match: (n) => n.type === 'message' },
  { key: 'system', label: 'System', match: (n) => ['system', 'verification'].includes(n.type) },
];

export default function Notifications() {
  usePageTitle('Notifications');
  const { isRtl } = useLocale();
  const { user, refresh } = useAuth();
  const [items, setItems] = useState(null);
  const [itemsError, setItemsError] = useState('');
  const [prefs, setPrefs] = useState(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [tab, setTab] = useState('all');
  const { addToast } = useToasts();

  function load() {
    setItemsError('');
    api.notifications().then((d) => setItems(d.notifications)).catch((err) => { setItems([]); setItemsError(err.message); });
  }
  useEffect(load, []);
  useEffect(() => {
    api.notificationPreferences().then(setPrefs).catch(() => setPrefs({ types: [], disabled: [] }));
  }, []);

  // Live updates while this page is open — lib/socket.js's shared
  // connection is already established (Toast.jsx connects it as soon as
  // a user is signed in) and already joined to this user's own
  // `user:{id}` room server-side; this just prepends what arrives rather
  // than waiting for the next full reload.
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    function onNew(n) {
      setItems((prev) => (prev ? [n, ...prev.filter((existing) => existing.id !== n.id)] : prev));
    }
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, [user]);

  async function markRead() {
    await api.markNotificationsRead();
    load();
    refresh().catch(() => {}); // updates user.unreadNotifications so the bell dot clears
  }

  async function markOneRead(id) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    try {
      await api.markNotificationRead(id);
      refresh().catch(() => {});
    } catch {
      load(); // roll back the optimistic update on failure
    }
  }

  async function toggleType(type) {
    const disabled = prefs.disabled.includes(type)
      ? prefs.disabled.filter((t) => t !== type)
      : [...prefs.disabled, type];
    setPrefs({ ...prefs, disabled });
    setPrefsBusy(true);
    try {
      await api.updateNotificationPreferences(disabled);
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not save preference', body: err.message });
      load();
    } finally {
      setPrefsBusy(false);
    }
  }

  const activeTab = CENTER_TABS.find((t) => t.key === tab) || CENTER_TABS[0];
  const visibleItems = useMemo(() => (items || []).filter(activeTab.match), [items, activeTab]);
  const actionCount = useMemo(() => (items || []).filter(CENTER_TABS[1].match).length, [items]);

  return (
    <div className="container-page py-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">Notifications</h1>
        {items && items.some((n) => !n.is_read) && <Button variant="secondary" size="sm" onClick={markRead}>Mark all read</Button>}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {CENTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${tab === t.key ? 'bg-surface-container-high text-ink' : 'text-ink-secondary hover:bg-surface-container'}`}
          >
            {t.label}
            {t.key === 'action' && actionCount > 0 && (
              <Badge color="danger" dot={false} className="ms-1.5">{actionCount}</Badge>
            )}
          </button>
        ))}
      </div>

      {prefs && prefs.types.length > 0 && (
        <Card className="mt-5">
          <Card.Content>
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">Notify me about</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {prefs.types.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={!prefs.disabled.includes(type)}
                    disabled={prefsBusy}
                    onChange={() => toggleType(type)}
                  />
                  {TYPE_LABELS[type] || type}
                </label>
              ))}
            </div>
          </Card.Content>
        </Card>
      )}

      <div className="mt-5">
        {items === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : itemsError ? (
          <ErrorState title="Couldn't load notifications" description={itemsError} onRetry={load} />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={<IconBell size={26} />}
            title={tab === 'all' ? 'No notifications' : `Nothing in ${activeTab.label}`}
            description="Bids, awards, status changes and payouts will show up here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {visibleItems.map((n) => {
              const isHighPriority = n.priority === 'critical' || n.priority === 'high';
              const body = (
                <div
                  className="card flex items-start justify-between gap-3 border-s-4 px-4 py-3.5"
                  style={{
                    background: n.is_read ? undefined : 'var(--surface-container-low)',
                    borderInlineStartColor: isHighPriority ? 'var(--status-danger)' : 'transparent',
                  }}
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="whitespace-nowrap font-mono text-[11px] text-ink-muted">{formatDateTime(n.created_at)}</p>
                    {!n.is_read && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); markOneRead(n.id); }}
                        className="text-[11px] font-medium text-ink-muted hover:text-ink"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              );
              return n.job_id ? (
                <Link key={n.id} to={`/jobs/${n.job_id}`} onClick={() => !n.is_read && markOneRead(n.id)} className="block">{body}</Link>
              ) : (
                <div key={n.id} onClick={() => !n.is_read && markOneRead(n.id)}>{body}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
