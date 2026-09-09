import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatDateTime } from '../lib/constants.js';
import { Button, Input, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { IconMessage, IconArrowLeft, IconSearch, IconChat } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { ROLE_LABELS, ThreadMessageList } from '../features/job/ThreadPane.jsx';

// One color per counterparty role — reuses the existing semantic status
// tokens as identity colors (not literal statuses) so a thread's avatar
// chip is scannable at a glance without inventing a new palette.
const ROLE_COLORS = {
  SHIPPER: 'var(--status-info)',
  CARRIER: 'var(--status-success)',
  ADMIN: 'var(--brand-accent)',
  DRIVER: 'var(--status-warning)',
};
function roleInitial(role) {
  return (ROLE_LABELS[role] || role || '?').charAt(0).toUpperCase();
}

// The dedicated messages history page — an inbox over the exact same
// threads/sockets ChatPopup uses (server/lib/messaging.js), just viewed
// across every job at once instead of scoped to one. Selecting a row
// re-fetches that job's full thread set (GET /jobs/:id/threads, the same
// call ChatPopup makes) rather than duplicating message storage here.
export default function Messages() {
  usePageTitle('Messages');
  const { user, actingAs } = useAuth();
  const myId = actingAs?.id ?? user.id;
  const { addToast } = useToasts();

  const [inbox, setInbox] = useState(null); // [{id, jobId, jobCode, jobStatus, otherRole, lastMessage, unreadCount}]
  const [inboxError, setInboxError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // inbox row
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  function loadInbox() {
    setInboxError('');
    api.messageThreads().then((d) => setInbox(d.threads)).catch((err) => { setInbox([]); setInboxError(err.message); });
  }
  useEffect(loadInbox, []);

  async function openThread(row) {
    setSelected(row);
    setThreadLoaded(false);
    try {
      const d = await api.getThreads(row.jobId);
      const t = d.threads.find((x) => x.id === row.id);
      setThreadMessages(t?.messages || []);
      setThreadLoaded(true);
      if (row.unreadCount > 0) {
        await api.markThreadRead(row.id);
        setInbox((prev) => prev.map((r) => (r.id === row.id ? { ...r, unreadCount: 0 } : r)));
      }
    } catch {
      setThreadLoaded(true);
    }
  }

  // Live updates for the open thread only — the inbox list itself is a
  // point-in-time snapshot, refreshed by re-opening Messages or picking
  // another thread, same as ChatPopup's per-job scope.
  useEffect(() => {
    if (!selected) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    function joinIt() { socket.emit('join_thread', selected.id); }
    if (socket.connected) joinIt();
    socket.on('connect', joinIt);

    function onNewMessage(message) {
      if (message.thread_id !== selected.id) return;
      setThreadMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    }
    socket.on('new_message', onNewMessage);

    return () => {
      socket.emit('leave_thread', selected.id);
      socket.off('connect', joinIt);
      socket.off('new_message', onNewMessage);
    };
  }, [selected]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [threadMessages]);

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() || !selected) return;
    setBusy(true);
    try {
      await api.sendMessage(selected.jobId, content, selected.otherRole);
      setContent('');
    } catch (err) {
      addToast({ type: 'system_message', title: 'Message not sent', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  const q = search.trim().toLowerCase();
  const filteredInbox = !inbox ? inbox : !q ? inbox : inbox.filter((row) => (
    row.jobCode?.toLowerCase().includes(q)
    || (ROLE_LABELS[row.otherRole] || row.otherRole || '').toLowerCase().includes(q)
    || (row.lastMessage?.content || '').toLowerCase().includes(q)
  ));

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="flex items-center gap-2 font-display text-xl font-bold text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-accent)' }}>
          <IconChat size={16} />
        </span>
        Messages
      </h1>

      <div className="mt-5 grid gap-4 md:grid-cols-[320px_1fr]" style={{ minHeight: '60vh' }}>
        {/* Thread list */}
        <div className={`flex flex-col overflow-hidden rounded-2xl border ${selected ? 'hidden md:flex' : 'flex'}`} style={{ borderColor: 'var(--border-default)' }}>
          {inbox && inbox.length > 0 && (
            <div className="relative shrink-0 border-b p-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
              <IconSearch size={15} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by job code, contact, or message…"
                className="pl-9"
                aria-label="Search conversations"
              />
            </div>
          )}
          {inbox === null ? (
            <p className="p-4 text-sm text-ink-muted">Loading…</p>
          ) : inboxError ? (
            <div className="p-4"><ErrorState title="Couldn't load messages" description={inboxError} onRetry={loadInbox} /></div>
          ) : inbox.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<IconMessage size={26} />} title="No conversations yet" description="Messages on your jobs will show up here." />
            </div>
          ) : filteredInbox.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<IconSearch size={26} />} title="No matches" description={`Nothing found for "${search}".`} />
            </div>
          ) : (
            <div className="divide-y overflow-y-auto" style={{ borderColor: 'var(--border-subtle)' }}>
              {filteredInbox.map((row, i) => {
                const active = selected?.id === row.id;
                const unread = row.unreadCount > 0;
                const roleColor = ROLE_COLORS[row.otherRole] || 'var(--text-muted)';
                return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openThread(row)}
                  className="animate-thread-row-in flex w-full origin-left items-start gap-2.5 border-l-[3px] p-3.5 text-left transition-all duration-150 hover:z-10 hover:scale-[1.015] hover:bg-surface-container hover:shadow-md"
                  style={{
                    '--msg-delay': `${Math.min(i * 30, 240)}ms`,
                    borderLeftColor: active ? 'var(--brand-accent)' : unread ? roleColor : 'transparent',
                    background: active ? 'var(--surface-container-high)' : unread ? 'color-mix(in srgb, var(--brand-accent) 5%, transparent)' : undefined,
                  }}
                >
                  <span
                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${unread ? 'animate-chat-glow' : ''}`}
                    style={{ background: `color-mix(in srgb, ${roleColor} 18%, transparent)`, color: roleColor }}
                    aria-hidden="true"
                  >
                    {roleInitial(row.otherRole)}
                  </span>
                  <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-ink-muted">{row.jobCode}</p>
                    <p className={`text-sm ${unread ? 'font-bold text-ink' : 'font-medium text-ink'}`}>{ROLE_LABELS[row.otherRole] || row.otherRole}</p>
                    <p className={`mt-0.5 truncate text-xs ${unread ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{row.lastMessage?.content || 'No messages yet'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {row.lastMessage && <span className="font-mono text-[11px] text-ink-muted">{formatDateTime(row.lastMessage.created_at)}</span>}
                    {unread && <Badge color="danger" dot={false}>{row.unreadCount}</Badge>}
                  </div>
                  </div>
                </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected thread */}
        <div className={`flex flex-col overflow-hidden rounded-2xl border ${selected ? 'flex' : 'hidden md:flex'}`} style={{ borderColor: 'var(--border-default)' }}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-muted">Select a conversation</div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b p-3.5" style={{ borderColor: 'var(--border-subtle)' }}>
                <button type="button" onClick={() => setSelected(null)} className="rounded-full p-1 text-ink-muted hover:bg-surface-container md:hidden" aria-label="Back to list">
                  <IconArrowLeft size={18} />
                </button>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: `color-mix(in srgb, ${ROLE_COLORS[selected.otherRole] || 'var(--text-muted)'} 18%, transparent)`, color: ROLE_COLORS[selected.otherRole] || 'var(--text-muted)' }}
                  aria-hidden="true"
                >
                  {roleInitial(selected.otherRole)}
                </span>
                <div>
                  <p className="font-mono text-xs text-ink-muted">{selected.jobCode}</p>
                  <p className="text-sm font-semibold text-ink">{ROLE_LABELS[selected.otherRole] || selected.otherRole}</p>
                </div>
              </div>
              <ThreadMessageList listRef={listRef} loaded={threadLoaded} activeRole={selected.otherRole} messages={threadMessages} myId={myId} />
              <form onSubmit={submit} className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <Input
                  placeholder={`Message ${ROLE_LABELS[selected.otherRole] || selected.otherRole}…`}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="flex-1"
                  aria-label="Message content"
                />
                <Button type="submit" variant="accent" loading={busy} aria-label="Send message">
                  <IconMessage size={16} />
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
