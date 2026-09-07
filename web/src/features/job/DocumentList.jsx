import React, { useState } from 'react';
import { useToasts } from '../../components/Toast.jsx';
import { api } from '../../lib/api.js';
import { uploadFile, UPLOAD_ACCEPT, documentFileUrl } from '../../lib/upload.js';
import { Button, Input, Select, Badge } from '../../components/ui.jsx';
import { IconFile } from '../../components/icons.jsx';

// DO/BOE/INSPECTION_PROOF are carrier-facing (delivery order, bill of
// entry, proof of an inspection attended); GATE_PASS/POD_TEMPLATE are
// shipper-facing — matches the role restriction already enforced
// server-side (server/routes/job-extras.routes.js). Only shown post-
// assignment, same as every other document type here.
const SHARED_DOC_TYPES = ['CUSTOMS', 'RECEIPT', 'POD', 'LICENCE', 'INSURANCE', 'OTHER'];
const CARRIER_DOC_TYPES = ['DO', 'BOE', 'INSPECTION_PROOF'];
const SHIPPER_DOC_TYPES = ['GATE_PASS', 'POD_TEMPLATE'];
const DOC_TYPE_LABELS = {
  DO: 'Delivery Order', BOE: 'Bill of Entry', INSPECTION_PROOF: 'Proof of inspection',
  GATE_PASS: 'Gate Pass', POD_TEMPLATE: 'POD Template',
};

export default function DocumentList({ documents, jobId, onAdd, isShipperParty, isCarrierParty }) {
  const { addToast } = useToasts();
  const availableTypes = [
    ...SHARED_DOC_TYPES,
    ...(isCarrierParty ? CARRIER_DOC_TYPES : []),
    ...(isShipperParty ? SHIPPER_DOC_TYPES : []),
  ];
  const [docType, setDocType] = useState(availableTypes[0]);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!title || !file) return;
    setBusy(true);
    try {
      const uploaded = await uploadFile(file, (mimeType) => api.getJobDocumentUploadUrl(jobId, mimeType));
      await api.addDocument(jobId, { docType, title, ...uploaded });
      setDocType(availableTypes[0]);
      setTitle('');
      setFile(null);
      onAdd();
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
              <IconFile size={14} className="shrink-0 text-ink-muted" />
              <a href={documentFileUrl(jobId, d)} target="_blank" rel="noreferrer" className="font-medium text-brand-secondary hover:underline">{d.title}</a>
              <span className="rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: 'var(--border-default)', color: 'var(--ink-muted)' }}>{DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink-muted">Private between shipper and carrier — your own uploads are visible to you; the other side's uploads appear here only after the bid is confirmed.</p>
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <details className="mb-3 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none font-medium text-ink-secondary">What should I upload?</summary>
          <ul className="mt-2 space-y-1 pl-4" style={{ listStyle: 'disc' }}>
            <li><strong>CUSTOMS</strong> — customs release/clearance paperwork for the container or cargo.</li>
            <li><strong>RECEIPT</strong> — terminal handling receipt or any charge slip tied to this job.</li>
            <li><strong>POD</strong> — proof of delivery (signed delivery note, gate pass) — usually attached automatically when you submit POD in the Actions panel.</li>
            <li><strong>LICENCE</strong> — trade licence, used when a document needs to reference the carrier's registration.</li>
            <li><strong>INSURANCE</strong> — cargo or fleet insurance certificate relevant to this shipment.</li>
            {isCarrierParty && <li><strong>Delivery Order</strong> — the DO for this import/export leg.</li>}
            {isCarrierParty && <li><strong>Bill of Entry</strong> — customs BOE for this import/export leg.</li>}
            {isCarrierParty && <li><strong>Proof of inspection</strong> — evidence a customs/cargo inspection you attended actually happened, especially if an inspection-waiting charge was raised.</li>}
            {isShipperParty && <li><strong>Gate Pass</strong> — the pass the driver needs to enter the pickup/delivery site.</li>}
            {isShipperParty && <li><strong>POD Template</strong> — your own proof-of-delivery format for the driver to print, get sealed, and return after delivery.</li>}
            <li><strong>OTHER</strong> — anything else worth keeping on the job record.</li>
          </ul>
        </details>
        <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[150px,1fr,1fr,auto]">
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {availableTypes.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t] || t}</option>)}
          </select>
          <input type="text" className="input" placeholder="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="input" onChange={(e) => setFile(e.target.files[0] || null)} />
          <Button type="submit" variant="secondary" loading={busy}>Add</Button>
        </form>
      </div>
    </div>
  );
}
