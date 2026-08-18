import React from 'react';
import { IconPackage, IconTruck, IconShield, IconCheck } from './icons.jsx';

// Hero visual — an animated "how Loadbyton works" pipeline: a truck drives
// the route left-to-right, the four workflow stages (post job -> verified
// carriers bid -> escrow secured -> delivered & paid) light up one after
// another along a rail that fills with progress, and a glow pulse travels
// between them. The job lifecycle is the product, so the hero shows the
// lifecycle instead of a static vehicle. Kept inside its own dark card with
// the single accent color, so it reads as the one deliberately vivid moment
// rather than breaking the page's restraint elsewhere. Every motion is a CSS
// keyframe, so the global prefers-reduced-motion rule collapses the whole
// scene to a still frame.
const STAGES = [
  { Icon: IconPackage, label: 'Post the job', sub: 'Terminal → site' },
  { Icon: IconTruck, label: 'Carriers bid', sub: 'Verified fleet' },
  { Icon: IconShield, label: 'Escrow secured', sub: 'Funds held safely' },
  { Icon: IconCheck, label: 'Delivered & paid', sub: 'Payout within 48h' },
];
const CYCLE_SECONDS = 8;

export default function FreightMotionScene() {
  return (
    <div className="freight-scene" role="img" aria-label="Animated workflow: post the job, verified carriers bid, escrow secured, delivered and paid">
      <div className="freight-sky" aria-hidden="true">
        <div className="freight-glow freight-glow-a" />
        <div className="freight-glow freight-glow-b" />
      </div>
      <div className="freight-horizon" aria-hidden="true" />

      <div className="freight-pipeline" aria-hidden="true">
        <div className="freight-rail" />
        <div className="freight-rail-fill" />
        <div className="freight-pulse" />
        {STAGES.map((s, i) => (
          <div
            key={s.label}
            className="freight-step"
            style={{ left: `${12.5 + i * 25}%`, animationDelay: `${(i * CYCLE_SECONDS) / STAGES.length - CYCLE_SECONDS}s`, animationDuration: `${CYCLE_SECONDS}s` }}
          >
            <span className="freight-step-node">
              <s.Icon size={15} />
              <span className="freight-step-num">{i + 1}</span>
            </span>
            <span className="freight-step-label">
              {s.label}
              <span className="freight-step-sub">{s.sub}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="freight-truck" aria-hidden="true">
        <IconTruck size={18} />
      </div>

      <div className="freight-road" aria-hidden="true">
        <div className="freight-road-dashes" />
      </div>
    </div>
  );
}