import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Lets a page declare the shell's floating action button (Stitch's "post a
// job" / "+" pattern) without prop-drilling through App.jsx's route table.
// Only rendered where a page actually calls usePageFab — most pages (Login,
// Admin, JobDetail…) never do, so the FAB stays absent there.
const FabContext = createContext(null);

export function FabProvider({ children }) {
  const [fab, setFab] = useState(null);
  return <FabContext.Provider value={{ fab, setFab }}>{children}</FabContext.Provider>;
}

// cfg: { icon, label, to } | { icon, label, onClick } | null. Clears on
// unmount so navigating away removes the FAB instead of leaking it onto
// whatever page renders next.
export function usePageFab(cfg) {
  const ctx = useContext(FabContext);
  useEffect(() => {
    ctx.setFab(cfg || null);
    return () => ctx.setFab(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.label, cfg?.to, cfg?.icon]);
}

export function Fab() {
  const ctx = useContext(FabContext);
  const fab = ctx?.fab;
  if (!fab) return null;
  const commonProps = {
    'aria-label': fab.label,
    title: fab.label,
    className:
      'fixed z-40 flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5 active:scale-95',
    style: { background: 'var(--brand-accent)', color: 'var(--text-on-accent)', boxShadow: 'var(--lb-shadow-elevated)', bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))', right: '20px' },
  };
  if (fab.to) {
    return <Link to={fab.to} {...commonProps}>{fab.icon}</Link>;
  }
  return (
    <button type="button" onClick={fab.onClick} {...commonProps}>
      {fab.icon}
    </button>
  );
}
