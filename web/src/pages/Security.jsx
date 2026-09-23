// Ported from the design-tool export's pages/Marketing.jsx (SecurityPage).
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubCards, SubCta, PAGE, delay } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const BUILT = [
  { icon: 'Shield', title: 'Password storage', body: 'bcrypt, cost factor 10 — never plaintext, never reversible.' },
  { icon: 'Clock', title: 'Session security', body: 'HttpOnly, SameSite cookies; sessions are DB-backed and expire server-side, not just client-side.' },
  { icon: 'File', title: 'Field-level encryption', body: 'IBAN and TRN are encrypted at rest (AES-256-GCM), not stored as plain text alongside the rest of a profile.' },
  { icon: 'Layers', title: 'Role-based access, server-enforced', body: 'Every mutating route checks role and account status in the API — never a UI-only restriction a client could bypass.' },
  { icon: 'File', title: 'Append-only audit trail', body: 'Every award, payment status change, verification, and dispute decision is written to a log that database triggers hard-block from being edited or deleted, even by us.' },
  { icon: 'Compass', title: 'Rate limiting', body: 'Every API route is throttled per address, with tighter limits on authentication and job-posting/bidding endpoints.' },
  { icon: 'Shield', title: 'Security headers', body: 'Content-Security-Policy, X-Frame-Options, and related headers on every response.' },
  { icon: 'User', title: 'Multi-seat access control', body: 'Company accounts can scope employee access to Operations, Finance, or read-only — not one shared login and password.' },
].map((b) => ({ ...b, ok: true }));

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
    <SitePage>
      <SubHero kicker="SECURITY" title="What's actually implemented — not a marketing checklist." lede="Where something isn't done yet, it's listed as a roadmap item below — not implied as already in place." />
      <SubSection tone="cloud" no="01 / Built today" title="Verifiable in the repo, not asserted in a badge." copy="Every line below maps to code a reviewer can actually check.">
        <SubCards prefix="S" items={BUILT} cols={4} />
      </SubSection>
      <SubSection tone="paper" no="02 / Roadmap" title="Not yet complete — stated as such.">
        <div className="sub-roadmap">{ROADMAP.map((r, i) => <div key={r} className="mkt-reveal" style={delay(i * 60)}><i />{r}<span>ROADMAP</span></div>)}</div>
      </SubSection>
      <SubCta kicker="Responsible disclosure" title="Found a security issue?" body={<>Email <span className="mono">security@loadbyton.ae</span> — replace with a monitored inbox before this goes live; this address is a placeholder shipped with the page, not yet an active mailbox.</>} primary={['Read the compliance position', P.compliance]} secondary={['Back to the platform', P.home]} />
    </SitePage>
  );
}
