// "Loadbyton network" menu: the six domains with their status. Live and pilot
// domains link through /go/:key (which names the destination before leaving);
// planned ones are shown as "Coming soon" and never linked.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRANCHES, STATUS_LABEL, goPath, isLinkable } from '../../brand/ecosystem.js';

export default function EcosystemMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="eco-menu" ref={rootRef}>
      <button
        type="button"
        className="eco-menu-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="eco-menu-panel"
        onClick={() => setOpen((v) => !v)}
      >
        Loadbyton network
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="m2 4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul id="eco-menu-panel" className="eco-menu-panel">
          {BRANCHES.map((b) => {
            const body = (
              <>
                <span className="eco-dot" style={{ background: b.accent }} aria-hidden="true" />
                <span className="eco-menu-text">
                  <b>{b.descriptor}</b> <span className="eco-domain">{b.domain}</span>
                  <small>{b.name}</small>
                </span>
                <span className={`eco-status eco-status--${b.status}`}>{STATUS_LABEL[b.status]}</span>
              </>
            );
            if (b.key === 'freight') return <li key={b.key}><Link to="/" className="eco-item" aria-current="page" onClick={() => setOpen(false)}>{body}</Link></li>;
            return (
              <li key={b.key}>
                {isLinkable(b)
                  ? <Link to={goPath(b.key)} className="eco-item" onClick={() => setOpen(false)}>{body}</Link>
                  : <span className="eco-item eco-item--off" aria-disabled="true">{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
