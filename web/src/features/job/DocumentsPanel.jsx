import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Badge, Input } from '../../components/ui.jsx';
import { IconFile } from '../../components/icons.jsx';
import { useToasts } from '../../components/Toast.jsx';
import { fileToBase64, UPLOAD_ACCEPT, documentFileUrl } from '../../lib/upload.js';

const DOC_TYPES = ['CUSTOMS', 'RECEIPT', 'POD', 'LICENCE', 'INSURANCE', 'OTHER'];

export default function DocumentsPanel({ documents = [], jobId, onAdd }) {
  const { addToast } = useToasts();
  const [docType, setDocType] = useState('CUSTOMS');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title || !file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      await api.addDocument(jobId, { docType, title, fileBase64: base64, mimeType });
      setDocType('CUSTOMS');
      setTitle('');
      setFile(null);
      if (onAdd) onAdd();
    } catch (err) {
      addToast({ type: 'system_message', title: 'Could not add document', body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {documents.length === 0 ? (
        <p className="text-sm text-ink-muted">No documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 text-sm">
              <IconFile size={15} className="text-ink-muted" />
              <a href={documentFileUrl(jobId, d)} target="_blank" rel="noreferrer" className="font-medium text-brand-secondary hover:underline">
                {d.title}
              </a>
              <Badge color="neutral">{d.doc_type}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        Private between shipper and carrier — your own uploads are visible to you; the other side&apos;s uploads appear here only after the bid is confirmed.
      </p>
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <details className="mb-3 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none font-medium text-ink-secondary">What should I upload?</summary>
          <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: 'disc' }}>
            <li><strong>CUSTOMS</strong> — customs release/clearance paperwork for the container or cargo.</li>
            <li><strong>RECEIPT</strong> — terminal handling receipt or any charge slip tied to this job.</li>
            <li><strong>POD</strong> — proof of delivery (signed delivery note, gate pass) — usually attached automatically when you submit POD in the Actions panel.</li>
            <li><strong>LICENCE</strong> — trade licence, used when a document needs to reference the carrier&apos;s registration.</li>
            <li><strong>INSURANCE</strong> — cargo or fleet insurance certificate relevant to this shipment.</li>
            <li><strong>OTHER</strong> — anything else worth keeping on the job record.</li>
          </ul>
        </details>
        <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[110px,1fr,1fr,auto]">
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <Input placeholder="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="file" accept={UPLOAD_ACCEPT} required className="input" onChange={(e) => setFile(e.target.files[0] || null)} />
          <Button type="submit" variant="secondary" loading={busy}>
            Add
          </Button>
        </form>
      </div>
    </div>
  );
}
