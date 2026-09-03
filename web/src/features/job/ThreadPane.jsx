import { ChatBubble } from '../../components/ui.jsx';

// Shared between ChatPopup.jsx (per-job floating widget) and
// pages/Messages.jsx (the cross-job inbox) — one rendering of "a thread's
// messages" and "the composer that sends into it", so the two surfaces
// can't drift into inconsistent bubble/empty-state/placeholder behavior.
export const ROLE_LABELS = { SHIPPER: 'Shipper', CARRIER: 'Carrier', ADMIN: 'Admin', DRIVER: 'Driver' };

export function ThreadMessageList({ listRef, loaded, activeRole, messages, myId, className = 'flex-1 space-y-3 overflow-y-auto p-4' }) {
  return (
    <div ref={listRef} className={className} role="log" aria-live="polite">
      {!loaded ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !activeRole ? (
        <p className="text-sm text-ink-muted">No one to message here yet.</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-ink-muted">No messages with {ROLE_LABELS[activeRole] || activeRole} yet — say hello.</p>
      ) : (
        messages.map((m) => <ChatBubble key={m.id} body={m.content} mine={m.sender_id === myId} />)
      )}
    </div>
  );
}
