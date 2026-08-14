import React, { useState } from 'react';
import { Button } from './ui.jsx';
import { IconCamera } from './icons.jsx';
import { extractDocumentFields } from '../lib/puterOcr.js';
import DocumentScanner from './DocumentScanner.jsx';

// Reusable "scan a photo to autofill" control. fields: [{ key, description }]
// (passed straight through to extractDocumentFields); onExtract receives
// { [key]: string|null } and decides what to do with it — this component
// never writes to any form state itself, so every call site stays in
// control of which fields actually get overwritten.
//
// Opens the live-camera DocumentScanner (matches the Stitch document_
// scanner mockup) rather than a plain file picker — DocumentScanner itself
// falls back to a file input when the camera is unavailable, so this still
// works anywhere the old plain-file-input version did.
export default function ScanWithAi({ fields, onExtract, label = 'Scan with AI', className = '' }) {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onCapture(dataUrl) {
    setScanning(false);
    setBusy(true);
    setError('');
    try {
      const { fields: extracted } = await extractDocumentFields(dataUrl, fields);
      onExtract(extracted);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => setScanning(true)}>
        <IconCamera size={14} /> {label}
      </Button>
      {error ? (
        <p className="mt-1 text-xs text-status-danger">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">AI-suggested from a photo — please check before submitting.</p>
      )}
      {scanning && <DocumentScanner onCapture={onCapture} onClose={() => setScanning(false)} />}
    </div>
  );
}
