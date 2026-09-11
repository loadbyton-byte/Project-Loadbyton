import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Card } from '../../components/ui.jsx';
import { formatAED } from '../../lib/constants.js';
import { useToasts } from '../../components/Toast.jsx';

// Backend has existed since Change 25 (server/routes/enterprise.routes.js —
// 20% of agreed price, instant, deducted from the final payout at
// completion) with zero UI caller anywhere. A carrier had no way to
// actually request one, or see one they'd already taken.
export default function FuelAdvancePanel({ job, onDone }) {
  const { addToast } = useToasts();
  const [advances, setAdvances] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job) return;
    api.getFuelAdvances(job.id).then((d) => setAdvances(d.advances)).catch(() => setAdvances([]));
  }, [job?.id]);

  if (!job || advances === null) return null;

  const taken = advances[0];
  const estimatedAmount = Math.round((job.agreed_price_aed || job.max_budget_aed || 0) * 0.20);

  async function request(type) {
    setBusy(true);
    try {
      const res = await api.requestFuelAdvance(job.id, type);
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
      <Card.Content className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-ink-muted">Fuel / Salik advance</p>
          {taken ? (
            <>
              <p className="font-medium text-ink">{formatAED(taken.amount_aed)} {taken.type === 'FUEL' ? 'fuel' : 'Salik'} advance issued</p>
              <p className="text-xs text-ink-muted">Deducted from your payout when this job's escrow is released.</p>
            </>
          ) : (
            <p className="font-medium text-ink">Up to {formatAED(estimatedAmount)} available now — 20% of the agreed price, deducted from your final payout</p>
          )}
        </div>
        {!taken && estimatedAmount > 0 && (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => request('FUEL')} loading={busy}>Fuel</Button>
            <Button variant="ghost" size="sm" onClick={() => request('SALIK')} loading={busy}>Salik</Button>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
