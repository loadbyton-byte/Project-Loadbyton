import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconArrowLeft, IconPackage, IconMapPin, IconClock, IconArrowRight } from '../components/icons.jsx';

// Matches server/routes/edi.routes.js's actual accepted transition
// statuses exactly (CREATED/IN_TRANSIT/DELIVERED/COMPLETED/CANCELLED) — a
// real bug found in review: this map previously used a different, invented
// vocabulary (DRAFT/SUBMITTED/ACKNOWLEDGED/EXCEPTION) that never matched a
// real consignment's status, so the transition feature only ever coincided
// with working for IN_TRANSIT and was dead for every other real state.
const TRANSITIONS = {
  CREATED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export default function EdiConsignmentDetail() {
  usePageTitle('Consignment Details');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const navigate = useNavigate();
  const { id } = useParams();

  const [consignment, setConsignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchConsignment();
  }, [id]);

  async function fetchConsignment() {
    setLoading(true);
    try {
      const data = await api.getConsignment(id);
      setConsignment(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTransition(newStatus) {
    if (!window.confirm(`Transition to ${newStatus}?`)) return;
    try {
      await api.transitionConsignment(id, { status: newStatus });
      addToast({ type: 'status_change', title: `Status updated to ${newStatus}` });
      fetchConsignment();
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Failed to transition' });
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load consignment" description={error} onRetry={fetchConsignment} /></div>;
  if (!consignment) return <div className="container-page py-10 text-center"><IconPackage size={48} className="mx-auto text-ink-muted mb-4" /><h2 className="font-display text-xl font-bold text-ink mb-2">Consignment not found</h2><Button onClick={() => navigate(-1)}>Go Back</Button></div>;

  // GET /api/edi/consignments/:id returns { consignment, linkedJob } —
  // linkedJob is a sibling key ({ job_code, status } | null), never a
  // nested field on the consignment row itself.
  const c = consignment.consignment;
  const linkedJob = consignment.linkedJob;
  const allowed = TRANSITIONS[c.status] || [];

  return (
    <div className="container-page max-w-3xl">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink">
        <IconArrowLeft size={16} /> Back
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold text-ink">{c.id}</h1>
          <Badge color={c.status === 'DELIVERED' || c.status === 'COMPLETED' ? 'success' : c.status === 'CANCELLED' ? 'danger' : c.status === 'IN_TRANSIT' ? 'warning' : 'neutral'}>{c.status}</Badge>
        </div>
        <p className="text-ink-muted">{c.origin} → {c.destination}</p>
      </div>

      <Card className="mb-6">
        <Card.Header><Card.Title>Consignment Details</Card.Title></Card.Header>
        <Card.Content className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-muted">Origin</dt><dd className="mt-0.5 font-medium text-ink">{c.origin}</dd></div>
          <div><dt className="text-ink-muted">Destination</dt><dd className="mt-0.5 font-medium text-ink">{c.destination}</dd></div>
          <div><dt className="text-ink-muted">Source</dt><dd className="mt-0.5 font-medium text-ink">{c.source}</dd></div>
          <div><dt className="text-ink-muted">Mode</dt><dd className="mt-0.5 font-medium text-ink">{c.mode}</dd></div>
          <div><dt className="text-ink-muted">Updated</dt><dd className="mt-0.5 font-medium text-ink">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</dd></div>
          {linkedJob && (
            <div>
              <dt className="text-ink-muted">Linked Job</dt>
              <dd className="mt-0.5 font-medium text-ink flex items-center gap-2">
                {linkedJob.job_code}
                <Button variant="ghost" size="sm" onClick={() => navigate(`/jobs/${c.linked_job_id}`)}>View Job</Button>
              </dd>
            </div>
          )}
        </Card.Content>
      </Card>

      {allowed.length > 0 && (
        <Card className="mb-6">
          <Card.Header><Card.Title>Transition Status</Card.Title></Card.Header>
          <Card.Content>
            <p className="text-sm text-ink-muted mb-3">Available transitions from <strong>{c.status}</strong>:</p>
            <div className="flex flex-wrap gap-2">
              {allowed.map((status) => (
                <Button key={status} variant="secondary" onClick={() => handleTransition(status)}>
                  <IconArrowRight size={14} className="mr-1" /> {status}
                </Button>
              ))}
            </div>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}