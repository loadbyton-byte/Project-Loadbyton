import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { Button } from './ui.jsx';
export function EirChecklist({ jobId, onDone }){
  const [files,setFiles]=useState([null,null,null]);
  const labels=['Container Seal','Right Side','Left Side'];
  async function submit(){
    const photos=[];
    for(let i=0;i<3;i++){
      const f=files[i];
      if(!f) return alert(`Photo ${i+1} (${labels[i]}) required`);
      const b64=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.onerror=rej; r.readAsDataURL(f); });
      photos.push({ fileBase64: b64, mimeType: f.type||'image/jpeg' });
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
