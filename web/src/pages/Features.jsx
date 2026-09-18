import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconShield, IconClock, IconMapPin, IconFile, IconStar, IconPackage, IconTruck, IconArrowRight, IconLayers, IconCompass } from '../components/icons.jsx';

const PHOTO = 'https://images.pexels.com/photos/28438301/pexels-photo-28438301.jpeg?cs=srgb&fm=jpg&w=1600';

const FEATURES = [
  { icon: <IconShield size={20} />, title: 'Payment held, not a promise', body: 'The agreed price is held the moment you award a bid. It releases when you confirm delivery — or automatically 24h after, so nothing sits in limbo.' },
  { icon: <IconLayers size={20} />, title: '12 equipment types, one flow', body: 'Container chassis, flatbed, lowbed, tripper, curtain truck, side loader, or a 3–10 tonne pickup — post the equipment the job actually needs, not just a container.' },
  { icon: <IconPackage size={20} />, title: 'Recurring templates', body: 'Save a lane once. Re-run it into a fresh open job in one click, instead of re-typing the same container, terminal and address every week.' },
  { icon: <IconTruck size={20} />, title: 'Verified transporters only', body: 'TRN, trade licence and insurance are checked before a transporter can place a single bid — enforced server-side, not just hidden in the UI.' },
  { icon: <IconMapPin size={20} />, title: 'Live tracking & delivery commitments', body: "Every job shows its position in the lifecycle, a geofence-style pickup/delivery flag, and the transporter's committed delivery date and time." },
  { icon: <IconCompass size={20} />, title: 'Volume inquiries, UAE-wide', body: 'State a container count or truck count once and get one bid covering the full batch — across six terminals in Dubai, Abu Dhabi, Sharjah and Fujairah.' },
  { icon: <IconFile size={20} />, title: 'A document thread that survives', body: 'Customs paperwork, receipts and proof of delivery live on the job permanently, with a full audit trail — not in a disappearing chat that dies when the job ends.' },
  { icon: <IconStar size={20} />, title: 'Ratings that compound', body: 'Every completed job updates a transporter or shipper\'s public rating, so reliability becomes a visible, portable asset.' },
  { icon: <IconClock size={20} />, title: 'Auto-release, no chasing', body: "Payment releases the moment a shipper confirms delivery, or automatically after a set window — a payout doesn't depend on someone remembering to call." },
];

export default function Features() {
  usePageTitle('Features');
  useMeta('Payment-protected freight jobs across the UAE, 12 equipment types, volume inquiries, live tracking, contract lanes and a verified transporter network — everything Loadbyton ships.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />PLATFORM <span>CAPABILITIES</span></p>
            <h1>Everything it takes to stop re-negotiating the same shipment.</h1>
            <p className="lb-hero-lede">Loadbyton isn't a listings board. It's the payment protection, the state machine, and the paper trail a drayage marketplace actually needs.</p>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / THE SYSTEM</span><h2>One platform, nine load-bearing mechanics.</h2><p>Each one enforced on the server — not a badge, not a promise.</p></Reveal>
        <div className="lb-item-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 70} className="lb-item">
              <div className="lb-item-top"><span>F-{String(i + 1).padStart(2, '0')}</span>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>See it on a real job, not a slide.</h2>
          <p>Post your first load and watch the mechanics work on real freight.</p>
          <div>
            <Link to="/register" className="btn-accent btn-shine">Post your first load <IconArrowRight size={18} /></Link>
            <Link to="/pricing" className="lb-quiet-link">How pricing works</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
