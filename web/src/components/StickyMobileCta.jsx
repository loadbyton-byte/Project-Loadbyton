import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Mobile-only persistent conversion bar — appears once the hero (passed
// in via `heroRef`) has scrolled out of view, so it doesn't duplicate a
// CTA that's already visible on screen. Desktop keeps its CTA in the
// slim top header/hero at all times and has more screen real estate to
// spare, so this stays md:hidden.
//
// A real gap flagged in the earlier motion-design brief: "smooth
// section-to-section CTAs weren't added since none exist as a UX
// pattern here yet." This is that pattern — one shared component so
// each marketing page doesn't reimplement its own scroll listener.
export function StickyMobileCta({ heroRef, to, label }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [heroRef]);

  return (
    <div
      className={`sticky-mobile-cta md:hidden ${visible ? 'is-visible' : ''}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-hidden={!visible}
    >
      <Link to={to} tabIndex={visible ? 0 : -1} className="btn-accent w-full justify-center">
        {label}
      </Link>
    </div>
  );
}
