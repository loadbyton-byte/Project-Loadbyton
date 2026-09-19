import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconShield, IconClock, IconFile, IconLayers, IconUser, IconCompass, IconCheck, IconAlert, IconArrowRight } from '../components/icons.jsx';

// TRUST SIGNAL, NOT A CLAIM SHEET: every line under "What's built today" is
// something a reviewer can verify against this repo (server/lib/*.js). The
// "Roadmap" section is deliberately dated-sounding and unfinished-looking —
// a vendor-risk questionnaire that finds an unearned "SOC 2 certified"
// badge trusts the vendor less, not more. Never promote an item from
// Roadmap to "built" here without it actually being true in the code — and
// that applies to this pass too: everything below is a presentation change,
// the text content is unchanged from before.

const BUILT = [
  { icon: <IconShield size={18} />, title: 'Password storage', detail: 'bcrypt, cost factor 10 — never plaintext, never reversible.' },
  { icon: <IconClock size={18} />, title: 'Session security', detail: 'HttpOnly, SameSite cookies; sessions are DB-backed and expire server-side, not just client-side.' },
  { icon: <IconFile size={18} />, title: 'Field-level encryption', detail: 'IBAN and TRN are encrypted at rest (AES-256-GCM), not stored as plain text alongside the rest of a profile.' },
  { icon: <IconLayers size={18} />, title: 'Role-based access, server-enforced', detail: 'Every mutating route checks role and account status in the API — never a UI-only restriction a client could bypass.' },
  { icon: <IconFile size={18} />, title: 'Append-only audit trail', detail: 'Every award, payment status change, verification, and dispute decision is written to a log that database triggers hard-block from being edited or deleted, even by us.' },
  { icon: <IconCompass size={18} />, title: 'Rate limiting', detail: 'Every API route is throttled per address, with tighter limits on authentication and job-posting/bidding endpoints.' },
  { icon: <IconShield size={18} />, title: 'Security headers', detail: 'Content-Security-Policy, X-Frame-Options, and related headers on every response.' },
  { icon: <IconUser size={18} />, title: 'Multi-seat access control', detail: 'Company accounts can scope employee access to Operations, Finance, or read-only — not one shared login and password.' },
];

const ROADMAP = [
  'Independent third-party penetration test',
  'SOC 2 Type II readiness assessment',
  'ISO 27001 readiness assessment',
  'Public responsible-disclosure / bug bounty program',
];

export default function Security() {
  usePageTitle('Security');
  useMeta('How Loadbyton protects account, financial, and shipment data — what is built today, and what is on the roadmap.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />SECU<span>RITY</span></p>
            <h1>What's actually implemented — not a marketing checklist.</h1>
            <p className="lb-hero-lede">
              Where something isn't done yet, it's listed as a roadmap item below — not implied as already in place.
            </p>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / BUILT TODAY</span><h2>Verifiable in the repo, not asserted in a badge.</h2><p>Every line below maps to code a reviewer can actually check.</p></Reveal>
        <div className="lb-item-grid">
          {BUILT.map((item, i) => (
            <Reveal key={item.title} delay={(i % 3) * 60} className="lb-item">
              <div className="lb-item-top"><span>S-{String(i + 1).padStart(2, '0')}</span>{item.icon}</div>
              <h3 style={{ marginTop: 40, fontSize: 19 }}>{item.title} <IconCheck size={13} style={{ color: 'var(--status-success)', verticalAlign: 'baseline' }} /></h3>
              <p>{item.detail}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / ROADMAP</span><h2>Not yet complete — stated as such.</h2></Reveal>
        <div style={{ marginTop: 40, maxWidth: 720 }}>
          {ROADMAP.map((item, i) => (
            <Reveal key={item} delay={i * 60} className="lb-doc" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}>
              <p style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: 'var(--text-primary)' }}>
                <span style={{ marginTop: 6, width: 7, height: 7, flexShrink: 0, borderRadius: '50%', background: 'var(--status-warning)' }} />
                {item}
              </p>
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">RESPONSIBLE DISCLOSURE</span>
          <h2>Found a security issue?</h2>
          <p>Email <span className="font-mono">security@loadbyton.ae</span> — replace with a monitored inbox before this goes live; this address is a placeholder shipped with the page, not yet an active mailbox.</p>
          <div>
            <Link to="/compliance" className="btn-accent btn-shine">Read the compliance position <IconArrowRight size={18} /></Link>
            <Link to="/" className="lb-quiet-link">Back to the platform</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
