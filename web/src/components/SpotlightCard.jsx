import React from 'react';
import { useSpotlight } from '../lib/motion.js';

// Thin wrapper around .card-spotlight (index.css) + useSpotlight()
// (lib/motion.js) — exists because these render inside a .map() over a
// data array (transporter cards, pricing tiers), and hooks can't be
// called conditionally or a variable number of times inside a loop in
// the parent component; a tiny component per card sidesteps that, since
// each card gets its own render/its own hook call.
export function SpotlightCard({ as: Tag = 'div', className = '', children, ...props }) {
  const ref = useSpotlight();
  return (
    <Tag ref={ref} className={`card-spotlight ${className}`} {...props}>
      {children}
    </Tag>
  );
}
