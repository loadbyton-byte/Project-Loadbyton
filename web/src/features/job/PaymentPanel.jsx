import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { formatAED } from '../../lib/constants.js';
import { Button, Card, Badge } from '../../components/ui.jsx';

export default function PaymentPanel({ job, load, onDone }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isShipper = user?.id === job?.shipper_id;
  const amount = job?.processor_amount_aed || job?.agreed_price_aed;
  const onSuccess = onDone || load;

  const label =
    {
      REQUIRES_PAYMENT: { color: 'warning', text: 'Awaiting payment' },
      CREATED: { color: 'warning', text: 'Payment pending' },
      PAID: { color: 'success', text: `Paid ${formatAED(amount)}` },
      FAILED: { color: 'danger', text: 'Payment failed' },
      REFUNDED: { color: 'neutral', text: `Refunded ${formatAED(amount)}` },
    }[job.processor_payment_status] || { color: 'neutral', text: job.processor_payment_status };

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const r = await api.paymentCheckout(job.id);
      if (r.paymentUrl) {
        window.location.href = r.paymentUrl;
        return;
      }
      if (onSuccess) await onSuccess();
      if (r.testMode && !r.paymentUrl) setError('Payment started in test mode — awaiting processor confirmation. It will auto-confirm via webhook.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!job) return null;

  return (
    <Card className="mb-6">
      <Card.Header>
        <Card.Title>Payment</Card.Title>
        <Badge color={label.color}>{label.text}</Badge>
      </Card.Header>
      <Card.Content className="space-y-3">
        {isShipper && job.escrow_status === 'HELD' && !['PAID', 'REFUNDED'].includes(job.processor_payment_status) && (
          <div className="space-y-2">
            <Button variant="accent" className="w-full" onClick={pay} loading={busy}>
              Pay {formatAED(amount)} — secure hosted checkout
            </Button>
            {error && <p className="text-sm text-status-danger">{error}</p>}
            {job.processor_payment_status === 'FAILED' && (
              <p className="text-xs text-ink-muted">Your earlier payment attempt was declined or cancelled — you can try again.</p>
            )}
          </div>
        )}
        {job.processor_payment_status === 'PAID' && (
          <p className="text-sm text-ink-secondary">Escrow is funded. The carrier can now proceed with pickup.</p>
        )}
        {!isShipper && job.processor_payment_status === 'REQUIRES_PAYMENT' && (
          <p className="text-sm text-ink-secondary">Waiting for the shipper to complete payment before pickup.</p>
        )}
        {job.processor_payment_status === 'REFUNDED' && (
          <p className="text-sm text-ink-secondary">This payment was refunded. Refunds typically arrive within 5–7 business days.</p>
        )}
        {error && !(isShipper && job.escrow_status === 'HELD') && <p className="text-sm text-status-danger">{error}</p>}
      </Card.Content>
    </Card>
  );
}
