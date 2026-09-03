import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatDateTime } from '../lib/constants.js';
import { Button, Input, Badge, EmptyState } from '../components/ui.jsx';
import { IconMessage, IconArrowLeft } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';
import { ROLE_LABELS, ThreadMessageList } from '../features/job/ThreadPane.jsx';

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
  const [selected, setSelected] = useState(null); // inbox row
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  function loadInbox() {
    api.messageThreads().then((d) => setInbox(d.threads)).catch(() => setInbox([]));
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

  return (
    <div className="container-page py-6" dir="ltr">
      <h1 className="font-display text-xl font-bold text-ink">Messages</h1>

      <div className="mt-5 grid gap-4 md:grid-cols-[320px_1fr]" style={{ minHeight: '60vh' }}>
        {/* Thread list */}
        <div className={`overflow-hidden rounded-2xl border ${selected ? 'hidden md:block' : 'block'}`} style={{ borderColor: 'var(--border-default)' }}>
          {inbox === null ? (
            <p className="p-4 text-sm text-ink-muted">Loading…</p>
          ) : inbox.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<IconMessage size={26} />} title="No conversations yet" description="Messages on your jobs will show up here." />
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {inbox.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openThread(row)}
                  className="flex w-full items-start justify-between gap-2 p-3.5 text-left transition hover:bg-surface-container"
                  style={selected?.id === row.id ? { background: 'var(--surface-container-high)' } : undefined}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-ink-muted">{row.jobCode}</p>
                    <p className="text-sm font-medium text-ink">{ROLE_LABELS[row.otherRole] || row.otherRole}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{row.lastMessage?.content || 'No messages yet'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {row.lastMessage && <span className="font-mono text-[11px] text-ink-muted">{formatDateTime(row.lastMessage.created_at)}</span>}
                    {row.unreadCount > 0 && <Badge color="danger" dot={false}>{row.unreadCount}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected thread */}
        <div className={`flex flex-col overflow-hidden rounded-2xl border ${selected ? 'flex' : 'hidden md:flex'}`} style={{ borderColor: 'var(--border-default)' }}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-muted">Select a conversation</div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b p-3.5" style={{ borderColor: 'var(--border-subtle)' }}>
                <button type="button" onClick={() => setSelected(null)} className="rounded-full p-1 text-ink-muted hover:bg-surface-container md:hidden" aria-label="Back to list">
                  <IconArrowLeft size={18} />
                </button>
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
                <Button type="submit" variant="secondary" loading={busy} aria-label="Send message">
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
