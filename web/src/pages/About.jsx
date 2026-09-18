import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconShield, IconLayers, IconClock, IconArrowRight } from '../components/icons.jsx';

const PHOTO = 'https://images.pexels.com/photos/2079628/pexels-photo-2079628.jpeg?cs=srgb&fm=jpg&w=1600';

const PRINCIPLES = [
  { icon: <IconShield size={20} />, title: 'Enforced server-side', body: 'Transporter verification, the payment-hold gate, and the forward-only status flow aren\'t UI hints — every one of them is checked on the server, on every request.' },
  { icon: <IconLayers size={20} />, title: 'A record that survives the job', body: 'Every bid, award, and status change writes to an append-only audit log. Documents and proof of delivery stay attached to the job permanently, not to whichever chat thread happened to carry them.' },
  { icon: <IconClock size={20} />, title: 'Built for the repeat shipment', body: 'A shipper who posts once and goes back to their usual broker is a cost paid for nothing — so the product is built around what makes the second and fiftieth shipment easier, not just the first.' },
];

export default function About() {
  usePageTitle('About');
  useMeta('Loadbyton is a UAE road freight & container drayage marketplace built to make the second shipment happen on-platform, with an accountable, payment-protected system in place of an off-platform chat.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />ABOUT <span>LOADBYTON</span></p>
            <h1>Built for the second shipment, not just the first.</h1>
            <p className="lb-hero-lede">
              Most road freight in the UAE still moves the way it did a decade ago — a shipper with a stuck container calls around, a broker quotes a price nobody can verify against anything, and the whole arrangement lives in a chat thread that disappears the moment the truck arrives.
            </p>
          </Reveal>
        </div></div>
      </section>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / PRINCIPLES</span><h2>What the platform actually enforces.</h2><p>Not marketing language — the mechanics a real freight marketplace has to run on.</p></Reveal>
        <div className="lb-item-grid">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={i * 70} className="lb-item">
              <div className="lb-item-top"><span>P-{String(i + 1).padStart(2, '0')}</span>{p.icon}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / THE THESIS</span><h2>After the first job.</h2></Reveal>
        <Reveal className="lb-two-col" delay={60}>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: '#607078' }}>
            Loadbyton exists to change what happens after the first job. The product is built around the second shipment: recurring templates, committed contract lanes, a personal rate benchmark, and a payment-protection flow real enough that transporters and shippers can trust it with money.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: '#607078' }}>
            It's a working system, not a slide deck — payouts on the current deployment are a database status flip rather than a licensed money-transfer rail, and that's stated plainly on the <Link to="/security" className="lb-quiet-link" style={{ color: '#102631' }}>Security</Link> and <Link to="/compliance" className="lb-quiet-link" style={{ color: '#102631' }}>Compliance</Link> pages rather than glossed over. The logic underneath is the logic a real freight marketplace needs to run on.
          </p>
        </Reveal>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>See the mechanics for yourself.</h2>
          <p>A free account gets you a real job on the platform, not a demo environment.</p>
          <div>
            <Link to="/register" className="btn-accent btn-shine">Get started <IconArrowRight size={18} /></Link>
            <Link to="/features" className="lb-quiet-link">What the platform does</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
