import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconShield, IconMapPin, IconFile, IconInfo, IconArrowRight } from '../components/icons.jsx';

// Real PDPL principles, stated generally and accurately. Anything specific
// to THIS company (trade licence number, registered address, DPO contact)
// is a clearly marked placeholder — never a fabricated number. Filling
// those in is a business/legal step, not a code change. This pass is a
// presentation-only change — every sentence of legal text below is
// unchanged from before.

export default function Compliance() {
  usePageTitle('Compliance');
  useMeta('How Loadbyton handles personal data under UAE PDPL, VAT invoicing, and where account data is hosted.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />COMPLI<span>ANCE</span></p>
            <h1>Data protection, hosting, and invoicing — stated plainly.</h1>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / POSITION</span><h2>Three statements, no gloss.</h2></Reveal>
        <div style={{ marginTop: 48, maxWidth: 820 }}>
          <Reveal className="lb-doc">
            <div className="lb-doc-head">
              <span className="lb-doc-icon"><IconShield size={18} /></span>
              <h2>Data protection (UAE PDPL)</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-secondary">
              <p>
                Loadbyton processes personal data — company contacts, TRN, IBAN, driver names and phone numbers — under
                the principles of the UAE's Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL):
                data is collected for a stated purpose, kept only as long as that purpose requires, and protected with
                controls proportionate to its sensitivity (see the <a href="/security" className="text-brand-secondary hover:underline">Security</a> page for what that means technically —
                field-level encryption for IBAN/TRN specifically).
              </p>
              <p>
                Account holders can request a copy of their data, a correction, or deletion by contacting{' '}
                <span className="font-mono">privacy@loadbyton.ae</span> — a placeholder inbox to be staffed before this
                goes live, not yet active.
              </p>
            </div>
          </Reveal>

          <Reveal delay={60} className="lb-doc">
            <div className="lb-doc-head">
              <span className="lb-doc-icon"><IconMapPin size={18} /></span>
              <h2>Where data is hosted</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
              Hosting region depends on deployment configuration (see <span className="font-mono">render.yaml</span> and{' '}
              <span className="font-mono">deploy/oracle-cloud/</span> in the repository) — this is stated here rather than
              asserted as UAE-only, because it isn't universally true across every deployment yet. A government or
              regulated-industry counterparty that requires in-country hosting should confirm the specific deployment
              target before onboarding.
            </p>
          </Reveal>

          <Reveal delay={120} className="lb-doc">
            <div className="lb-doc-head">
              <span className="lb-doc-icon"><IconFile size={18} /></span>
              <h2>VAT invoicing</h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
              Platform commission is invoiced with a sequential invoice number and a VAT breakdown at the UAE standard
              rate, generated automatically when a payout releases. This does not cover the freight amount itself, which
              is a contract between shipper and carrier that Loadbyton is not a party to.
            </p>
          </Reveal>

          <Reveal delay={180} className="lb-doc">
            <div className="lb-doc-head">
              <span className="lb-doc-icon"><IconInfo size={18} /></span>
              <h2>Company details</h2>
            </div>
            <div className="mt-4 rounded border border-dashed p-4 text-sm text-ink-muted" style={{ borderColor: 'var(--border-strong)', borderRadius: 4 }}>
              <p>Trade licence number: <em>— add before publishing publicly —</em></p>
              <p className="mt-1">Registered address: <em>— add before publishing publicly —</em></p>
              <p className="mt-1">Free zone / mainland status: <em>— add before publishing publicly —</em></p>
            </div>
          </Reveal>
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">NEXT</span>
          <h2>Questions on the position?</h2>
          <p>Read how the platform is secured, or start with one load.</p>
          <div>
            <Link to="/security" className="btn-accent btn-shine">How security works <IconArrowRight size={18} /></Link>
            <Link to="/register" className="lb-quiet-link">Create an account</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
