// Ported from the design-tool export's pages/Marketing.jsx (TransportersPage).
import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubSteps, SubCards, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;
const REGISTER_CARRIER = P.register + '?role=CARRIER';

const STEPS = [
  { n: '01', icon: 'Shield', title: 'Get verified once', body: 'Submit your trade licence, TRN, and insurance. Usually reviewed within a day. After that, you can bid on any open load — no re-verifying per job.' },
  { n: '02', icon: 'Gavel', title: 'Bid on loads that fit your fleet', body: "Filter by equipment type, route, and container size. Price and ETA are yours to set — nobody assigns you a job you didn't choose to bid on." },
  { n: '03', icon: 'Truck', title: 'Get awarded, move the freight', body: 'If a shipper picks your bid, the price locks and payment is already held before you pick up. Update status as you go — picked up, in transit, delivered.' },
  { n: '04', icon: 'Wallet', title: 'Get paid without chasing anyone', body: "Confirm delivery, or wait for the automatic release window. The payout is net of Loadbyton's take rate — no separate invoice to raise, no following up to get paid." },
];

const REASONS = [
  { icon: 'Wallet', title: 'Payment held before you move', body: "The shipper's payment is held the moment you're awarded the job — before you ever load a container. You're not extending credit to a shipper you've never worked with." },
  { icon: 'Gavel', title: 'You set your own price', body: "Every bid is yours — your price, your ETA, your equipment. Loadbyton doesn't set rates or assign work without your bid." },
  { icon: 'Star', title: 'Your rating is portable', body: 'Completed jobs build a public rating and job count. A transporter with a real track record stands out on every future bid, not just this one.' },
  { icon: 'Clock', title: 'Fast, predictable payout', body: "Delivery confirmed, or an automatic release window if the shipper doesn't confirm — a payout doesn't depend on someone remembering to call you." },
  { icon: 'Truck', title: 'One truck or a fleet, both work', body: "An owner-operator with one truck and a company running fifty are on the same bidding terms. Fleet size doesn't gate what loads you can see." },
  { icon: 'Shield', title: 'Verified counterparties only', body: 'Every shipper posting a job on Loadbyton has a real account tied to a real company — not an anonymous number in a broker group chat.' },
];

export default function ForTransporters() {
  usePageTitle('For Transporters');
  useMeta('Join Loadbyton as a transporter, fleet owner, or owner-operator — bid on verified UAE freight jobs, get paid without chasing invoices.');
  return (
    <SitePage>
      <SubHero
        photo={PHOTOS.roadFreight}
        kicker="FOR TRANSPORTERS"
        title="Bid on real freight jobs, get paid without chasing anyone."
        lede="Whether you run one truck or a fifty-vehicle fleet, verification happens once and bidding is open after that — on jobs from shippers whose payment is already held before you ever load a container."
        actions={<>
          <Link className="btn btn-red shimmer" to={REGISTER_CARRIER}>Join as a transporter &#8594;</Link>
          <Link className="btn btn-glass" to={P.pricing}>See the take rate</Link>
        </>}
      />
      <SubSection tone="cloud" no="01 / How it works" title="From verification to payout." copy="Four stages, no gatekeeping between them — bid on what fits your fleet.">
        <SubSteps steps={STEPS} />
      </SubSection>
      <SubSection tone="paper" no="02 / Why transporters stay" title="Work on terms you set yourself." copy="Held payment, portable reputation, and no one assigning you work you didn't bid on.">
        <SubCards prefix="R" items={REASONS} />
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="Verification usually clears within a day." body="Trade licence, TRN, and insurance — that's it to get started." primary={['Join as a transporter', REGISTER_CARRIER]} secondary={['Ship freight instead', P.shippers]} />
    </SitePage>
  );
}
