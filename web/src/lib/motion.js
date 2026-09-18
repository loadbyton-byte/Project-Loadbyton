import { useEffect, useRef, useState } from 'react';

// Zero-dependency scroll-reveal — an IntersectionObserver flips one class,
// the actual animation is a plain CSS transition (see .reveal/.reveal-visible
// in index.css). No GSAP: this repo's stated convention is "don't reach for
// a package where ~20 lines of stdlib/browser-API code does the job," and a
// fade+translateY reveal is exactly that. prefers-reduced-motion is already
// handled globally (index.css collapses all transition durations near-zero
// under that media query) — this hook doesn't need its own check.
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -80px 0px' } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browser, or a non-DOM environment
    // like build-time prerendering — see entry-server.jsx): show content
    // immediately rather than leaving it permanently at opacity:0.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, visible };
}

// True only for a pointer that can actually hover-and-track (a mouse/
// trackpad) — magnetic pull and spotlight-follow are both pointless (and,
// for magnetic pull, actively annoying — a translated hit target under a
// finger) on a touch screen, which has no continuous hover signal to drive
// them. Re-checked per call rather than cached at module scope so it still
// reflects a hybrid device (e.g. a touchscreen laptop) at the moment the
// hook runs, not whatever was true on first script load.
function hasFinePointer() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Magnetic CTA pull — the element nudges a few px toward the cursor inside
// its own bounds, then springs back on leave. `strength` is the max
// translation in px; deliberately small (the corporate/restrained motion
// direction this whole system follows, not a playful "chase the cursor"
// effect). No-ops entirely (returns a ref that's just... a ref) on touch
// devices and under prefers-reduced-motion, rather than degrading into a
// jumpy or absent effect — the button is always a real ::-target-sized hit
// area either way, this is purely a hover embellishment.
export function useMagnetic(strength = 8) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasFinePointer() || prefersReducedMotion()) return;

    const handleMove = (e) => {
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left - rect.width / 2;
      const relY = e.clientY - rect.top - rect.height / 2;
      const x = Math.max(-strength, Math.min(strength, relX / (rect.width / 2) * strength));
      const y = Math.max(-strength, Math.min(strength, relY / (rect.height / 2) * strength));
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    };
    const handleLeave = () => {
      el.style.transform = '';
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    // Matches .btn's own existing transition-[transform,...] timing (200ms
    // ease-out) rather than introducing a third timing function for the
    // same property on the same element — the spring-back on leave should
    // feel like part of that same button, not a separate motion system
    // bolted onto it.
    el.style.transition = `${el.style.transition ? el.style.transition + ', ' : ''}transform var(--motion-standard) var(--motion-ease)`;

    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [strength]);

  return ref;
}

// Cursor-follow spotlight — writes pointer position as --spot-x/--spot-y
// (in px, relative to the element) for the .card-spotlight CSS (index.css)
// to read as a radial-gradient center. No React state/re-render per
// mousemove (that would thrash the whole subtree at 60fps for a purely
// decorative effect) — the CSS custom property is written straight onto
// the DOM node. Same touch/reduced-motion no-op as useMagnetic above: a
// spotlight that can't follow a pointer is just a stray gradient, better
// left off entirely (the CSS's own default centers it if this never runs).
export function useSpotlight() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasFinePointer() || prefersReducedMotion()) return;

    const handleMove = (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    };

    el.addEventListener('mousemove', handleMove);
    return () => el.removeEventListener('mousemove', handleMove);
  }, []);

  return ref;
}
