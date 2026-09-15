import React from 'react';

// A real photo behind marketing content, with a navy gradient doing the
// readability job the icon-only sections used to get for free (see
// index.css's .hero-media rule for why this is static, not animated —
// the "no hero motion" decision this rebrand is walking back was about
// motion specifically, not photography).
//
// overlay: 'dark' (full darken, for text centered over the whole image),
// 'side' (darker toward the start edge, for text in one column beside an
// otherwise-visible photo), or 'fade-bottom' (image fades into the page's
// own background at the bottom, for a hero band sitting above plain content).
export function MediaBackground({ src, alt = '', overlay = 'dark', className = '', style, children }) {
  return (
    <div className={`hero-media ${className}`} style={style}>
      <img className="hero-media__img" src={src} alt={alt} loading="lazy" />
      <div className={`hero-media__overlay hero-media__overlay--${overlay}`} aria-hidden="true" />
      {children}
    </div>
  );
}
