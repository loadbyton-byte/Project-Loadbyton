import React from 'react';
import { IconPackage, IconTruck, IconShield, IconCheck } from './icons.jsx';

// Hero visual — an animated "how Loadbyton works" pipeline: four stages
// (post job -> verified carriers bid -> escrow secured -> delivered & paid)
// light up one after another along a track, with a pulse traveling between
// them. Replaces the old truck-driving-at-dusk graphic: the job lifecycle
// is the product, so the hero shows the lifecycle instead of the vehicle.
// Kept inside its own dark card, using the same single accent color, so it
// reads as the one deliberately vivid moment rather than breaking the
// page's restraint elsewhere. Every motion is a CSS keyframe, so the global
// prefers-reduced-motion rule in index.css collapses it to a still frame.
const STAGES = [
  { Icon: IconPackage, label: 'Post the job' },
  { Icon: IconTruck, label: 'Carriers bid' },
  { Icon: IconShield, label: 'Escrow secured' },
  { Icon: IconCheck, label: 'Delivered & paid' },
];
const CYCLE_SECONDS = 8;

export default function FreightMotionScene() {
  return (
    <div className="freight-scene" role="img" aria-label="Animated workflow: post the job, carriers bid, escrow secured, delivered and paid">
      <div className="freight-scene-sky" aria-hidden="true">
        <div className="freight-scene-horizon" />
      </div>

      <div className="freight-pipeline" aria-hidden="true">
        <div className="freight-track">
          <div className="freight-track-line" />
          <div className="freight-pulse" />
        </div>
        {STAGES.map((s, i) => (
          <div key={s.label} className="freight-step" style={{ left: `${12.5 + i * 25}%`, animationDelay: `${(i * CYCLE_SECONDS) / STAGES.length - CYCLE_SECONDS}s`, animationDuration: `${CYCLE_SECONDS}s` }}>
            <span className="freight-step-node"><s.Icon size={16} /></span>
            <span className="freight-step-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}