import React, { useState } from 'react';
import { useToasts } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { fileToBase64, UPLOAD_ACCEPT } from '../../lib/upload.js';
import { Button, Card, Input, Label } from '../../components/ui.jsx';

export default function PodForm({ jobId, onDone, busy, setBusy, setError }) {
  const [file, setFile] = useState(null);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      let document;
      if (file) {
        const { base64, mimeType } = await fileToBase64(file);
        document = { docType: 'POD', title: file.name, fileBase64: base64, mimeType };
      }
      await api.submitPod(jobId, document ? { document } : {});
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => setFile(e.target.files[0] || null)} />
      <p className="text-xs text-ink-muted">Optional — a photo of the signed delivery note or POD stamp (JPEG/PNG/WEBP/PDF, up to 5MB).</p>
      <Button className="w-full" variant="accent" onClick={submit} loading={busy}>Submit proof of delivery</Button>
    </div>
  );
}