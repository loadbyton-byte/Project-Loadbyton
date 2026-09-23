// Ported from the design-tool export's pages/Marketing.jsx (AboutPage).
import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubCards, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const ITEMS = [
  { icon: 'Shield', title: 'Enforced server-side', body: "Transporter verification, the payment-hold gate, and the forward-only status flow aren't UI hints — every one of them is checked on the server, on every request." },
  { icon: 'Layers', title: 'A record that survives the job', body: 'Every bid, award, and status change writes to an append-only audit log. Documents and proof of delivery stay attached to the job permanently, not to whichever chat thread happened to carry them.' },
  { icon: 'Clock', title: 'Built for the repeat shipment', body: 'A shipper who posts once and goes back to their usual broker is a cost paid for nothing — so the product is built around what makes the second and fiftieth shipment easier, not just the first.' },
];

export default function About() {
  usePageTitle('About');
  useMeta('Loadbyton is a UAE road freight & container drayage marketplace built to make the second shipment happen on-platform, with an accountable, payment-protected system in place of an off-platform chat.');
  return (
    <SitePage>
      <SubHero photo={PHOTOS.fleet} kicker="ABOUT · LOADBYTON" title="Built for the second shipment, not just the first." lede="Most road freight in the UAE still moves the way it did a decade ago — a shipper with a stuck container calls around, a broker quotes a price nobody can verify against anything, and the whole arrangement lives in a chat thread that disappears the moment the truck arrives." />
      <SubSection tone="dark" no="01 / Principles" title="What the platform actually enforces." copy="Not marketing language — the mechanics a real freight marketplace has to run on.">
        <SubCards prefix="P" items={ITEMS} />
      </SubSection>
      <SubSection tone="paper" no="02 / The thesis" title="After the first job.">
        <div className="sub-prose mkt-reveal">
          <p>Loadbyton exists to change what happens after the first job. The product is built around the second shipment: recurring templates, committed contract lanes, a personal rate benchmark, and a payment-protection flow real enough that transporters and shippers can trust it with money.</p>
          <p>It's a working system, not a slide deck — payouts on the current deployment are a database status flip rather than a licensed money-transfer rail, and that's stated plainly on the <Link to={P.security}>Security</Link> and <Link to={P.compliance}>Compliance</Link> pages rather than glossed over. The logic underneath is the logic a real freight marketplace needs to run on.</p>
        </div>
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="See the mechanics for yourself." body="A free account gets you a real job on the platform, not a demo environment." primary={['Get started', P.register]} secondary={['What the platform does', P.features]} />
    </SitePage>
  );
}
