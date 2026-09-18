import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { IconCheck, IconMapPin, IconShield, IconClock } from './icons.jsx';

// Hero visual v2 — replaces HeroLoadSnapshot.jsx (a single static bid-
// comparison card). Product direction as of this pass: hero motion is back
// in scope (superseding PR #105's "hero must have zero animation"), but the
// lessons from what was rejected before still apply — no bounce/elastic
// easing, no glow/neon, no "instant matching" framing, and a real
// reduced-motion fallback rather than degrading into something half-broken.
//
// The four panels ARE the same "One system. Zero chasing." sequence already
// on this page below the fold (Post the job / Transporters bid / Agree the
// terms / Deliver & release) — this previews the real product narrative
// instead of inventing new hero-only marketing copy, and follows one
// concrete example (Khalifa Port -> Sharjah, Desert Line Haulage winning
// the bid) all the way through, matching the "not a diagram, a real
// example" thesis of the section right below it.
const EXAMPLE_BIDS = [
  { name: 'Al Bahar Transport', priceAed: 2400, jobs: 98 },
  { name: 'Emirates Overland', priceAed: 2550, jobs: 143 },
  { name: 'Desert Line Haulage', priceAed: 2350, jobs: 67 },
];
const WINNER = EXAMPLE_BIDS[2];

const STEPS = [
  { key: 'post', label: 'Post the job', icon: IconMapPin },
  { key: 'bid', label: 'Transporters bid', icon: IconShield },
  { key: 'agree', label: 'Agree the terms', icon: IconCheck },
  { key: 'deliver', label: 'Deliver & release', icon: IconClock },
];

const STEP_MS = 4200;

function PostPanel() {
  return (
    <div className="hero-narrative-panel-body">
      <div className="hero-snapshot-route">
        <IconMapPin size={14} />
        <span>Khalifa Port, Abu Dhabi</span>
        <span className="hero-snapshot-route-arrow">&rarr;</span>
        <span>Sharjah Industrial Area</span>
      </div>
      <dl className="hero-narrative-fields">
        <div><dt>Equipment</dt><dd>40FT Flatbed</dd></div>
        <div><dt>Deadline</dt><dd>Today, 18:00</dd></div>
        <div><dt>Target price</dt><dd>AED 2,400</dd></div>
      </dl>
    </div>
  );
}

function BidPanel() {
  return (
    <ul className="hero-snapshot-bids">
      {EXAMPLE_BIDS.map((bid) => (
        <li key={bid.name} className="hero-snapshot-bid">
          <div className="min-w-0">
            <p className="hero-snapshot-bid-name">
              {bid.name}
              <span className="hero-snapshot-bid-verified"><IconShield size={11} /> Verified</span>
            </p>
            <p className="hero-snapshot-bid-meta">40FT Flatbed &middot; {bid.jobs} completed jobs</p>
          </div>
          <p className="hero-snapshot-bid-price">AED {bid.priceAed.toLocaleString()}</p>
        </li>
      ))}
    </ul>
  );
}

function AgreePanel() {
  return (
    <div className="hero-narrative-panel-body">
      <div className="hero-snapshot-bid hero-snapshot-bid--awarded">
        <div className="min-w-0">
          <p className="hero-snapshot-bid-name">
            {WINNER.name}
            <span className="hero-narrative-badge">Awarded</span>
          </p>
          <p className="hero-snapshot-bid-meta">40FT Flatbed &middot; {WINNER.jobs} completed jobs</p>
        </div>
        <p className="hero-snapshot-bid-price">AED {WINNER.priceAed.toLocaleString()}</p>
      </div>
      <p className="hero-narrative-note"><IconShield size={12} /> Payment held for the transport — no invoice to chase.</p>
    </div>
  );
}

function DeliverPanel() {
  return (
    <div className="hero-narrative-panel-body">
      <div className="hero-snapshot-bid hero-snapshot-bid--awarded">
        <div className="min-w-0">
          <p className="hero-snapshot-bid-name">
            {WINNER.name}
            <span className="hero-narrative-badge hero-narrative-badge--success"><IconCheck size={11} /> Delivered</span>
          </p>
          <p className="hero-snapshot-bid-meta">POD confirmed &middot; Sharjah Industrial Area</p>
        </div>
        <p className="hero-snapshot-bid-price">AED {WINNER.priceAed.toLocaleString()}</p>
      </div>
      <p className="hero-narrative-note"><IconCheck size={12} /> Payment released — auto-release in 24h if not confirmed sooner.</p>
    </div>
  );
}

const PANELS = [PostPanel, BidPanel, AgreePanel, DeliverPanel];

export default function HeroNarrative() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const timerRef = useRef(null);

  useEffect(() => {
    if (paused || reducedMotion) return undefined;
    timerRef.current = window.setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearInterval(timerRef.current);
  }, [paused, reducedMotion]);

  const goTo = useCallback((i) => setActive(i), []);

  const ActivePanel = PANELS[active];

  return (
    <div
      className="hero-snapshot"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="hero-narrative-label">
        {/* aria-live so a screen-reader user hears the step change without
            the whole card needing to be re-announced — polite, not
            assertive, since this is decorative narrative, not an alert. */}
        <span aria-live="polite">{STEPS[active].label}</span>
      </div>

      <div className="hero-narrative-stage">
        <div key={active} className="hero-narrative-panel">
          <ActivePanel />
        </div>
      </div>

      <div
        className={`hero-narrative-steps ${paused ? 'is-paused' : ''}`}
        style={{ '--step-ms': `${STEP_MS}ms` }}
        role="tablist"
        aria-label="Transaction stages"
      >
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={step.label}
            className={`hero-narrative-step ${i === active ? 'hero-narrative-step--active' : ''}`}
            onClick={() => goTo(i)}
          >
            <step.icon size={13} />
            <span className="hero-narrative-step-track"><span /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
