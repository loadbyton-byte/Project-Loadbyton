import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Badge, EmptyState, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { IconArrowLeft, IconGavel, IconPackage, IconClock, IconMapPin, IconCheckCircle } from '../components/icons.jsx';

export default function RfpDetail() {
  usePageTitle('RFP Details');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();

  const [rfp, setRfp] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [id]);

  async function fetchData() {
    setLoading(true);
    try {
      // GET /api/rfps/:id already returns every bid this viewer is allowed
      // to see (the owner sees all, a carrier only their own) — no separate
      // bids call exists or is needed.
      const rfpData = await api.getRfp(id);
      setRfp(rfpData.rfp);
      setBids(rfpData.bids || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;
  if (error) return <div className="container-page py-10"><ErrorState title="Couldn't load RFP" description={error} onRetry={fetchData} /></div>;
  if (!rfp) return <div className="container-page py-10 text-center"><IconPackage size={48} className="mx-auto text-ink-muted mb-4" /><h2 className="font-display text-xl font-bold text-ink mb-2">RFP not found</h2><Button onClick={() => navigate(-1)}>Go Back</Button></div>;

  const isOwner = rfp.shipper_id === user.id;

  return (
    <div className="container-page max-w-4xl">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink">
        <IconArrowLeft size={16} /> Back
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold text-ink">{rfp.title}</h1>
          <Badge color={rfp.status === 'OPEN' ? 'primary' : rfp.status === 'AWARDED' ? 'success' : 'neutral'}>{rfp.status}</Badge>
        </div>
        <p className="text-ink-muted">{rfp.origin} → {rfp.destination}</p>
      </div>

      <Card className="mb-6">
        <Card.Header><Card.Title>{t('rfp.details', 'RFP Details')}</Card.Title></Card.Header>
        <Card.Content className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-muted">{t('rfp.equipmentType', 'Equipment')}</dt><dd className="mt-0.5 font-medium text-ink">{rfp.equipment_type}</dd></div>
          <div><dt className="text-ink-muted">{t('rfp.cargoType', 'Cargo Type')}</dt><dd className="mt-0.5 font-medium text-ink">{rfp.cargo_type}</dd></div>
          <div><dt className="text-ink-muted">{t('rfp.deadline', 'Deadline')}</dt><dd className="mt-0.5 font-medium text-ink">{rfp.deadline ? new Date(rfp.deadline).toLocaleString() : '—'}</dd></div>
          <div><dt className="text-ink-muted">{t('rfp.budget', 'Budget')}</dt><dd className="mt-0.5 font-medium text-ink">AED {rfp.budget_aed?.toLocaleString() || '—'}</dd></div>
          {rfp.description && <div className="col-span-2"><dt className="text-ink-muted">{t('rfp.description', 'Description')}</dt><dd className="mt-0.5 text-ink-secondary">{rfp.description}</dd></div>}
        </Card.Content>
      </Card>

      <Card className="mb-6">
        <Card.Header>
          <Card.Title className="flex items-center gap-2">{t('rfp.bids', 'Bids')} <Badge color="neutral">{bids.length}</Badge></Card.Title>
        </Card.Header>
        <Card.Content>
          {bids.length === 0 ? (
            <EmptyState icon={<IconGavel size={28} />} title={t('rfp.noBids', 'No bids yet')} description={t('rfp.noBidsDesc', 'Carriers will submit their proposals here')} />
          ) : (
            <div className="space-y-3">
              {bids.map((bid) => (
                <div key={bid.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3" style={{ borderColor: bid.status === 'ACCEPTED' ? 'var(--status-success)' : 'var(--border-default)' }}>
                  <div className="min-w-0">
                    <p className="tabular font-display text-base font-semibold text-ink">AED {bid.amount_aed?.toLocaleString()}</p>
                    <p className="text-xs text-ink-muted">{bid.carrier_company || 'Unknown carrier'} · {bid.eta_days ? `${bid.eta_days}d ETA` : 'No ETA'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge color={bid.status === 'ACCEPTED' ? 'success' : bid.status === 'REJECTED' ? 'danger' : 'neutral'}>{bid.status}</Badge>
                    {isOwner && rfp.status === 'OPEN' && bid.status === 'PENDING' && (
                      <Button variant="accent" size="sm" onClick={async () => {
                        try {
                          await api.awardRfp(rfp.id, bid.id);
                          addToast({ type: 'status_change', title: 'RFP awarded' });
                          fetchData();
                        } catch (e) { addToast({ type: 'system_message', title: e.message || 'Failed to award' }); }
                      }}>Award</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}