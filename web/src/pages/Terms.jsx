import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';

const LAST_UPDATED = '2026-08-16';

export default function Terms() {
  usePageTitle('Terms of Service');
  useMeta('Loadbyton Terms of Service — governing your use of the UAE road freight & container drayage marketplace.');

  return (
    <div dir="ltr">
      <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-3xl">
            <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent)' }}>Legal</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">Terms of Service</h1>
            <p className="mt-2 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
          </Reveal>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container-page max-w-3xl space-y-10">
          <Reveal>
            <h2 className="font-display text-xl font-semibold text-ink">1. Agreement to Terms</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              By accessing or using Loadbyton (the "Platform"), you agree to be bound by these Terms of Service ("Terms").
              If you do not agree to these Terms, you may not use the Platform. These Terms form a legally binding
              agreement between you ("User", "Shipper", "Carrier", or "you") and Loadbyton ("Company", "we", "us", "our").
            </p>
          </Reveal>

          <Reveal delay={60}>
            <h2 className="font-display text-xl font-semibold text-ink">2. Definitions</h2>
            <dl className="mt-3 space-y-2 text-sm text-ink-secondary">
              <div><dt className="font-semibold text-ink">"Platform"</dt><dd>The Loadbyton web application, API, and associated services.</dd></div>
              <div><dt className="font-semibold text-ink">"Shipper"</dt><dd>A User who posts freight jobs on the Platform.</dd></div>
              <div><dt className="font-semibold text-ink">"Carrier"</dt><dd>A User who bids on and performs freight jobs on the Platform.</dd></div>
              <div><dt className="font-semibold text-ink">"Job"</dt><dd>A freight shipment posted by a Shipper and awarded to a Carrier.</dd></div>
              <div><dt className="font-semibold text-ink">"Escrow"</dt><dd>The holding of agreed funds by the Platform between award and release.</dd></div>
              <div><dt className="font-semibold text-ink">"Payout"</dt><dd>The transfer of net funds to a Carrier after a Job is completed.</dd></div>
            </dl>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="font-display text-xl font-semibold text-ink">3. Account Registration & Eligibility</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>You must be at least 18 years old and have the legal capacity to enter into contracts.</li>
              <li>You must provide accurate, complete, and current registration information.</li>
              <li>Carriers must complete verification (TRN, trade licence, insurance) before bidding. Unverified accounts cannot place bids.</li>
              <li>You are responsible for maintaining the confidentiality of your credentials and for all activity under your account.</li>
              <li>Multi-seat company accounts: the organization root owns all data; seats act on behalf of the organization with scoped permissions (OPS, FINANCE, VIEWER).</li>
            </ul>
          </Reveal>

          <Reveal delay={180}>
            <h2 className="font-display text-xl font-semibold text-ink">4. Marketplace Mechanics</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>Job Posting:</strong> Shippers post Jobs with equipment, route, schedule, and budget. Jobs enter <code className="px-1 rounded bg-surface-container-high font-mono text-xs">OPEN</code> status.</li>
              <li><strong>Bidding:</strong> Verified Carriers bid with price (AED) and ETA. Competitor bid amounts are masked until award.</li>
              <li><strong>Award:</strong> Shipper awards one bid. This creates a binding agreement: Job → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">AWARDED</code>, Escrow → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">HELD</code>, Payout row created with platform fee.</li>
              <li><strong>Status Progression:</strong> Carrier advances Job through <code className="px-1 rounded bg-surface-container-high font-mono text-xs">PICKED_UP</code> → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">IN_TRANSIT</code> → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">DELIVERED</code>. Each step is forward-only and audited.</li>
              <li><strong>Proof of Delivery (POD):</strong> Carrier uploads POD at <code className="px-1 rounded bg-surface-container-high font-mono text-xs">IN_TRANSIT</code> → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">DELIVERED</code>. This starts the auto-release clock.</li>
              <li><strong>Release:</strong> Shipper confirms delivery (manual release) or auto-release fires after the configured window (default 24h) from <code className="px-1 rounded bg-surface-container-high font-mono text-xs">delivered_at</code>. Escrow → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">RELEASED</code>, Payout → <code className="px-1 rounded bg-surface-container-high font-mono text-xs">RELEASED</code>.</li>
              <li><strong>Disputes:</strong> Either party may open a dispute on an awarded Job. Escrow freezes. Admin resolves with determination: release to Carrier, refund Shipper, or split.</li>
            </ul>
          </Reveal>

          <Reveal delay={240}>
            <h2 className="font-display text-xl font-semibold text-ink">5. Fees & Payments</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>The Platform charges a commission (take rate) on the agreed price at award. Default: 6% (600 basis points), adjustable by Admin (0–10000 bps).</li>
              <li>Gross = agreed price; Platform fee = round(gross × commission_bps / 10000); Net = gross − fee.</li>
              <li>Payouts are initiated upon release (manual, auto 24h, or dispute resolution). The Platform is not a licensed payment institution; funds move via integrated payment processors.</li>
              <li>VAT invoices for platform commission are generated automatically at release (UAE standard rate, tax-inclusive assumption).</li>
              <li>Shippers fund escrow before award. Carriers receive net payout after release. The Platform never holds freight amounts beyond the release window.</li>
            </ul>
          </Reveal>

          <Reveal delay={300}>
            <h2 className="font-display text-xl font-semibold text-ink">6. Carrier Verification & Obligations</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>Carriers must provide valid UAE TRN, trade licence, and insurance confirmation.</li>
              <li>Admin approval is required before a Carrier can bid. Approval includes IBAN capture for payout destination.</li>
              <li>Carriers warrant they hold all necessary permits, licenses, and insurance for the Jobs they perform.</li>
              <li>Driver identity: the assigned driver name and UAE mobile number are captured at bid and may be updated via audited reassignment before delivery.</li>
              <li>Carriers are responsible for cargo safety, timeliness, and compliance with UAE transport regulations.</li>
            </ul>
          </Reveal>

          <Reveal delay={360}>
            <h2 className="font-display text-xl font-semibold text-ink">7. Shipper Obligations</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>Shippers warrant Job details are accurate and they have authority to post the Job.</li>
              <li>Shippers must fund escrow promptly upon award. Failure to fund may result in Job cancellation.</li>
              <li>Shippers must confirm delivery or allow auto-release to proceed. Disputes must be raised in good faith.</li>
              <li>Shippers are responsible for customs documentation and cargo readiness at pickup.</li>
            </ul>
          </Reveal>

          <Reveal delay={420}>
            <h2 className="font-display text-xl font-semibold text-ink">8. Intellectual Property</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              The Platform, its design, code, branding (Loadbyton name, logo, mark), and content are owned by the Company.
              Users grant the Company a non-exclusive, royalty-free license to use, store, and display content they upload
              (documents, messages, POD) solely for Platform operations. Users retain ownership of their content.
            </p>
          </Reveal>

          <Reveal delay={480}>
            <h2 className="font-display text-xl font-semibold text-ink">9. Data & Privacy</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Personal data (company contacts, TRN, IBAN, driver details) is processed per the UAE Federal Decree-Law No. 45
              of 2021 (PDPL) and our <a href="/privacy" className="text-brand-secondary hover:underline">Privacy Policy</a>.
              IBAN and TRN are encrypted at rest (AES-256-GCM). Contact details are gated until award. Audit logs are append-only.
            </p>
          </Reveal>

          <Reveal delay={540}>
            <h2 className="font-display text-xl font-semibold text-ink">10. Disclaimers & Limitation of Liability</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>The Platform is provided "as is" and "as available" without warranties of any kind.</li>
              <li>The Company is not a party to the Shipper-Carrier contract; it provides the marketplace, escrow, and tools only.</li>
              <li>Liability for cargo loss, damage, delay, or disputes between Shipper and Carrier rests with the parties, not the Platform.</li>
              <li>The Company's aggregate liability shall not exceed the total fees paid by the User in the 12 months preceding the claim.</li>
              <li>No liability for indirect, consequential, or punitive damages.</li>
            </ul>
          </Reveal>

          <Reveal delay={600}>
            <h2 className="font-display text-xl font-semibold text-ink">11. Indemnification</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              You agree to indemnify and hold the Company harmless from any claims, damages, or expenses arising from your
              use of the Platform, your breach of these Terms, or your violation of any law or third-party rights.
            </p>
          </Reveal>

          <Reveal delay={660}>
            <h2 className="font-display text-xl font-semibold text-ink">12. Termination</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>You may close your account at any time. Active Jobs must be resolved first.</li>
              <li>The Company may suspend or terminate access for breach of these Terms, fraud, or illegal activity.</li>
              <li>Upon termination, your data is handled per the Privacy Policy and PDPL retention requirements.</li>
            </ul>
          </Reveal>

          <Reveal delay={720}>
            <h2 className="font-display text-xl font-semibold text-ink">13. Governing Law & Dispute Resolution</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              These Terms are governed by the laws of the United Arab Emirates. Disputes arising from these Terms shall be
              resolved in the competent courts of Dubai, UAE. The Platform's internal dispute process (Section 4) applies
              to Job-level disputes between Shipper and Carrier.
            </p>
          </Reveal>

          <Reveal delay={780}>
            <h2 className="font-display text-xl font-semibold text-ink">14. Changes to Terms</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              The Company may update these Terms at any time. Material changes will be communicated via the Platform and/or
              email at least 30 days before taking effect. Continued use after changes constitutes acceptance.
            </p>
          </Reveal>

          <Reveal delay={840}>
            <h2 className="font-display text-xl font-semibold text-ink">15. Contact</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Questions about these Terms: <span className="font-mono">legal@loadbyton.ae</span> (placeholder — replace with monitored inbox before launch).
            </p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}