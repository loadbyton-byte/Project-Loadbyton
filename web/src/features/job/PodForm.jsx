import React, { useState } from 'react';
import { useToasts } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { uploadFile, UPLOAD_ACCEPT } from '../../lib/upload.js';
import { Button, Card, Input, Label } from '../../components/ui.jsx';

export default function PodForm({ jobId, onDone, busy, setBusy, setError }) {
  const [file, setFile] = useState(null);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      let document;
      if (file) {
        const uploaded = await uploadFile(file, (mimeType) => api.getJobDocumentUploadUrl(jobId, mimeType));
        document = { docType: 'POD', title: file.name, ...uploaded };
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