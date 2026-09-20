import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { StickyMobileCta } from '../components/StickyMobileCta.jsx';
import { useMagnetic } from '../lib/motion.js';
import { IconArrowRight, IconGavel, IconWallet, IconTruck, IconShield, IconClock, IconStar } from '../components/icons.jsx';
import { CAMPAIGN_IMAGES } from '../lib/campaignImages.js';

const PHOTO = CAMPAIGN_IMAGES.roadFreight;

const STEPS = [
  { n: '01', title: 'Get verified once', body: 'Submit your trade licence, TRN, and insurance. Usually reviewed within a day. After that, you can bid on any open load — no re-verifying per job.', icon: <IconShield size={20} /> },
  { n: '02', title: 'Bid on loads that fit your fleet', body: 'Filter by equipment type, route, and container size. Price and ETA are yours to set — nobody assigns you a job you didn\'t choose to bid on.', icon: <IconGavel size={20} /> },
  { n: '03', title: 'Get awarded, move the freight', body: 'If a shipper picks your bid, the price locks and payment is already held before you pick up. Update status as you go — picked up, in transit, delivered.', icon: <IconTruck size={20} /> },
  { n: '04', title: 'Get paid without chasing anyone', body: 'Confirm delivery, or wait for the automatic release window. The payout is net of Loadbyton\'s take rate — no separate invoice to raise, no following up to get paid.', icon: <IconWallet size={20} /> },
];

const REASONS = [
  { icon: <IconWallet size={20} />, title: 'Payment held before you move', body: 'The shipper\'s payment is held the moment you\'re awarded the job — before you ever load a container. You\'re not extending credit to a shipper you\'ve never worked with.' },
  { icon: <IconGavel size={20} />, title: 'You set your own price', body: 'Every bid is yours — your price, your ETA, your equipment. Loadbyton doesn\'t set rates or assign work without your bid.' },
  { icon: <IconStar size={20} />, title: 'Your rating is portable', body: 'Completed jobs build a public rating and job count. A transporter with a real track record stands out on every future bid, not just this one.' },
  { icon: <IconClock size={20} />, title: 'Fast, predictable payout', body: 'Delivery confirmed, or an automatic release window if the shipper doesn\'t confirm — a payout doesn\'t depend on someone remembering to call you.' },
  { icon: <IconTruck size={20} />, title: 'One truck or a fleet, both work', body: 'An owner-operator with one truck and a company running fifty are on the same bidding terms. Fleet size doesn\'t gate what loads you can see.' },
  { icon: <IconShield size={20} />, title: 'Verified counterparties only', body: 'Every shipper posting a job on Loadbyton has a real account tied to a real company — not an anonymous number in a broker group chat.' },
];

export default function ForTransporters() {
  usePageTitle('For Transporters');
  useMeta('Join Loadbyton as a transporter, fleet owner, or owner-operator — bid on verified UAE freight jobs, get paid without chasing invoices.');
  const heroCtaRef = useMagnetic();
  const bottomCtaRef = useMagnetic();
  const heroSectionRef = useRef(null);
  return (
    <div dir="ltr" className="lb-home">
      <div ref={heroSectionRef}>
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />FOR <span>TRANSPORTERS</span></p>
            <h1>Bid on real freight jobs, get paid without chasing anyone.</h1>
            <p className="lb-hero-lede">
              Whether you run one truck or a fifty-vehicle fleet, verification happens once and bidding is open after that — on jobs from shippers whose payment is already held before you ever load a container.
            </p>
            <div className="lb-hero-actions">
              <Link ref={heroCtaRef} to="/register?role=CARRIER" className="btn-accent btn-shine">Join as a transporter <IconArrowRight size={18} /></Link>
              <Link to="/pricing" className="lb-ghost-btn">See the take rate</Link>
            </div>
          </Reveal>
        </div></div>
      </section>
      </div>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / HOW IT WORKS</span><h2>From verification to payout.</h2><p>Four stages, no gatekeeping between them — bid on what fits your fleet.</p></Reveal>
        <div className="lb-record-steps lb-record-steps--4">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 70} className="lb-record-step">
              <div className="lb-step-top"><span>{step.n}</span>{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <i className="lb-step-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / WHY TRANSPORTERS STAY</span><h2>Work on terms you set yourself.</h2><p>Held payment, portable reputation, and no one assigning you work you didn't bid on.</p></Reveal>
        <div className="lb-item-grid">
          {REASONS.map((r, i) => (
            <Reveal key={r.title} delay={(i % 3) * 70} className="lb-item">
              <div className="lb-item-top"><span>R-{String(i + 1).padStart(2, '0')}</span>{r.icon}</div>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>Verification usually clears within a day.</h2>
          <p>Trade licence, TRN, and insurance — that's it to get started.</p>
          <div>
            <Link ref={bottomCtaRef} to="/register?role=CARRIER" className="btn-accent btn-shine">Join as a transporter <IconArrowRight size={18} /></Link>
            <Link to="/for-shippers" className="lb-quiet-link">Ship freight instead</Link>
          </div>
        </Reveal>
      </div></section>
      <StickyMobileCta heroRef={heroSectionRef} to="/register?role=CARRIER" label="Join as a transporter" />
    </div>
  );
}
