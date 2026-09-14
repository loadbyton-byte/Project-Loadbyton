import React from 'react';
import { IconCheck, IconMapPin, IconShield } from './icons.jsx';

// Hero visual — replaces the previous animated commercial-transaction
// diagram entirely. Product direction: no hero animation, no motion, no
// "instant matching" framing. This is a static, restrained illustration
// of the actual product moment that matters most to a first-time visitor:
// a shipper comparing real bids from transporters on a posted load. It is
// explicitly labelled as an example (not live data) — the numbers below
// are illustrative, not a fabricated real transaction. A deliberately
// UAE-wide route (Abu Dhabi to Sharjah), not a Dubai-only one.
const EXAMPLE_BIDS = [
  { name: 'Al Bahar Transport', priceAed: 2400, equipment: '40FT Flatbed', jobs: 98 },
  { name: 'Emirates Overland', priceAed: 2550, equipment: '40FT Flatbed', jobs: 143 },
  { name: 'Desert Line Haulage', priceAed: 2350, equipment: '40FT Flatbed', jobs: 67 },
];

export default function HeroLoadSnapshot() {
  return (
    <div className="hero-snapshot">
      <div className="hero-snapshot-route">
        <IconMapPin size={14} />
        <span>Khalifa Port, Abu Dhabi</span>
        <span className="hero-snapshot-route-arrow">&rarr;</span>
        <span>Sharjah Industrial Area</span>
      </div>

      <ul className="hero-snapshot-bids">
        {EXAMPLE_BIDS.map((bid) => (
          <li key={bid.name} className="hero-snapshot-bid">
            <div className="min-w-0">
              <p className="hero-snapshot-bid-name">
                {bid.name}
                <span className="hero-snapshot-bid-verified"><IconShield size={11} /> Verified</span>
              </p>
              <p className="hero-snapshot-bid-meta">{bid.equipment} &middot; {bid.jobs} completed jobs</p>
            </div>
            <p className="hero-snapshot-bid-price">AED {bid.priceAed.toLocaleString()}</p>
          </li>
        ))}
      </ul>

      <div className="hero-snapshot-action">
        <span className="hero-snapshot-action-label"><IconCheck size={13} /> Ready to compare and choose</span>
      </div>
    </div>
  );
}
