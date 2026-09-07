import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconArrowLeft, IconPackage, IconMapPin, IconClock, IconArrowRight } from '../components/icons.jsx';

const TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED', 'EXCEPTION'],
  ACKNOWLEDGED: ['IN_TRANSIT', 'EXCEPTION'],
  IN_TRANSIT: ['DELIVERED', 'EXCEPTION'],
  DELIVERED: [],
  EXCEPTION: ['SUBMITTED'],
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
      addToast(`Status updated to ${newStatus}`, 'success');
      fetchConsignment();
    } catch (e) {
      addToast(e.message || 'Failed to transition', 'error');
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load consignment" description={error} onRetry={fetchConsignment} /></div>;
  if (!consignment) return <div className="container-page py-10 text-center"><IconPackage size={48} className="mx-auto text-ink-muted mb-4" /><h2 className="font-display text-xl font-bold text-ink mb-2">Consignment not found</h2><Button onClick={() => navigate(-1)}>Go Back</Button></div>;

  const c = consignment.consignment;
  const allowed = TRANSITIONS[c.status] || [];

  return (
    <div className="container-page max-w-3xl">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink">
        <IconArrowLeft size={16} /> Back
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold text-ink">{c.consignment_id}</h1>
          <Badge color={c.status === 'DELIVERED' ? 'success' : c.status === 'EXCEPTION' ? 'danger' : c.status === 'IN_TRANSIT' ? 'warning' : 'neutral'}>{c.status}</Badge>
        </div>
        <p className="text-ink-muted">{c.origin} → {c.destination}</p>
      </div>

      <Card className="mb-6">
        <Card.Header><Card.Title>Consignment Details</Card.Title></Card.Header>
        <Card.Content className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-muted">Origin</dt><dd className="mt-0.5 font-medium text-ink">{c.origin}</dd></div>
          <div><dt className="text-ink-muted">Destination</dt><dd className="mt-0.5 font-medium text-ink">{c.destination}</dd></div>
          <div><dt className="text-ink-muted">Equipment</dt><dd className="mt-0.5 font-medium text-ink">{c.equipment_type || '—'}</dd></div>
          <div><dt className="text-ink-muted">Cargo</dt><dd className="mt-0.5 font-medium text-ink">{c.cargo_type || '—'}</dd></div>
          <div><dt className="text-ink-muted">Weight</dt><dd className="mt-0.5 font-medium text-ink">{c.weight_tons ? `${c.weight_tons} t` : '—'}</dd></div>
          <div><dt className="text-ink-muted">Updated</dt><dd className="mt-0.5 font-medium text-ink">{c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}</dd></div>
          {c.linked_job && <div><dt className="text-ink-muted">Linked Job</dt><dd className="mt-0.5 font-medium text-ink flex items-center gap-2">{c.linked_job.job_code} <Button variant="ghost" size="sm" onClick={() => navigate(`/jobs/${c.linked_job.id}`)}>View Job</Button></dd></div>}
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

      {c.job_code && (
        <Card>
          <Card.Header><Card.Title>Linked Job</Card.Title></Card.Header>
          <Card.Content>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{c.job_code}</p>
                <p className="text-sm text-ink-muted">Status: {c.job_status || '—'}</p>
              </div>
              <Button variant="accent" onClick={() => navigate(`/jobs/${c.linked_job_id}`)}>
                <IconArrowRight size={14} className="mr-2" /> Open Job
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}