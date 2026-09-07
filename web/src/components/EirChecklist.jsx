import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { uploadFile } from '../lib/upload.js';
import { Button } from './ui.jsx';

// Branches on requiresSeal: a sealed (goods-carrying) job needs only 1
// photo (the seal itself) plus the seal number — the photo alone only
// proves *a* seal existed, not which one, which is the actual fact a
// damage/tamper dispute needs. An unsealed/empty job needs 2 (Right Side,
// Left Side) instead. Rendered once at pickup and again at delivery
// (stage prop) — this used to be pickup-only.
export function EirChecklist({ jobId, stage = 'pickup', requiresSeal, onDone }) {
  const labels = requiresSeal ? ['Container Seal'] : ['Right Side', 'Left Side'];
  const [files, setFiles] = useState(labels.map(() => null));
  const [sealNumber, setSealNumber] = useState('');

  async function submit() {
    const photos = [];
    for (let i = 0; i < labels.length; i++) {
      const f = files[i];
      if (!f) return alert(`Photo ${i + 1} (${labels[i]}) required`);
      // Reuses the job-documents upload-url endpoint — same job-scoped
      // prefix and party check as every other document attached to this job.
      const uploaded = await uploadFile(f, (mimeType) => api.getJobDocumentUploadUrl(jobId, mimeType));
      photos.push(uploaded);
    }
    if (requiresSeal && !sealNumber.trim()) return alert('Seal number is required for a sealed job');
    await api.postEir(jobId, photos, { stage, sealNumber: requiresSeal ? sealNumber.trim() : undefined });
    onDone?.();
  }

  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)' }}>
      <p className="text-sm font-semibold text-ink">
        EIR — {stage === 'delivery' ? 'delivery' : 'pickup'} proof ({labels.length}-photo, unalterable ledger)
      </p>
      {requiresSeal && (
        <div>
          <label className="text-xs font-medium text-ink-secondary">Seal number</label>
          <input
            type="text"
            value={sealNumber}
            onChange={(e) => setSealNumber(e.target.value)}
            placeholder="e.g. SL-4471029"
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-default)' }}
          />
        </div>
      )}
      {labels.map((l, i) => (
        <div key={l}>
          <label className="text-xs font-medium text-ink-secondary">{i + 1}. {l}</label>
          <input type="file" accept="image/*" onChange={(e) => { const a = [...files]; a[i] = e.target.files[0] || null; setFiles(a); }} className="mt-1 block w-full text-sm" />
        </div>
      ))}
      <Button onClick={submit} className="w-full">Submit EIR</Button>
    </div>
  );
}
