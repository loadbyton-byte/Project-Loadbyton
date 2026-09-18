import React from 'react';
import { useReveal } from '../lib/motion.js';
import { Reveal } from './Reveal.jsx';

// Shared "how it works" step sequence — Landing.jsx, ForShippers.jsx and
// ForTransporters.jsx each had the identical 4-step grid markup
// duplicated (only the step content and, on Landing, an icon box,
// differed), so the progress rail above the grid is written once here
// rather than three times.
//
// The rail fills once, in sync with the row scrolling into view — driven
// by the same useReveal() IntersectionObserver already used for the fade
// stagger on each step below it, not a separate per-step scroll tracker.
// An earlier version of this component tried to track scroll progress
// per step individually, but that doesn't mean anything for a horizontal
// row: all four steps sit at the same vertical scroll position, so they
// entered the viewport together regardless — a per-step high-water mark
// just snapped from 0 to 100% in one frame, tracking nothing real. This
// version doesn't claim more than it delivers: one entrance, one fill.
//
// Visual markup for each step stays owned by the caller (`renderStep`)
// since Landing's steps show a colored icon box above the number and the
// other two pages don't.
export function ScrollSteps({ steps, renderStep, className = '' }) {
  const { ref, visible } = useReveal();

  return (
    <div ref={ref} className={className}>
      <div className="scroll-steps-rail" aria-hidden="true">
        <span className={`scroll-steps-rail-fill ${visible ? 'is-filled' : ''}`} />
      </div>
      <div className="grid gap-8 md:grid-cols-4">
        {steps.map((step, i) => (
          <Reveal key={step.n} delay={i * 70}>{renderStep(step, i)}</Reveal>
        ))}
      </div>
    </div>
  );
}
