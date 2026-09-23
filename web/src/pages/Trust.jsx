// Ported from the design-tool export's pages/Marketing.jsx (TrustPage).
import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubCards, SubCta, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const ITEMS = [
  { icon: 'Shield', title: 'Verified before they can bid', body: "A transporter's TRN, trade licence, and insurance are checked before their first bid is ever visible to a shipper — enforced on the server, not a badge that's just displayed and never actually gated anything." },
  { icon: 'Wallet', title: 'Payment held, not sent on a promise', body: "The agreed price is held the moment a bid is awarded, before pickup. It releases when the shipper confirms delivery — or automatically after a fixed window if they don't — so a transporter isn't working on a verbal assurance, and a shipper isn't paying before the job is even done." },
  { icon: 'Star', title: 'Ratings that actually compound', body: "Every completed job updates a transporter or shipper's public rating. A transporter with 300 completed jobs and a 4.8 average is a different bid to evaluate than one with none — and that history is visible before you accept it, not something you find out after." },
  { icon: 'Gavel', title: 'A real dispute process, not a dead end', body: "If something goes wrong after award, either side can open a dispute. It pauses the payment and puts a human reviewer on it — the outcome isn't decided by whoever complains first or loudest." },
  { icon: 'File', title: 'A paper trail that survives the job', body: "Customs documents, proof of delivery, and every award, status change, and payment event on a job are recorded permanently and can't be edited or deleted after the fact — not a chat thread that disappears once the truck arrives." },
];

export default function Trust() {
  usePageTitle('Trust & Safety');
  useMeta('How Loadbyton protects both sides of a freight job — transporter verification, payment protection, ratings, and dispute resolution — before, during, and after a move.');
  return (
    <SitePage>
      <SubHero kicker="TRUST & SAFETY" title="Working with a company you've never met, without having to just hope it works out." lede="A shipper and a transporter agreeing to a job over chat have no real recourse if one side doesn't deliver. Every one of the mechanics below exists to close that specific gap — not as a marketing claim, but as something enforced on every job." />
      <SubSection tone="cloud" no="01 / The pillars" title="Five mechanics. Zero hoping." copy="Each one closes a specific gap that brokered freight leaves open.">
        <SubCards prefix="T" items={ITEMS} />
      </SubSection>
      <SubSection tone="paper" no="02 / Honest limits" title="What this doesn't mean.">
        <p className="sub-lead mkt-reveal">None of the above guarantees a transporter shows up on time, or that a shipper's cargo description was accurate — those are still real business risks freight always carries. What it does mean: if something goes wrong, there's a verified counterparty, a payment that hasn't already disappeared, a rating history, and a dispute process — not just a phone number that stopped answering. For exactly how data is secured, see <Link to={P.security}>Security</Link>; for the regulatory side, see <Link to={P.compliance}>Compliance</Link>.</p>
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="See the verification gate on a real job, not a slide." body="Create a free account and post a requirement both sides can trust." primary={['Create a free account', P.register]} secondary={['How data is secured', P.security]} />
    </SitePage>
  );
}
