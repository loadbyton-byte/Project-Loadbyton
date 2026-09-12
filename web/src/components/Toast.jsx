import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { IconShield, IconTruck, IconClock, IconCheck, IconAlert, IconInfo } from './icons.jsx';
import { useAuth } from '../lib/auth.jsx';
import { getSocket } from '../lib/socket.js';

// Toast type → icon + semantic color token. Colors are drawn from the
// existing design-token palette (never a one-off hex) so toasts stay
// consistent with badges/status pills elsewhere in the app.
export const toastTypes = {
  award: { icon: IconShield, color: 'var(--brand-accent)' },
  bid_received: { icon: IconTruck, color: 'var(--status-info)' },
  status_change: { icon: IconClock, color: 'var(--status-success)' },
  payout_released: { icon: IconCheck, color: 'var(--status-success)' },
  dispute_opened: { icon: IconAlert, color: 'var(--status-danger)' },
  dispute_resolved: { icon: IconCheck, color: 'var(--status-success)' },
  carrier_verified: { icon: IconShield, color: 'var(--status-info)' },
  system_message: { icon: IconInfo, color: 'var(--text-muted)' },
  // Server-pushed (lib/socket.js's `notification:new`, one per connected
  // user's own room) — deliberately generic rather than guessing which of
  // the specific types above an arbitrary notify() call site meant.
  // Priority (server-computed, NOTIFICATION_PRIORITY_BY_TYPE) decides the
  // color; 'normal'/'low' priority notifications never reach a toast at
  // all — see the listener below — they land in the Notification Center
  // only, per the "modals/toasts only when genuinely needed" rule.
  notification_critical: { icon: IconAlert, color: 'var(--status-danger)' },
  notification_high: { icon: IconAlert, color: 'var(--status-warning)' },
};

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

function ToastItem({ toast, onRemove }) {
  const [leaving, setLeaving] = useState(false);
  const timeout = toast.timeout || 5000;

  useEffect(() => {
    const dismissTimer = setTimeout(() => setLeaving(true), timeout);
    return () => clearTimeout(dismissTimer);
  }, [timeout]);

  useEffect(() => {
    if (!leaving) return;
    // Single owner of the exit animation: React state drives the CSS class,
    // and this is the only timer that ever calls onRemove — no competing
    // CSS-only animation racing a separate JS timeout.
    const removeTimer = setTimeout(() => onRemove(toast.id), 200);
    return () => clearTimeout(removeTimer);
  }, [leaving, onRemove, toast.id]);

  const typeConfig = toastTypes[toast.type] || toastTypes.system_message;
  const Icon = typeConfig.icon;

  return (
    <div className={cx('toast', leaving && 'toast-leaving')} role="status">
      <div className="toast-icon" style={{ color: typeConfig.color }}>
        <Icon size={20} />
      </div>
      <div className="toast-message">
        <p className="font-medium text-ink">{toast.title}</p>
        {toast.body && <p className="text-ink-muted">{toast.body}</p>}
      </div>
      <button className="toast-dismiss" onClick={() => setLeaving(true)} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const { user } = useAuth();

  const addToast = useCallback(({ type, title, body, timeout }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, title, body, timeout }]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => setToasts([]), []);

  // Live push, in addition to the client-only toasts every other addToast
  // call site above already fires locally. This is the one place that
  // connects the shared socket for a signed-in user rather than only when
  // opening a chat (features/job/ChatPopup.jsx, pages/Messages.jsx do the
  // same guarded connect — safe to call from more than one place since
  // it's a singleton and .connect() on an already-connected socket is a
  // no-op). 'normal'/'low' priority notifications are deliberately not
  // toasted here — they still land in the notifications table/center,
  // this only decides which ones interrupt with a toast.
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    function onNotification(n) {
      if (n.priority !== 'critical' && n.priority !== 'high') return;
      addToast({
        type: n.priority === 'critical' ? 'notification_critical' : 'notification_high',
        title: n.title,
        body: n.body,
      });
    }
    socket.on('notification:new', onNotification);
    return () => socket.off('notification:new', onNotification);
  }, [user, addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearToasts }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}
