import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import TermsContent, { TERMS_LAST_UPDATED } from './TermsContent.jsx';
import { IconClose } from './icons.jsx';

// Read-inline popup for the full Terms of Service — used wherever a form
// asks for agreement (job posting, signup) so agreeing never means leaving
// the form to a separate page and losing progress. z-modal-top so it stacks
// above a parent form modal (z-overlay) rather than behind it.
export default function TermsModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body> — same reasoning as ui.jsx's Modal: this is opened
  // from inside Dashboard's post-a-job form, a descendant of
  // operations-system.css's `.container-page` corp-enter entrance
  // animation, which keeps that ancestor acting as the containing block
  // for `position: fixed` children for as long as the animation effect
  // stays attached (fill-mode both never detaches it). Rendered inline,
  // this panel ended up centered within that ancestor's full scroll
  // height instead of the viewport.
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-modal-top flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Terms of Service"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="animate-slide-up flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <p className="font-display text-base font-bold text-ink">Terms of Service</p>
            <p className="text-xs text-ink-muted">Last updated: {TERMS_LAST_UPDATED}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-muted hover:bg-surface-container hover:text-ink" aria-label="Close">
            <IconClose size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-6">
          <TermsContent compact />
        </div>
        <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors"
            style={{ background: 'var(--brand-accent)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
