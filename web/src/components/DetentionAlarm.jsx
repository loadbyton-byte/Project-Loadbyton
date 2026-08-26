import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
export function DetentionAlarm({ jobId }){
  const [d,setD]=useState(null);
  useEffect(()=>{ api.getDetention(jobId).then(setD).catch(()=>{}); },[jobId]);
  if(!d) return null;
  if(!d.alarm) return <p className="text-xs text-ink-muted">Free days: {d.freeDays} · rate AED {d.rateAed}/day · {d.daysLeft} days left</p>;
  return <div className="rounded-md px-3 py-2 text-sm" style={{background:'var(--status-danger-bg)', color:'var(--status-danger)'}}>⚠️ Detention in {d.daysLeft} day(s) — return empty to avoid AED {d.rateAed}/day</div>;
}
