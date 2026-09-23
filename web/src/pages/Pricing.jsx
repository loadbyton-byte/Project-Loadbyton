// Ported from the design-tool export's pages/Marketing.jsx (PricingPage).
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { MktIcon } from '../components/marketing/MktIcon.jsx';
import { SitePage, SubHero, SubSection, SubCard, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';
import { Link } from 'react-router-dom';

const P = PAGE;

const TIERS = [
  { name: 'Bronze', desc: 'Every account starts here.', fee: 'Standard take rate', perks: ['Post or bid on any open load', 'Payment protection + live tracking', 'Standard 24h payout'] },
  { name: 'Silver', desc: 'Unlocked by volume.', fee: 'Reduced take rate', perks: ['Everything in Bronze', 'Priority support', 'Personal rate benchmark'], flag: 'MOST POPULAR' },
  { name: 'Gold', desc: 'Committed lane volume.', fee: 'Lowest take rate', perks: ['Everything in Silver', 'Contract-lane priority visibility', 'Fastest payout on POD'] },
];

export default function Pricing() {
  usePageTitle('Pricing');
  useMeta('A transparent take rate, no subscription. See how Loadbyton pricing compares to broker markups.');
  return (
    <SitePage>
      <SubHero
        photo={PHOTOS.roadFreight}
        kicker="PRICING"
        title="One take rate. No subscription, no listing fee."
        lede={<>Loadbyton takes <b>6%</b> of the agreed price on award — the same rate whether it's your first job or your five-hundredth. Volume lowers it through loyalty tiers, not negotiation.</>}
        actions={<>
          <Link className="btn btn-red shimmer" to={P.register}>Create a free account &#8594;</Link>
          <Link className="btn btn-glass" to={P.features}>What's included</Link>
        </>}
      />
      <SubSection tone="cloud" no="01 / Loyalty tiers" title="Volume lowers the rate. Negotiation doesn't have to." copy="Three tiers, one mechanism — committed lane volume earns the lowest take.">
        <div className="sub-grid">
          {TIERS.map((t, i) => (
            <SubCard key={t.name} i={i} code={'TIER-' + String(i + 1).padStart(2, '0')} icon="Shield" flag={t.flag} title={t.name} body={t.desc}>
              <span className="pcard-fee">{t.fee}</span>
              <ul className="pcard-list">{t.perks.map((p) => <li key={p}><MktIcon name="Check" size={14} />{p}</li>)}</ul>
            </SubCard>
          ))}
        </div>
      </SubSection>
      <SubSection tone="paper" no="02 / Where it goes" title="Where the fee actually goes.">
        <p className="sub-lead mkt-reveal">The take rate funds transporter verification, payment administration, dispute resolution, and the Lane Index data product — not a sales team cold-calling shippers. Freight amount passes through to the transporter; the platform only ever holds the fee.</p>
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="No card required to browse open loads." body="Create a free account and see live freight before you commit to anything." primary={['Create a free account', P.register]} secondary={['Already have an account', P.login]} />
    </SitePage>
  );
}
