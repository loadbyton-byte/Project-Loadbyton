import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { uploadFile } from '../lib/upload.js';
import { Button } from './ui.jsx';
export function EirChecklist({ jobId, onDone }){
  const [files,setFiles]=useState([null,null,null]);
  const labels=['Container Seal','Right Side','Left Side'];
  async function submit(){
    const photos=[];
    for(let i=0;i<3;i++){
      const f=files[i];
      if(!f) return alert(`Photo ${i+1} (${labels[i]}) required`);
      // Reuses the job-documents upload-url endpoint — same job-scoped
      // prefix and party check as every other document attached to this job.
      const uploaded = await uploadFile(f, (mimeType) => api.getJobDocumentUploadUrl(jobId, mimeType));
      photos.push(uploaded);
    }
    await api.postEir(jobId, photos);
    onDone?.();
  }
  return (
    <div className="space-y-3 rounded-lg border p-4" style={{borderColor:'var(--border-default)'}}>
      <p className="text-sm font-semibold text-ink">EIR — 3-photo proof (unalterable ledger)</p>
      {labels.map((l,i)=>(
        <div key={l}>
          <label className="text-xs font-medium text-ink-secondary">{i+1}. {l}</label>
          <input type="file" accept="image/*" onChange={e=>{ const a=[...files]; a[i]=e.target.files[0]||null; setFiles(a); }} className="mt-1 block w-full text-sm" />
        </div>
      ))}
      <Button onClick={submit} className="w-full">Submit EIR</Button>
    </div>
  );
}
