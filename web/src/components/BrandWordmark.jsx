import React from 'react';

export default function BrandWordmark({ dark = false, className = '' }) {
  return (
    <img
      src={dark ? '/brand/logo-full-on-dark-transparent.svg' : '/brand/logo-full.svg'}
      alt="LOAD BY TON"
      className={className}
    />
  );
}
