import React from 'react';
import { IconPackage, IconSearch, IconTag, IconHandshake, IconTruck, IconMapPin, IconCheck, IconWallet } from './icons.jsx';

// Hero visual — a looping diagram of a shipment's commercial lifecycle: a
// load is posted, the platform matches it against candidate carriers,
// terms are agreed, the shipment moves, delivery is confirmed, and the
// transaction settles. The truck is one participant on the route, not the
// subject. First pass (flat lines, flat color, no depth) read as a wireframe
// rather than a premium product moment, so this version adds cinematic
// lighting on top of the same underlying state machine: a vignette
// background, soft glow/bloom on every accent-colored element (SVG
// feGaussianBlur, not a CSS box-shadow — cheap, GPU-friendly, no layout
// impact), a gently curved route instead of a straight line, and this
// site's own signature "premium" easing curve (cubic-bezier(0.16,1,.3,1) —
// see .animate-hero-in in index.css) for the vehicle and reveals, instead
// of generic ease-in-out. Still plain SVG + CSS keyframes — no animation
// library, no JS timers.
//
// CYCLE_SECONDS sets the shared --hs-cycle duration every .hs-* rule in
// index.css animates against. Each caption has its OWN dedicated keyframe
// (.hs-chip-1 .. .hs-chip-8) hand-timed to the SAME narrative percentages
// as the network/route/vehicle rules — see the "Hero scene timeline" table
// in index.css. A shared keyframe with per-chip animation-delay spacing was
// tried first and drifted out of sync with the SVG's uneven phase lengths
// (transit is a third of the cycle, "Agreed" is a beat) — don't go back.
const CYCLE_SECONDS = 20;

const STAGES = [
  { Icon: IconPackage, label: 'Load posted' },
  { Icon: IconSearch, label: 'Matching carriers' },
  { Icon: IconTag, label: 'Quote received' },
  { Icon: IconHandshake, label: 'Agreed' },
  { Icon: IconTruck, label: 'In transit' },
  { Icon: IconMapPin, label: 'Approaching destination' },
  { Icon: IconCheck, label: 'Delivered' },
  { Icon: IconWallet, label: 'Settled' },
];

// Route is a gentle arc from the origin node to the destination node (a
// flat ruler-straight line read as a wireframe, not a journey) — the
// matching cluster (junction + 3 carrier candidates) sits above it and is
// only relevant before the shipment departs. The vehicle's keyframe (in
// index.css) approximates the same arc with a 3-point translate (start /
// apex / end) rather than true path-following (offset-path), which is
// simpler and has no browser-support gap.
const ORIGIN_X = 40;
const DEST_X = 360;
const ROUTE_Y = 150;
const ARC_Y = 122;
const JUNCTION_X = 170;
// Overshoots the curve's true length on purpose — a single dash longer
// than the visible path still reads as "fully hidden" at max offset and
// "fully drawn" at offset 0, so an approximate value is safe here.
const ROUTE_DASH_LENGTH = 340;

