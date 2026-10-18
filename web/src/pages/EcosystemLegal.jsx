import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';

// Written 18 Oct 2026 for the single UAE company that operates loadbyton.com
// and loadbyton.store. Shown with a draft notice until VITE_LEGAL_REVIEWED=true,
// because commercial publication needs a qualified UAE lawyer's review.
export const ECOSYSTEM_LEGAL_VERSION = '2026-10-18';
const REVIEWED = import.meta.env.VITE_LEGAL_REVIEWED === 'true';

const H = ({ children }) => <h2 className="font-display text-xl font-semibold text-ink">{children}</h2>;
const Pp = ({ children }) => <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{children}</p>;
const Ul = ({ items }) => <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-secondary">{items.map((i) => <li key={i}>{i}</li>)}</ul>;

const DOCS = {
  premium: {
    title: 'Premium Membership Terms',
    meta: 'Terms for the Loadbyton Premium membership: price, VAT, renewal, cancellation, grace period and refunds.',
    body: (<>
      <H>1. What Premium is</H>
      <Pp>Premium is a paid company membership on loadbyton.com. While it is active, your company's Business OS workspace on loadbyton.store receives the Enterprise Included plan instead of Starter Included. Premium does not change the freight marketplace fees described in the Terms of Service.</Pp>
      <H>2. Price and tax</H>
      <Ul items={[
        'Premium Monthly: AED 199 per month. Premium Annual: AED 1,990 per year (two months free).',
        'Prices exclude UAE value added tax. VAT (currently 5%) is added at checkout and shown before you pay; the receipt shows net amount, VAT and total.',
        'The price of a published plan version never changes for the period you bought. A new price is a new plan version and applies at your next renewal after notice.',
      ]} />
      <H>3. Who can buy</H>
      <Pp>Only the administrator of a verified company can buy Premium for it, and by buying confirms authority to bind the company. Seats and unverified companies cannot.</Pp>
      <H>4. Payment, renewal and receipts</H>
      <Pp>Payment is taken by our payment provider on its hosted page; we never see or store card numbers. Access starts when the provider confirms payment, not when you return to the site. Premium is bought one period at a time: it does not renew by itself unless we have told you otherwise in writing, and we remind you before a period ends. Buying again before the end of a period adds a new period after the current one.</Pp>
      <H>5. Cancellation and what happens next</H>
      <Ul items={[
        'Cancel any time. Enterprise Included continues to the end of the period you paid for, then the company returns to Starter Included.',
        'Your data is never deleted because a plan lowers. Records above the Starter limits stay readable and exportable; only new records of the affected type are blocked.',
      ]} />
      <H>6. Failed or late payment</H>
      <Pp>If a renewal payment fails or lapses, we tell you and keep Enterprise Included for a grace period of 14 days. If it is not resolved in that time, the company returns to Starter Included. Paying during the grace period restores the membership with no gap.</Pp>
      <H>7. Refunds</H>
      <Pp>The first payment for a company is refundable within 14 days if the company has not used the plan beyond the Starter limits. Renewals are not refundable once the period has started, except where UAE law requires or we have materially failed to provide the benefit.</Pp>
      <H>8. Limits are ceilings</H>
      <Pp>Plan limits are ceilings, not promises of provider-funded usage. External usage, provider fees, implementation and managed services are quoted separately.</Pp>
      <H>9. Changes, ending and law</H>
      <Pp>We may change or end Premium on 30 days' notice, refunding the unused part of any period you paid for if we end it. These terms add to the Terms of Service and are governed by the laws of the United Arab Emirates as applied in the Emirate of Dubai, with the courts of Dubai having jurisdiction.</Pp>
    </>),
  },
  'business-os': {
    title: 'Business OS Activation Terms',
    meta: 'Terms you accept when your company activates Business OS (loadbyton.store) from its Loadbyton account.',
    body: (<>
      <H>1. What activation does</H>
      <Pp>Activating Business OS links your verified Loadbyton company to loadbyton.store. Your workspace is created the first time the administrator opens it. Nothing is migrated silently, and the freight marketplace keeps working exactly as before.</Pp>
      <H>2. Included plans</H>
      <Ul items={[
        'Starter Included: for a verified company that has activated Business OS. No subscription fee and no standard self-service set-up fee. Covers one sector.',
        'Enterprise Included: while the company also holds an active Premium membership.',
        'Limits are plan ceilings, not guaranteed provider-funded usage. External usage, provider fees, bespoke implementation and managed services are quoted separately.',
      ]} />
      <H>3. When your entitlement changes</H>
      <Ul items={[
        'Premium cancelled: Enterprise Included continues to the end of the paid period, then Starter Included.',
        'Premium payment fails: Enterprise Included continues for 14 days, then Starter Included.',
        'Company no longer verified: the workspace is read-only (readable and exportable) until verification is restored.',
        'A workspace that already pays for an equal or higher plan keeps it; an included plan never replaces a plan you bought.',
      ]} />
      <H>4. Authority and your sector</H>
      <Pp>Only the company administrator can activate and accept these terms for the company. The sector you choose is your first sector; further sectors are covered by the plan you hold, as stated in the Store plan description.</Pp>
      <H>5. Service terms</H>
      <Pp>Use of the workspace is governed by the loadbyton.store Terms of Service, Acceptable Use rules, Included Plans terms and Data Processing terms, which you also accept. We record the version of these terms, who accepted and when.</Pp>
      <H>6. Ending</H>
      <Pp>You can stop using Business OS at any time. If your Loadbyton account closes, the workspace remains on its plan for 30 days for export, then follows the retention terms.</Pp>
    </>),
  },
  'data-sharing': {
    title: 'Ecosystem Data Sharing Notice',
    meta: 'Exactly what data loadbyton.com and loadbyton.store exchange, and what they never exchange.',
    body: (<>
      <Pp>loadbyton.com and loadbyton.store are operated by the same UAE company, which is the controller for the data below. This notice supplements the Privacy Policy.</Pp>
      <H>What is shared</H>
      <Ul items={[
        'Sign-in: your person identifier, name, email and role in your company, when you use "Continue with Loadbyton".',
        'Company: the company identifier, name and verification status.',
        'Entitlement: the plan your company is entitled to, its dates and grace status, the sector you chose, and who accepted the activation terms and when.',
      ]} />
      <H>What is never shared</H>
      <Ul items={[
        'Freight jobs, bids, escrow, payments, documents, ratings and messages stay on loadbyton.com.',
        'Workspace records (customers, quotes, shipments, stock, invoices) stay on loadbyton.store.',
        'Passwords. Accounts are linked only by proof of the password on both sides, never by email address alone.',
      ]} />
      <H>How, why and for how long</H>
      <Pp>Signed, expiring messages carry entitlement changes from loadbyton.com to loadbyton.store; a nightly signed reconciliation corrects any missed message. We share this data to deliver the benefit you activated, keep it while the link is active, and then for the retention period in the Privacy Policy. You can end the link by closing Business OS. You can ask for access, correction or deletion at any time.</Pp>
    </>),
  },
};

export default function EcosystemLegal({ doc }) {
  const d = DOCS[doc];
  usePageTitle(d.title);
  useMeta(d.meta);
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner" style={{ paddingTop: 72, paddingBottom: 56 }}>
          <Reveal>
            <p className="lb-kicker"><i />LE<span>GAL</span></p>
            <h1>{d.title}</h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,.55)' }}>Version {ECOSYSTEM_LEGAL_VERSION}</p>
          </Reveal>
        </div></div>
      </section>
      <div className="container-page max-w-3xl py-10 space-y-6">
        {!REVIEWED && (
          <p role="note" className="rounded-md p-3 text-sm" style={{ background: 'var(--status-warning-bg)', color: 'var(--lb-amber-text)' }}>
            Draft — this text is awaiting review by a qualified UAE lawyer before commercial publication.
          </p>
        )}
        {d.body}
      </div>
    </div>
  );
}
