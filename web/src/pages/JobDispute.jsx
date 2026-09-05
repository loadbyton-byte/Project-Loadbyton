import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePageTitle } from '../lib/seo.jsx';
import { formatDateTime } from '../lib/constants.js';
import { Card, Badge, Button, Input, Spinner, ChatThread, ErrorState } from '../components/ui.jsx';
import { IconArrowLeft, IconGavel, IconFile, IconSend } from '../components/icons.jsx';
import { useToasts } from '../components/Toast.jsx';

const DECISION_LABEL = {
  RELEASE_TO_CARRIER: 'Released to carrier',
  REFUND_SHIPPER: 'Refunded to shipper',
  SPLIT: 'Split between parties',
};

// The party-facing half of the dispute hub — the admin side already existed
// (Admin.jsx's Disputes tab); a shipper/carrier previously had no way to see
// their own dispute's status or add context after filing one via
// JobDetail's "Report a problem". Backed by the new
// GET /api/jobs/:id/dispute route and the existing job-messages thread.
export default function JobDispute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToast } = useToasts();
  const [data, setData] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [disputeData, jobData, msgs] = await Promise.all([
        api.getDispute(id),
        api.getJob(id).catch(() => null),
        api.getMessages(id).catch(() => ({ messages: [] })),
      ]);
      setData(disputeData);
      setDocuments(jobData?.documents || []);
      setMessages(msgs.messages);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  usePageTitle(data?.job ? `Dispute · ${data.job.job_code}` : 'Dispute');

  async function send(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      await api.sendMessage(id, content.trim());
      setContent('');
      load();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Message not sent', body: err.message });
    } finally {
      setSending(false);
    }
  }

  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load this dispute" description={error} onRetry={() => { setError(''); load(); }} /></div>;
  if (!data) return <div className="container-page flex justify-center py-24"><Spinner size={28} /></div>;

  const { dispute, job } = data;
  const chatMessages = messages.map((m) => ({
    id: m.id,
    body: m.content,
    mine: m.sender_id === user.id,
    variant: m.sender_role === 'ADMIN' ? 'admin' : undefined,
    senderLabel: m.sender_role === 'ADMIN' ? 'Admin' : undefined,
    at: formatDateTime(m.created_at),
  }));

  return (
    <div className="container-page py-6" dir="ltr">
      <button type="button" onClick={() => navigate(`/jobs/${id}`)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink">
        <IconArrowLeft size={16} /> Back to job
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-muted">{job.job_code}</p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-ink">
            <IconGavel size={20} className="text-status-danger" /> Dispute resolution
          </h1>
        </div>
        <Badge color={dispute.status === 'RESOLVED' ? 'success' : 'warning'}>{dispute.status}</Badge>
      </div>

      {/* Status tracker — Open -> Under review -> Resolved. Dispute rows
          don't have an "under review" state of their own (OPEN -> RESOLVED
          only), so this is a simple two-state indicator, not the shared
          6-stage StatusTracker (that's for job lifecycle, a different
          state machine entirely). */}
      <div className="mt-5 flex items-center gap-2">
        {['Filed', 'Resolved'].map((label, i) => {
          const done = i === 0 || dispute.status === 'RESOLVED';
          return (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: done ? 'var(--status-danger)' : 'var(--outline-variant)' }} />
                <span className={done ? 'text-xs font-semibold text-ink' : 'text-xs text-ink-muted'}>{label}</span>
              </div>
              {i === 0 && <span className="h-0.5 flex-1" style={{ background: dispute.status === 'RESOLVED' ? 'var(--status-danger)' : 'var(--outline-variant)' }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr,320px]">
        <Card>
          <Card.Header><Card.Title>Message thread</Card.Title></Card.Header>
          <ChatThread messages={chatMessages} emptyLabel="No messages on this dispute yet." />
          <form onSubmit={send} className="flex gap-2 border-t p-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <Input placeholder="Add context for the admin…" value={content} onChange={(e) => setContent(e.target.value)} className="flex-1" />
            <Button type="submit" variant="secondary" loading={sending}><IconSend size={16} /></Button>
          </form>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <Card.Header><Card.Title>Dispute details</Card.Title></Card.Header>
            <Card.Content className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Reason filed</p>
                <p className="mt-0.5 text-ink-secondary">{dispute.reason}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Filed</p>
                <p className="mt-0.5 text-ink-secondary">{formatDateTime(dispute.created_at)}</p>
              </div>
              {dispute.status === 'RESOLVED' && (
                <>
                  <div className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <p className="text-xs text-ink-muted">Decision</p>
                    <p className="mt-0.5 font-semibold text-ink">{DECISION_LABEL[dispute.decision] || dispute.decision}</p>
                  </div>
                  {dispute.determination && (
                    <div>
                      <p className="text-xs text-ink-muted">Admin's determination</p>
                      <p className="mt-0.5 text-ink-secondary">{dispute.determination}</p>
                    </div>
                  )}
                </>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header><Card.Title>Evidence on file</Card.Title></Card.Header>
            <Card.Content>
              {documents.length === 0 ? (
                <p className="text-sm text-ink-muted">No documents uploaded on this job.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <IconFile size={14} className="text-ink-muted" />
                      <span className="text-ink-secondary">{d.title}</span>
                      <Badge>{d.doc_type}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
