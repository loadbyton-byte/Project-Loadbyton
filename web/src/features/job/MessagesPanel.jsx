import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Input, ChatBubble } from '../../components/ui.jsx';
import { IconMessage } from '../../components/icons.jsx';
import { useToasts } from '../../components/Toast.jsx';

export default function MessagesPanel({ messages = [], jobId, onSent }) {
  const { user } = useAuth();
  const { addToast } = useToasts();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.sendMessage(jobId, content);
      setContent('');
      if (onSent) onSent();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Message not sent', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">No messages yet.</p>
      ) : (
        <div
          className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
          aria-label="Job messages"
        >
          {messages.map((m) => (
            <ChatBubble key={m.id} body={m.content} mine={m.sender_id === user.id} />
          ))}
        </div>
      )}
      <form onSubmit={submit} className="mt-4 flex gap-2 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
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
  );
}
