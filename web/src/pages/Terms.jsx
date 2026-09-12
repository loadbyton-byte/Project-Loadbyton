import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import TermsContent, { TERMS_LAST_UPDATED as LAST_UPDATED } from '../components/TermsContent.jsx';

export default function Terms() {
  usePageTitle('Terms of Service');
  useMeta('Loadbyton Terms of Service — governing your use of the UAE road freight & container drayage marketplace.');

  return (
    <div dir="ltr">
      <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-3xl">
            <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent-on-tint)' }}>Legal</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">Terms of Service</h1>
            <p className="mt-2 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
          </Reveal>
        </div>
      </section>
      <TermsContent />
    </div>
  );
}
