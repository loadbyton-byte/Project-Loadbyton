import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { StickyMobileCta } from '../components/StickyMobileCta.jsx';
import { useMagnetic } from '../lib/motion.js';
import { IconCheck, IconArrowRight, IconShield } from '../components/icons.jsx';

const PHOTO = 'https://images.pexels.com/photos/27099094/pexels-photo-27099094.jpeg?cs=srgb&fm=jpg&w=1600';

const TIERS = [
  { name: 'Bronze', desc: 'Every account starts here.', fee: 'Standard take rate', perks: ['Post or bid on any open load', 'Payment protection + live tracking', 'Standard 24h payout'] },
  { name: 'Silver', desc: 'Unlocked by volume.', fee: 'Reduced take rate', perks: ['Everything in Bronze', 'Priority support', 'Personal rate benchmark'], recommended: true },
  { name: 'Gold', desc: 'Committed lane volume.', fee: 'Lowest take rate', perks: ['Everything in Silver', 'Contract-lane priority visibility', 'Fastest payout on POD'] },
];

export default function Pricing() {
  usePageTitle('Pricing');
  useMeta('A transparent take rate, no subscription. See how Loadbyton pricing compares to broker markups.');
  const [takeRate, setTakeRate] = useState('6%');
  useEffect(() => { api.publicMarket().then((d) => setTakeRate(d.market.takeRate)).catch(() => {}); }, []);
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
            <p className="lb-kicker"><i />PRI<span>CING</span></p>
            <h1>One take rate. No subscription, no listing fee.</h1>
            <p className="lb-hero-lede">
              Loadbyton takes <span className="tabular font-semibold" style={{ color: 'var(--brand-accent)' }}>{takeRate}</span> of the agreed price on award — the same rate whether it's your first job or your five-hundredth. Volume lowers it through loyalty tiers, not negotiation.
            </p>
          </Reveal>
        </div></div>
      </section>
      </div>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / LOYALTY TIERS</span><h2>Volume lowers the rate. Negotiation doesn't have to.</h2><p>Three tiers, one mechanism — committed lane volume earns the lowest take.</p></Reveal>
        <div className="lb-item-grid">
          {TIERS.map((t, i) => (
            <Reveal key={t.name} delay={i * 70} className="lb-item">
              <div className="lb-item-top"><span>TIER-{String(i + 1).padStart(2, '0')}</span>{t.recommended ? <span className="lb-item-flag">MOST POPULAR</span> : <IconShield size={18} />}</div>
              <h3>{t.name}</h3>
              <p>{t.desc} — <strong style={{ color: 'var(--brand-accent)' }}>{t.fee}</strong></p>
              <ul>
                {t.perks.map((p) => (
                  <li key={p}><IconCheck size={14} /> {p}</li>
                ))}
              </ul>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / WHERE IT GOES</span><h2>Where the fee actually goes.</h2><p>The take rate funds transporter verification, payment administration, dispute resolution, and the Lane Index data product — not a sales team cold-calling shippers. Freight amount passes through to the transporter; the platform only ever holds the fee.</p></Reveal>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>No card required to browse open loads.</h2>
          <p>Create a free account and see live freight before you commit to anything.</p>
          <div>
            <Link ref={bottomCtaRef} to="/register" className="btn-accent btn-shine">Create a free account <IconArrowRight size={18} /></Link>
            <Link to="/login" className="lb-quiet-link">Already have an account</Link>
          </div>
        </Reveal>
      </div></section>
      <StickyMobileCta heroRef={heroSectionRef} to="/register" label="Create a free account" />
    </div>
  );
}
