import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../../lib/socket.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Input, ChatBubble } from '../../components/ui.jsx';
import { IconMessage, IconClose } from '../../components/icons.jsx';
import { useToasts } from '../../components/Toast.jsx';

const ROLE_LABELS = { SHIPPER: 'Shipper', CARRIER: 'Carrier', ADMIN: 'Admin', DRIVER: 'Driver' };

// Floating chat — real-time via Socket.IO (server/lib/socket.js), one room
// per thread (job + role-pair), with the REST send
// (job-extras.routes.js POST /messages, unchanged as the only write path)
// as the source of truth; the socket is push-only. Sending relies on the
// server broadcasting the new message back to everyone in the room,
// including the sender's own connection — one update path, no
// dedupe-by-id logic needed to avoid double-showing a just-sent message.
export default function ChatPopup({ jobId }) {
  const { user, actingAs } = useAuth();
  // A seat's sent messages are stored under the seat's own id
  // (server/middleware/auth.js's req.actorId), not the owner's — user.id
  // here is always the owner (see auth.jsx's session model), so "mine"
  // must compare against the acting seat's id when one is logged in.
  const myId = actingAs?.id ?? user.id;
  const { addToast } = useToasts();
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [threads, setThreads] = useState([]); // [{id, otherRole, messages}]
  const [availableRoles, setAvailableRoles] = useState([]);
  const [activeRole, setActiveRole] = useState(null); // otherRole of the selected conversation
  const [unread, setUnread] = useState(0);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const activeThreadIdRef = useRef(null);

  useEffect(() => { isOpenRef.current = isOpen; if (isOpen) setUnread(0); }, [isOpen]);

  const activeThread = threads.find((t) => t.otherRole === activeRole) || null;
  activeThreadIdRef.current = activeThread?.id ?? null;

  function loadThreads() {
    api.getThreads(jobId).then((d) => {
      setThreads(d.threads);
      setAvailableRoles(d.availableRecipientRoles);
      setActiveRole((prev) => prev || d.threads[0]?.otherRole || d.availableRecipientRoles[0] || null);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }

  // Load once the popup is opened for the first time, not on mount — most
  // job views never open the widget at all.
  useEffect(() => { if (isOpen && !loaded) loadThreads(); }, [isOpen, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Socket: join every thread this user already has on this job (so a
  // message arriving in a thread that isn't currently selected still
  // increments the unread badge), rejoining whenever the thread list changes.
  useEffect(() => {
    if (!loaded) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const threadIds = threads.map((t) => t.id);

    function joinAll() { threadIds.forEach((id) => socket.emit('join_thread', id)); }
    if (socket.connected) joinAll();
    socket.on('connect', joinAll);

    function onNewMessage(message) {
      setThreads((prev) => prev.map((t) => (
        t.id === message.thread_id && !t.messages.some((m) => m.id === message.id)
          ? { ...t, messages: [...t.messages, message] }
          : t
      )));
      const isActiveThread = message.thread_id === activeThreadIdRef.current;
      if (message.sender_id !== myId && !(isOpenRef.current && isActiveThread)) {
        setUnread((n) => n + 1);
      }
    }
    socket.on('new_message', onNewMessage);

    return () => {
      threadIds.forEach((id) => socket.emit('leave_thread', id));
      socket.off('connect', joinAll);
      socket.off('new_message', onNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, threads.map((t) => t.id).join(','), myId]);

  useEffect(() => {
    if (isOpen && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeThread?.messages, isOpen]);

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() || !activeRole) return;
    setBusy(true);
    try {
      const { threadId } = await api.sendMessage(jobId, content, activeRole);
      setContent('');
      // A brand-new conversation (no thread existed yet) needs a reload to
      // pick up the newly-created thread id and join its socket room —
      // an existing thread's own message arrives via the socket broadcast
      // above and needs nothing further here.
      if (threadId && !threads.some((t) => t.id === threadId)) loadThreads();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Message not sent', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  const messages = activeThread?.messages || [];

  return (
    <div className="fixed bottom-5 right-5 z-40" dir="ltr">
      {isOpen && (
        <div
          className="animate-chat-in mb-3 flex h-[440px] w-[350px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
          role="dialog"
          aria-label="Job messages"
        >
          <div
            className="flex items-center justify-between px-4 py-3.5"
            style={{ background: 'linear-gradient(135deg, var(--brand-accent), color-mix(in srgb, var(--brand-accent) 78%, black))' }}
          >
            <p className="font-display text-sm font-semibold text-white">Messages</p>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-full p-1 text-white/80 transition hover:bg-white/15 hover:text-white" aria-label="Close messages">
              <IconClose size={16} />
            </button>
          </div>

          {availableRoles.length > 1 && (
            <div className="flex gap-1 border-b p-2" style={{ borderColor: 'var(--border-subtle)' }}>
              {availableRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setActiveRole(role)}
                  className="rounded-full px-3 py-1 text-xs font-semibold transition"
                  style={activeRole === role
                    ? { background: 'var(--brand-accent)', color: 'white' }
                    : { background: 'var(--surface-container-high)', color: 'var(--ink-secondary)' }}
                >
                  {ROLE_LABELS[role] || role}
                </button>
              ))}
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite">
            {!loaded ? (
              <p className="text-sm text-ink-muted">Loading…</p>
            ) : !activeRole ? (
              <p className="text-sm text-ink-muted">No one to message on this job yet.</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-ink-muted">No messages with {ROLE_LABELS[activeRole] || activeRole} yet — say hello.</p>
            ) : (
              messages.map((m) => <ChatBubble key={m.id} body={m.content} mine={m.sender_id === myId} />)
            )}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <Input
              placeholder={activeRole ? `Message ${ROLE_LABELS[activeRole] || activeRole}…` : 'Write a message…'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={!activeRole}
              className="flex-1"
              aria-label="Message content"
            />
            <Button type="submit" variant="secondary" loading={busy} disabled={!activeRole} aria-label="Send message">
              <IconMessage size={16} />
            </Button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition-all duration-200 hover:scale-105 hover:shadow-2xl active:scale-95 ${!isOpen && unread > 0 ? 'animate-chat-glow' : ''}`}
        style={{ background: 'linear-gradient(135deg, var(--brand-accent), color-mix(in srgb, var(--brand-accent) 78%, black))' }}
        aria-label={isOpen ? 'Close messages' : 'Open messages'}
      >
        {isOpen ? <IconClose size={22} /> : <IconMessage size={22} />}
        {!isOpen && unread > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white ring-2"
            style={{ background: 'var(--status-danger)', '--tw-ring-color': 'var(--bg-surface)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
