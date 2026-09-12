import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Modal, StatusBadge } from './ui.jsx';
import { IconSearch, IconArrowRight } from './icons.jsx';

// Cmd/Ctrl+K quick nav + job search (brief §44), deliberately narrow v1
// scope: role-aware navigation (navItems — the exact same list ShellInner
// already computed for the sidebar/drawer, passed in as a prop rather
// than recomputed) plus a job-code/address search. The search is a UI
// layer over GET /api/jobs?q=..., the same already-authorized,
// already-role-scoped endpoint OpenLoads.jsx/Dashboard.jsx's own search
// boxes call (server/services/job.service.js's listJobs is fail-closed
// per role) — no new authorization surface, no new backend endpoint.
// Reuses the Phase 0-hardened Modal (focus trap, Escape, focus restore)
// rather than a bespoke dialog.
export default function CommandPalette({ navItems }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [jobResults, setJobResults] = useState([]);
  const [highlighted, setHighlighted] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    // Also openable by click (Shell.jsx's visible "⌘K" hint button) — the
    // shortcut alone has zero discoverability for anyone who doesn't
    // already know it's there, and doesn't exist at all on a touch device.
    // A DOM CustomEvent rather than lifting `open` into ShellInner's own
    // state — this component stays fully self-contained either way.
    function onOpenEvent() {
      setOpen(true);
    }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('command-palette:open', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('command-palette:open', onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setJobResults([]);
      setHighlighted(0);
    }
  }, [open]);

  // Debounced — matches the exact pattern OpenLoads.jsx/Dashboard.jsx's
  // own search boxes already use, not a new convention.
  useEffect(() => {
    if (query.trim().length < 2) {
      setJobResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.listJobs({ q: query.trim(), limit: 5 }).then((d) => setJobResults(d.jobs || [])).catch(() => setJobResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = navItems || [];
    if (!q) return items.slice(0, 6);
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [navItems, query]);

  const results = useMemo(
    () => [
      ...navMatches.map((item) => ({ kind: 'nav', key: item.to, label: item.label, icon: item.icon, to: item.to })),
      ...jobResults.map((j) => ({ kind: 'job', key: `job-${j.id}`, label: j.job_code, status: j.status, to: `/jobs/${j.id}` })),
    ],
    [navMatches, jobResults]
  );

  useEffect(() => {
    setHighlighted(0);
  }, [results.length]);

  function select(result) {
    if (!result) return;
    setOpen(false);
    navigate(result.to);
  }

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(results[highlighted]);
    }
  }

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Jump to">
      <div className="relative">
        <IconSearch size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search pages, or a job code…"
          className="input w-full ps-9"
          autoFocus
        />
      </div>
      <div className="mt-3 max-h-80 overflow-y-auto">
        {results.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-muted">
            {query.trim().length >= 2 ? 'No matches.' : 'Type to search pages or a job code.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {results.map((r, i) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => select(r)}
                  onMouseEnter={() => setHighlighted(i)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start text-sm font-medium"
                  style={{ background: i === highlighted ? 'var(--surface-container)' : undefined, color: 'var(--text-primary)' }}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    {r.kind === 'nav' ? r.icon : <IconArrowRight size={16} className="text-ink-muted" />}
                    {r.label}
                  </span>
                  {r.kind === 'job' && <StatusBadge status={r.status} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
