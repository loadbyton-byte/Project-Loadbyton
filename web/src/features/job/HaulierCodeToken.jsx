import React, { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Input, Label } from '../../components/ui.jsx';

// Carrier sets their own haulier code; shipper creates a token against it.
// Free text on both sides — not tied to DP World's specific process, so
// this still works for an Abu Dhabi Ports or Sharjah Ports job where the
// actual mechanism differs (server/schema.js's comment on jobs.haulier_code).
export default function HaulierCodeToken({ job, isShipper, isAwardedCarrier, onDone }) {
  const [haulierCode, setHaulierCode] = useState('');
  const [haulierToken, setHaulierToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitCode() {
    if (!haulierCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.setHaulierCode(job.id, haulierCode.trim());
      setHaulierCode('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitToken() {
    if (!haulierToken.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.setHaulierToken(job.id, haulierToken.trim());
      setHaulierToken('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <Label>Haulier code</Label>
        {job.haulier_code ? (
          <p className="font-mono text-ink">{job.haulier_code}</p>
        ) : isAwardedCarrier ? (
          <div className="mt-1 flex gap-2">
            <Input value={haulierCode} onChange={(e) => setHaulierCode(e.target.value)} placeholder="e.g. HC-4471029" />
            <Button variant="ghost" onClick={submitCode} loading={busy}>Set</Button>
          </div>
        ) : (
          <p className="text-ink-muted">Not set by the carrier yet.</p>
        )}
      </div>
      <div>
        <Label>Haulier token</Label>
        {job.haulier_token ? (
          <p className="font-mono text-ink">{job.haulier_token}</p>
        ) : isShipper && job.haulier_code ? (
          <div className="mt-1 flex gap-2">
            <Input value={haulierToken} onChange={(e) => setHaulierToken(e.target.value)} placeholder="Token referencing the haulier code above" />
            <Button variant="ghost" onClick={submitToken} loading={busy}>Set</Button>
          </div>
        ) : isShipper ? (
          <p className="text-ink-muted">Waiting for the carrier to set a haulier code first.</p>
        ) : (
          <p className="text-ink-muted">Not issued by the shipper yet.</p>
        )}
      </div>
      {error && <p className="text-status-danger">{error}</p>}
    </div>
  );
}
