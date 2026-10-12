import React from 'react';
import { LOGO_FOR_DARK_BG, LOGO_FOR_LIGHT_BG, LOGO_WORDMARK_SIZE } from '../lib/brand.js';

// The one place the Loadbyton wordmark is rendered. `dark` = the surface behind
// it is dark (sidebar, footer, auth panel) so the white-lettered version is used.
export default function BrandWordmark({ dark = false, className = '' }) {
  return (
    <img
      src={dark ? LOGO_FOR_DARK_BG : LOGO_FOR_LIGHT_BG}
      alt="Loadbyton"
      width={LOGO_WORDMARK_SIZE.width}
      height={LOGO_WORDMARK_SIZE.height}
      className={className}
      decoding="async"
    />
  );
}
