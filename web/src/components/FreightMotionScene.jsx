import React, { useEffect, useMemo, useState } from 'react';
import { IconLayers, IconUser, IconEdit, IconWallet, IconArrowLeft, IconArrowRight } from './icons.jsx';

// Hero visual — a simple auto-advancing slide deck explaining the platform:
// how it works -> how to register -> how to post a job -> how payout works.
// One slide at a time, a gentle fade/slide entrance, manual arrows and dots
// for anyone who wants to browse. No auto-advance under prefers-reduced-motion
// (the first slide stays put, arrows/dots still work). Kept inside its own
// dark card with the single accent color, so it reads as the one deliberately
// vivid moment rather than breaking the page's restraint elsewhere. The
// entrance is a single CSS keyframe, so the global prefers-reduced-motion
// rule collapses it to a static frame.
const SLIDES = [
  {
    Icon: IconLayers,
    title: 'How it works',
    intro: 'One sequence for every load — from posting to payout.',
    steps: [
      ['Post the job', 'Equipment, route, target price'],
      ['Carriers bid', 'Verified fleet, priced live'],
      ['Award & escrow', 'Price locks, funds secured'],
      ['Deliver & paid', 'POD up, payout within 48h'],
    ],
  },
  {
    Icon: IconUser,
    title: 'Register in minutes',
    intro: 'Create an account, get verified, start moving freight.',
    steps: [
      ['Create your account', 'Email and company details'],
      ['Get verified', 'TRN, licence, insurance — checked by us'],
      ['Start', 'Bid on loads or post jobs, escrow-backed'],
    ],
  },
  {
    Icon: IconEdit,
    title: 'Post a job',
    intro: 'One structured form — no back-and-forth to reach carriers.',
    steps: [
      ['Equipment & route', 'Truck class, terminal, delivery area'],
      ['Price & cargo', 'Target price per trip, cargo weight'],
      ['Submit', 'Goes live as OPEN — bids arrive within minutes'],
    ],
  },
  {
    Icon: IconWallet,
    title: 'Get paid fast',
    intro: 'Escrow holds the funds; release is automatic.',
    steps: [
      ['Deliver', 'Hand off and collect the POD'],
      ['Confirm', 'Shipper confirms, or 24h auto-release'],
      ['Payout', 'In your account within 48 hours'],
    ],
  },
];
const INTERVAL_MS = 6000;

export default function FreightMotionScene() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  useEffect(() => {
    if (prefersReduced || paused) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [prefersReduced, paused, index]);

  const slide = SLIDES[index];

  return (
    <div
      className="freight-deck"
      role="group"
      aria-roledescription="carousel"
      aria-label="How Loadbyton works"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="freight-deck-progress" aria-hidden="true">
        <div key={index} className="freight-deck-progress-fill" style={{ animationDuration: `${INTERVAL_MS}ms` }} />
      </div>

      <div key={index} className="freight-slide" aria-label={slide.title}>
        <div className="flex items-start gap-3">
          <span className="freight-slide-icon">
            <slide.Icon size={16} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-white">{slide.title}</p>
            <p className="mt-0.5 text-xs text-white/60">{slide.intro}</p>
          </div>
        </div>
        <ol className="freight-slide-steps">
          {slide.steps.map(([label, sub], i) => (
            <li key={label} className="freight-step-row">
              <span className="freight-step-num">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-white">{label}</span>
                <span className="block truncate text-[11px] text-white/50">{sub}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="freight-deck-controls">
        <div className="flex items-center gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`freight-dot${i === index ? ' freight-dot-active' : ''}`}
              aria-label={`Go to slide ${i + 1}: ${s.title}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="freight-nav"
            aria-label="Previous slide"
            onClick={() => setIndex((index - 1 + SLIDES.length) % SLIDES.length)}
          >
            <IconArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="freight-nav"
            aria-label="Next slide"
            onClick={() => setIndex((index + 1) % SLIDES.length)}
          >
            <IconArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}