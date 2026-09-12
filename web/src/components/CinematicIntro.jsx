import React, { useEffect, useState } from 'react';

// First-visit-only brand moment on the homepage (brief §12) — the actual
// existing wordmark (never redrawn, never distorted: brand-guidelines.md
// §1 forbids both), a quiet full-screen navy frame, fade+scale in, then
// straight into the page underneath. ~2.6s total, well under the 5s hard
// cap, always skippable, always off under prefers-reduced-motion.
//
// Never shown to a crawler or during prerendering: sessionStorage and
// matchMedia are both absent under Node (scripts/prerender.mjs), so the
// initial-state check below evaluates to "already seen" there — no
// server/client markup mismatch to worry about, unlike Landing.jsx's
// hero-animation guard, which has to actively suppress a replay of
// something the prerendered HTML already played.
const STORAGE_KEY = 'loadbyton-intro-seen';
const VISIBLE_MS = 2200;
const EXIT_MS = 400;

function hasSeenIntro() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (private mode, blocked, etc.) — never let that
    // block the homepage; just skip the intro rather than risk it
    // reappearing every navigation or throwing.
    return true;
  }
}
function markIntroSeen() {
  try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch {}
}
function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export default function CinematicIntro() {
  const [visible, setVisible] = useState(() => !hasSeenIntro() && !prefersReducedMotion());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    markIntroSeen();
    const dismissTimer = setTimeout(() => setLeaving(true), VISIBLE_MS);
    return () => clearTimeout(dismissTimer);
  }, [visible]);

  useEffect(() => {
    if (!leaving) return;
    const removeTimer = setTimeout(() => setVisible(false), EXIT_MS);
    return () => clearTimeout(removeTimer);
  }, [leaving]);

  if (!visible) return null;

  return (
    <div className={`intro-overlay${leaving ? ' intro-overlay-leaving' : ''}`}>
      <img src="/brand/logo-full-on-dark.svg" alt="Loadbyton" className="intro-logo" />
      <button type="button" className="intro-skip" onClick={() => setLeaving(true)} autoFocus>
        Skip
      </button>
    </div>
  );
}
