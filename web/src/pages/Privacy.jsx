import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';

const LAST_UPDATED = '2026-08-16';

export default function Privacy() {
  usePageTitle('Privacy Policy');
  useMeta('Loadbyton Privacy Policy — how we collect, use, protect, and share your personal data under UAE PDPL.');

  return (
    <div dir="ltr">
      <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-3xl">
            <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent)' }}>Legal</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">Privacy Policy</h1>
            <p className="mt-2 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
          </Reveal>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container-page max-w-3xl space-y-10">
          <Reveal>
            <h2 className="font-display text-xl font-semibold text-ink">1. Data Controller</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Loadbyton ("Company", "we", "us", "our") is the data controller for personal data processed through the Platform.
              Contact: <span className="font-mono">privacy@loadbyton.ae</span> (placeholder — replace with monitored inbox before launch).
            </p>
          </Reveal>

          <Reveal delay={60}>
            <h2 className="font-display text-xl font-semibold text-ink">2. Legal Basis (UAE PDPL)</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              We process personal data under the UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL).
              Our lawful bases are:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>Contract performance:</strong> Operating the marketplace, escrow, and payouts (Sections 3–5).</li>
              <li><strong>Legal obligation:</strong> VAT invoicing, anti-money laundering, record retention (Section 6).</li>
              <li><strong>Legitimate interest:</strong> Fraud prevention, security, analytics, platform improvement.</li>
              <li><strong>Consent:</strong> Optional marketing communications, AI document extraction (Section 7).</li>
            </ul>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="font-display text-xl font-semibold text-ink">3. Data We Collect</h2>
            <table className="mt-3 w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Fields</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold text-ink">Account</td>
                  <td className="px-3 py-2 text-ink-secondary">Email, password hash, role, referral code</td>
                  <td className="px-3 py-2 text-ink-secondary">Registration</td>
                  <td className="px-3 py-2 text-ink-secondary">Auth, identity, referral tracking</td>
                </tr>
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold text-ink">Profile</td>
                  <td className="px-3 py-2 text-ink-secondary">Company name, phone, TRN, trade licence, IBAN, coverage zones, fleet size, owned chassis, insurance flag</td>
                  <td className="px-3 py-2 text-ink-secondary">User input, AI scan (optional)</td>
                  <td className="px-3 py-2 text-ink-secondary">Verification, payouts, compliance, marketplace matching</td>
                </tr>
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold text-ink">Job Data</td>
                  <td className="px-3 py-2 text-ink-secondary">Equipment, route, schedule, budget, documents, messages, POD, ratings, GPS pins (optional)</td>
                  <td className="px-3 py-2 text-ink-secondary">Shipper/Carrier input</td>
                  <td className="px-3 py-2 text-ink-secondary">Marketplace execution, escrow, dispute resolution, analytics</td>
                </tr>
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold text-ink">Driver Data</td>
                  <td className="px-3 py-2 text-ink-secondary">Name, UAE mobile number</td>
                  <td className="px-3 py-2 text-ink-secondary">Carrier at bid / reassignment</td>
                  <td className="px-3 py-2 text-ink-secondary">Pickup/delivery coordination, WhatsApp/SMS notifications</td>
                </tr>
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 font-semibold text-ink">Technical</td>
                  <td className="px-3 py-2 text-ink-secondary">IP address, user agent, request IDs, session tokens, audit log entries</td>
                  <td className="px-3 py-2 text-ink-secondary">Automatic</td>
                  <td className="px-3 py-2 text-ink-secondary">Security, rate limiting, debugging, audit trail</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold text-ink">Notifications</td>
                  <td className="px-3 py-2 text-ink-secondary">Preferences (per-type opt-out), read status</td>
                  <td className="px-3 py-2 text-ink-secondary">User settings</td>
                  <td className="px-3 py-2 text-ink-secondary">Delivery of relevant alerts</td>
                </tr>
              </tbody>
            </table>
          </Reveal>

          <Reveal delay={180}>
            <h2 className="font-display text-xl font-semibold text-ink">4. Special Category Data</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>TRN (Tax Registration Number):</strong> Encrypted at rest (AES-256-GCM, <code className="px-1 rounded bg-surface-container-high font-mono text-xs">enc:v1:</code> prefix). Used for carrier verification and VAT invoicing.</li>
              <li><strong>IBAN:</strong> Encrypted at rest (AES-256-GCM). Used solely for Carrier payout destination.</li>
              <li><strong>Trade Licence Number:</strong> Stored in plaintext (not classified as sensitive under PDPL) for verification display.</li>
              <li>No biometric, health, or genetic data is collected.</li>
            </ul>
          </Reveal>

          <Reveal delay={240}>
            <h2 className="font-display text-xl font-semibold text-ink">5. Data Sharing & Recipients</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>Counterparty (on award):</strong> Shipper sees Carrier company name, rating, fleet; Carrier sees Shipper company name, rating. Phone, email, TRN, driver details revealed only after award.</li>
              <li><strong>Admins:</strong> Full access for verification, disputes, audit, impersonation (time-limited, audited).</li>
              <li><strong>Payment Processor:</strong> IBAN, company name, payout amount — only when initiating transfers.</li>
              <li><strong>WhatsApp (Meta):</strong> Driver name, job code, pickup terminal — only if WhatsApp integration is configured and user consents via notification prefs.</li>
              <li><strong>Email Provider (Resend):</strong> Email address, notification content — only for transactional emails.</li>
              <li><strong>AI Extraction (Puter.js):</strong> Document image bytes — processed client-side in the browser; Loadbyton never receives the image, only the extracted text you choose to submit.</li>
              <li><strong>Legal/Regulatory:</strong> Data disclosed only when required by UAE law or court order.</li>
            </ul>
          </Reveal>

          <Reveal delay={300}>
            <h2 className="font-display text-xl font-semibold text-ink">6. Retention & Deletion</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>Account & Profile:</strong> Retained while account is active. On deletion request: anonymized within 30 days per PDPL; financial records (invoices, payouts, audit log) retained for 5 years per UAE VAT/commercial law.</li>
              <li><strong>Job Data:</strong> Retained for 5 years from Job completion (commercial record). Disputed Jobs: retained until resolution + 5 years.</li>
              <li><strong>Audit Log:</strong> Append-only; never deleted. Immutable by DB trigger.</li>
              <li><strong>Session Tokens:</strong> Expire after 7 days; purged on server boot.</li>
              <li><strong>Notifications:</strong> Retained 90 days; read status updated in place.</li>
            </ul>
          </Reveal>

          <Reveal delay={360}>
            <h2 className="font-display text-xl font-semibold text-ink">7. Your Rights (PDPL)</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><strong>Access:</strong> Request a copy of your personal data.</li>
              <li><strong>Rectification:</strong> Correct inaccurate data (Profile page for most fields).</li>
              <li><strong>Erasure:</strong> Request deletion (subject to legal retention overrides above).</li>
              <li><strong>Restriction:</strong> Request processing restriction where accuracy is contested.</li>
              <li><strong>Portability:</strong> Receive your data in a structured, commonly used format (JSON export available on Profile).</li>
              <li><strong>Objection:</strong> Object to processing based on legitimate interest (marketing, analytics).</li>
              <li><strong>Automated Decisions:</strong> No solely automated decisions with legal/significant effect — all marketplace actions are human-initiated or rule-based with human override.</li>
            </ul>
            <p className="mt-3 text-sm text-ink-muted">
              Exercise rights by emailing <span className="font-mono">privacy@loadbyton.ae</span>. We respond within 30 days per PDPL.
            </p>
          </Reveal>

          <Reveal delay={420}>
            <h2 className="font-display text-xl font-semibold text-ink">8. Security Measures</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li>Passwords: bcrypt (cost 10), never logged.</li>
              <li>Sessions: HttpOnly, SameSite=Lax cookies; DB-backed; 7-day expiry.</li>
              <li>Field Encryption: IBAN & TRN encrypted at rest (AES-256-GCM); lazy upgrade on read.</li>
              <li>Transport: TLS in production (Render/Cloudflare); HSTS via security headers.</li>
              <li>Headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.</li>
              <li>Rate Limiting: Per-IP (API, auth, write); per-email login throttling (8/15min).</li>
              <li>Audit Trail: Append-only log of all state transitions (DB triggers block UPDATE/DELETE).</li>
              <li>Access Control: Role-based (SHIPPER/CARRIER/ADMIN) + seat roles (OPS/FINANCE/VIEWER) enforced server-side.</li>
            </ul>
          </Reveal>

          <Reveal delay={480}>
            <h2 className="font-display text-xl font-semibold text-ink">9. International Transfers</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Primary hosting: Render (Frankfurt, EU) or Oracle Cloud (Abu Dhabi, UAE) per deployment config.
              Payment processor & email provider may process data in their jurisdictions (EU/US).
              WhatsApp (Meta) processes data per their Data Processing Addendum.
              No personal data is transferred to inadequate jurisdictions without appropriate safeguards (SCCs/adequacy decisions).
            </p>
          </Reveal>

          <Reveal delay={540}>
            <h2 className="font-display text-xl font-semibold text-ink">10. Cookies & Local Storage</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-secondary pl-5 list-disc">
              <li><code className="px-1 rounded bg-surface-container-high font-mono text-xs">lb_session</code> (HttpOnly, Secure, SameSite=Lax) — session authentication.</li>
              <li><code className="px-1 rounded bg-surface-container-high font-mono text-xs">theme</code> (localStorage) — user's dark/light preference.</li>
              <li><code className="px-1 rounded bg-surface-container-high font-mono text-xs">locale</code> (localStorage) — user's language preference (en/ar).</li>
              <li>No third-party analytics/tracking cookies. No advertising cookies.</li>
            </ul>
          </Reveal>

          <Reveal delay={600}>
            <h2 className="font-display text-xl font-semibold text-ink">11. Children's Data</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              The Platform is not directed to individuals under 18. We do not knowingly collect data from minors.
              If a parent/guardian believes a minor has provided data, contact us for immediate deletion.
            </p>
          </Reveal>

          <Reveal delay={660}>
            <h2 className="font-display text-xl font-semibold text-ink">12. Changes to This Policy</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Material changes will be communicated via the Platform and/or email at least 30 days before taking effect.
              The "Last updated" date at the top reflects the most recent revision.
            </p>
          </Reveal>

          <Reveal delay={720}>
            <h2 className="font-display text-xl font-semibold text-ink">13. Contact</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
              Data Protection Officer (placeholder): <span className="font-mono">dpo@loadbyton.ae</span><br />
              General privacy inquiries: <span className="font-mono">privacy@loadbyton.ae</span><br />
              Postal: Loadbyton, [Registered Address — add before launch], UAE.
            </p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}