export default function FreightMotionScene() {
  return (
    <div className="hero-scene" style={{ '--hs-cycle': `${CYCLE_SECONDS}s` }}>
      <svg
        viewBox="0 0 400 200"
        className="hero-scene-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Animated diagram of a shipment's commercial lifecycle: a load is posted, the platform matches it against candidate carriers, terms are agreed, the shipment moves to its destination, delivery is confirmed, and the transaction settles"
      >
        <defs>
          <radialGradient id="hs-bg-glow" cx="50%" cy="38%" r="75%">
            <stop offset="0%" stopColor="#1c2d44" />
            <stop offset="55%" stopColor="#0f1c2e" />
            <stop offset="100%" stopColor="#0a1420" />
          </radialGradient>
          <radialGradient id="hs-arrival-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--lb-orange-500)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--lb-orange-500)" stopOpacity="0" />
          </radialGradient>
          <filter id="hs-blur-sm" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="hs-blur-md" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <rect x="0" y="0" width="400" height="200" fill="url(#hs-bg-glow)" />
        <ellipse className="hs-arrival-glow" cx={DEST_X} cy={ROUTE_Y - 10} rx="70" ry="46" fill="url(#hs-arrival-glow)" filter="url(#hs-blur-md)" />

        {/* Matching cluster — junction plus three candidate carriers. Fades
            out once a carrier is selected and the shipment departs, so it
            doesn't compete with the route for attention during transit. */}
        <g className="hs-network">
          <line className="hs-line-reject" x1={JUNCTION_X} y1={ROUTE_Y} x2="120" y2="70" />
          <line className="hs-line-select" x1={JUNCTION_X} y1={ROUTE_Y} x2="170" y2="48" />
          <line className="hs-line-reject" x1={JUNCTION_X} y1={ROUTE_Y} x2="220" y2="70" />

          <circle className="hs-carrier hs-carrier-reject" cx="120" cy="70" r="7" />
          <circle className="hs-carrier hs-carrier-select" cx="170" cy="48" r="8" />
          <circle className="hs-carrier hs-carrier-reject" cx="220" cy="70" r="7" />

          <circle className="hs-junction" cx={JUNCTION_X} cy={ROUTE_Y} r="4" />
        </g>

        {/* Route — a soft blurred glow copy beneath a crisp line on top,
            both hidden until the shipment departs, drawn left-to-right as
            it travels, held complete through delivery/settlement, then
            reset to hidden while invisible (never an on-screen rewind). */}
        <path
          className="hs-route hs-route-glow"
          d={`M${ORIGIN_X},${ROUTE_Y} Q200,${ARC_Y} ${DEST_X},${ROUTE_Y}`}
          strokeDasharray={ROUTE_DASH_LENGTH}
          filter="url(#hs-blur-sm)"
        />
        <path
          className="hs-route"
          d={`M${ORIGIN_X},${ROUTE_Y} Q200,${ARC_Y} ${DEST_X},${ROUTE_Y}`}
          strokeDasharray={ROUTE_DASH_LENGTH}
        />

        {/* Origin — a soft glow halo behind the crisp node. */}
        <circle className="hs-origin hs-node-halo" cx={ORIGIN_X} cy={ROUTE_Y} r="16" filter="url(#hs-blur-md)" />
        <g className="hs-origin">
          <circle className="hs-node-ring" cx={ORIGIN_X} cy={ROUTE_Y} r="12" />
          <circle className="hs-node-dot" cx={ORIGIN_X} cy={ROUTE_Y} r="5" />
        </g>
        <g style={{ transform: `translate(${ORIGIN_X}px, ${ROUTE_Y - 26}px)`, transformBox: 'view-box' }}>
          <g className="hs-load-icon">
            <rect x="-8" y="-8" width="16" height="16" rx="2" />
          </g>
        </g>

        {/* Destination — same glow treatment, sitting inside the arrival
            glow's warm pool of light. */}
        <circle className="hs-destination hs-node-halo" cx={DEST_X} cy={ROUTE_Y} r="16" filter="url(#hs-blur-md)" />
        <g className="hs-destination">
          <circle className="hs-node-ring" cx={DEST_X} cy={ROUTE_Y} r="12" />
          <circle className="hs-node-dot" cx={DEST_X} cy={ROUTE_Y} r="5" />
        </g>
        <g style={{ transform: `translate(${DEST_X}px, ${ROUTE_Y - 26}px)`, transformBox: 'view-box' }}>
          <g className="hs-checkmark">
            <circle r="12" className="hs-checkmark-halo" filter="url(#hs-blur-md)" />
            <circle r="9" className="hs-checkmark-badge" />
            <path d="M-4,0 L-1,3.2 L4.5,-4" className="hs-checkmark-mark" />
          </g>
        </g>

        {/* Vehicle — travels the arc once a carrier is agreed; not the hero
            of the scene, just the participant that makes the movement
            visible. A trailing glow and ground shadow give it presence
            without turning it into the subject. */}
        <g className="hs-vehicle">
          <ellipse className="hs-vehicle-shadow" cx="0" cy="12" rx="19" ry="3.2" />
          <ellipse className="hs-vehicle-trail" cx="-22" cy="2" rx="16" ry="6" filter="url(#hs-blur-md)" />
          <g className="hs-wheel" style={{ transformOrigin: '-10px 10px' }}>
            <circle cx="-10" cy="10" r="4.5" />
          </g>
          <g className="hs-wheel" style={{ transformOrigin: '11px 10px' }}>
            <circle cx="11" cy="10" r="4.5" />
          </g>
          <rect x="-20" y="-6" width="30" height="16" rx="2" className="hs-vehicle-body" />
          <path d="M10,-6 h9 l6,8 v8 h-15 Z" className="hs-vehicle-cab" />
          <rect x="13" y="-3" width="9" height="7" rx="1" className="hs-vehicle-glass" />
          <circle className="hs-vehicle-headlight" cx="25" cy="6" r="2.6" filter="url(#hs-blur-sm)" />
        </g>
      </svg>

      <div className="hero-scene-chips" aria-hidden="true">
        {STAGES.map((s, i) => (
          <div key={s.label} className={`hero-scene-chip hs-chip-${i + 1}`}>
            <s.Icon size={14} /> {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
