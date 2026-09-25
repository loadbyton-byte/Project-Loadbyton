import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Card, Input } from '../../components/ui.jsx';
import { formatAED } from '../../lib/constants.js';
import { useToasts } from '../../components/Toast.jsx';

// Backend: server/routes/enterprise.routes.js. Instant, auto-approved,
// deducted from the final payout at completion — a carrier previously
// could only ever take the full 20%-of-agreed-price ceiling with no way
// to ask for less; the amount is now their own choice, capped at that
// same ceiling.
export default function FuelAdvancePanel({ job, onDone }) {
  const { addToast } = useToasts();
  const [advances, setAdvances] = useState(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!job) return;
    api.getFuelAdvances(job.id).then((d) => setAdvances(d.advances)).catch(() => setAdvances([]));
  }, [job?.id]);

  if (!job || advances === null) return null;

  const taken = advances[0];
  const ceiling = Math.round((job.agreed_price_aed || job.max_budget_aed || 0) * 0.20);

  async function request(type) {
    const requested = amount ? Number(amount) : ceiling;
    if (!Number.isFinite(requested) || requested <= 0 || requested > ceiling) {
      addToast({ type: 'system_message', title: 'Invalid amount', body: `Enter an amount between AED 1 and ${formatAED(ceiling)}.` });
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestFuelAdvance(job.id, type, requested);
      setAdvances([{ type, amount_aed: res.amount, created_at: new Date().toISOString() }]);
      addToast({ type: 'status_change', title: 'Advance issued', body: `${formatAED(res.amount)} ${type === 'FUEL' ? 'fuel' : 'Salik'} advance issued — deducted from your payout at completion.` });
      if (onDone) onDone();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not issue advance', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <Card.Content className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-ink-muted">Fuel / Salik advance</p>
          {taken ? (
            <>
              <p className="font-medium text-ink">{formatAED(taken.amount_aed)} {taken.type === 'FUEL' ? 'fuel' : 'Salik'} advance issued</p>
              <p className="text-xs text-ink-muted">Deducted from your payout when this job's payment is released.</p>
            </>
          ) : (
            <p className="font-medium text-ink">Up to {formatAED(ceiling)} available now — 20% of the agreed price, deducted from your final payout</p>
          )}
        </div>
        {!taken && ceiling > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <Input
              type="number"
              min="1"
              max={ceiling}
              placeholder={`Up to ${ceiling}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
            <Button variant="ghost" size="sm" onClick={() => request('FUEL')} loading={busy}>Fuel</Button>
            <Button variant="ghost" size="sm" onClick={() => request('SALIK')} loading={busy}>Salik</Button>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
