import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../../lib/socket.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Input, ChatBubble } from '../../components/ui.jsx';
import { IconMessage, IconClose } from '../../components/icons.jsx';
import { useToasts } from '../../components/Toast.jsx';

// Floating chat — real-time via Socket.IO (server/lib/socket.js), with the
// REST send (job-extras.routes.js POST /messages, unchanged) as the only
// write path; the socket is push-only. Sending relies on the server
// broadcasting the new message back to everyone in the room, including the
// sender's own connection, rather than optimistically appending locally —
// one update path, no dedupe-by-id logic needed to avoid double-showing a
// just-sent message.
export default function ChatPopup({ jobId, initialMessages = [] }) {
  const { user } = useAuth();
  const { addToast } = useToasts();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const [unread, setUnread] = useState(0);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => { setMessages(initialMessages); }, [initialMessages]);

  // Read inside the socket effect below without making isOpen a dependency
  // of it (that would tear down and rejoin the room on every open/close).
  const isOpenRef = useRef(isOpen);
  useEffect(() => { isOpenRef.current = isOpen; if (isOpen) setUnread(0); }, [isOpen]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function join() {
      socket.emit('join_job', jobId);
    }
    if (socket.connected) join();
    socket.on('connect', join);

    function onNewMessage(message) {
      if (message.job_id !== jobId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (message.sender_id !== user.id) {
        setUnread((n) => (isOpenRef.current ? 0 : n + 1));
      }
    }
    socket.on('new_message', onNewMessage);

    return () => {
      socket.emit('leave_job', jobId);
      socket.off('connect', join);
      socket.off('new_message', onNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, user.id]);

  useEffect(() => {
    if (isOpen && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isOpen]);

  async function submit(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.sendMessage(jobId, content);
      setContent('');
    } catch (err) {
      addToast({ type: 'system_message', title: 'Message not sent', body: err.message });
    } finally {
      setBusy(false);
    }
  }

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
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <p className="text-sm text-ink-muted">No messages yet — say hello.</p>
            ) : (
              messages.map((m) => <ChatBubble key={m.id} body={m.content} mine={m.sender_id === user.id} />)
            )}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <Input
              placeholder="Write a message…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1"
              aria-label="Message content"
            />
            <Button type="submit" variant="secondary" loading={busy} aria-label="Send message">
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
