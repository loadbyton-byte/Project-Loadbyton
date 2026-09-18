import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import TermsContent, { TERMS_LAST_UPDATED as LAST_UPDATED } from '../components/TermsContent.jsx';

export default function Terms() {
  usePageTitle('Terms of Service');
  useMeta('Loadbyton Terms of Service — governing your use of the UAE road freight & container drayage marketplace.');

  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner" style={{ paddingTop: 72, paddingBottom: 56 }}>
          <Reveal>
            <p className="lb-kicker"><i />LE<span>GAL</span></p>
            <h1>Terms of Service</h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,.55)' }}>Last updated: {LAST_UPDATED}</p>
          </Reveal>
        </div></div>
      </section>
      <TermsContent />
    </div>
  );
}
